import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { MatchStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { AppException } from '../../common/app-exception';
import { toIsoDate } from '../../common/dates';
import { Page, pageArgs } from '../../common/pagination';
import { PrismaService } from '../../database/prisma.service';
import type { Actor } from '../access/actor';
import { Permission } from '../access/permissions';
import { notFound, ScopeService } from '../access/scope.service';
import { AuditService } from '../audit/audit.service';
import { CreateRunBody, ListResultsQuery, ListRunsQuery } from './dto';
import { MatchInput, reconcile } from './matcher';
import { MATCH_RULES, STATUS_LABEL } from './rules';

/** Titik injeksi kegagalan untuk test rollback; produksi memakai objek kosong. */
export interface ReconciliationHooks {
  beforeCommit?(runId: string): Promise<void> | void;
}
export const RECONCILIATION_HOOKS = Symbol('RECONCILIATION_HOOKS');

const runSelect = {
  id: true,
  ruleVersion: true,
  dateToleranceDays: true,
  amountTolerance: true,
  accountId: true,
  internalDatasetId: true,
  externalDatasetId: true,
  createdAt: true,
  completedAt: true,
  unitId: true,
  organizationId: true,
  _count: { select: { canonical: true, results: true } },
} satisfies Prisma.ReconciliationRunSelect;

type RunRow = Prisma.ReconciliationRunGetPayload<{ select: typeof runSelect }>;

class RunAlreadyExists extends Error {}

@Injectable()
export class RunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: ScopeService,
    private readonly audit: AuditService,
    @Inject(RECONCILIATION_HOOKS) private readonly hooks: ReconciliationHooks,
  ) {}

  /**
   * Run idempoten: identitas = (dataset internal, dataset eksternal, versi aturan).
   * Advisory lock transaksi menyerialkan request identik; unique constraint adalah jaring kedua.
   * Hasil, item, canonical, dan audit ditulis dalam SATU transaksi — gagal = tidak ada sisa parsial.
   */
  async create(actor: Actor, body: CreateRunBody, traceId?: string) {
    const scope = await this.scopes.resolve(actor, Permission.ReconciliationRun);
    const [internal, external] = await Promise.all([
      this.prisma.transactionDataset.findUnique({ where: { id: body.internalDatasetId } }),
      this.prisma.transactionDataset.findUnique({ where: { id: body.externalDatasetId } }),
    ]);
    if (!internal || !scope.hasUnit(internal.unitId)) throw notFound('Dataset internal');
    if (!external || !scope.hasUnit(external.unitId)) throw notFound('Dataset eksternal');
    if (internal.side !== 'INTERNAL' || external.side !== 'EXTERNAL') {
      throw new AppException(HttpStatus.BAD_REQUEST, 'DATASET_SIDE_MISMATCH', 'Pilih satu dataset INTERNAL dan satu dataset EXTERNAL');
    }
    if (
      internal.organizationId !== external.organizationId ||
      internal.unitId !== external.unitId ||
      internal.accountId !== external.accountId
    ) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'DATASET_SCOPE_MISMATCH',
        'Kedua dataset harus berasal dari organisasi, unit, dan akun yang sama',
      );
    }
    const rule = MATCH_RULES[body.ruleVersion];
    const identity = {
      internalDatasetId_externalDatasetId_ruleVersion: {
        internalDatasetId: internal.id,
        externalDatasetId: external.id,
        ruleVersion: rule.version,
      },
    };
    const existing = await this.prisma.reconciliationRun.findUnique({ where: identity, select: runSelect });
    if (existing) return { run: this.toView(existing), created: false };

    try {
      const runId = await this.prisma.$transaction(
        async (tx) => {
          const lockKey = `recon-run:${internal.id}:${external.id}:${rule.version}`;
          // $executeRaw: fungsi mengembalikan void yang tidak bisa dideserialisasi oleh $queryRaw.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
          if (await tx.reconciliationRun.findUnique({ where: identity, select: { id: true } })) throw new RunAlreadyExists();

          const load = (datasetId: string) =>
            tx.financialTransaction.findMany({
              where: { datasets: { some: { datasetId } } },
              select: {
                id: true,
                sourceTransactionId: true,
                organizationId: true,
                unitId: true,
                accountId: true,
                currency: true,
                reference: true,
                transactionDate: true,
                amount: true,
              },
            });
          const toInput = (t: Awaited<ReturnType<typeof load>>[number]): MatchInput => ({
            ...t,
            currency: t.currency.trim(),
            transactionDate: toIsoDate(t.transactionDate),
            amount: t.amount.toString(),
          });
          const [ints, exts] = await Promise.all([load(internal.id), load(external.id)]);
          const groups = reconcile(ints.map(toInput), exts.map(toInput), rule);

          const run = await tx.reconciliationRun.create({
            data: {
              organizationId: internal.organizationId,
              unitId: internal.unitId,
              accountId: internal.accountId,
              internalDatasetId: internal.id,
              externalDatasetId: external.id,
              ruleVersion: rule.version,
              dateToleranceDays: rule.dateToleranceDays,
              amountTolerance: new Prisma.Decimal(rule.amountTolerance.toFixed()),
              createdBy: actor.userId,
              completedAt: new Date(),
            },
            select: { id: true },
          });
          const results = groups.map((g) => ({ id: randomUUID(), g }));
          await tx.reconciliationResult.createMany({
            data: results.map(({ id, g }) => ({
              id,
              runId: run.id,
              matchKey: g.matchKey,
              reference: g.reference,
              status: g.status as MatchStatus,
              reason: g.reason,
              internalAmountTotal: new Prisma.Decimal(g.internalAmountTotal.toFixed()),
              externalAmountTotal: new Prisma.Decimal(g.externalAmountTotal.toFixed()),
              amountDifference: g.amountDifference ? new Prisma.Decimal(g.amountDifference.toFixed()) : null,
            })),
          });
          await tx.reconciliationResultItem.createMany({
            data: results.flatMap(({ id, g }) => [
              ...g.internal.map((t) => ({ resultId: id, runId: run.id, transactionId: t.id, side: 'INTERNAL' as const })),
              ...g.external.map((t) => ({ resultId: id, runId: run.id, transactionId: t.id, side: 'EXTERNAL' as const })),
            ]),
          });

          await this.hooks.beforeCommit?.(run.id);

          // Canonical: satu hasil per transaksi internal. Hanya boleh menggantikan run dengan pasangan
          // dataset yang sama (mis. v1 → v2); overlap dengan pasangan lain ditolak agar tidak double-count.
          const internalIds = results.flatMap(({ g }) => g.internal.map((t) => t.id));
          const current = await tx.canonicalReconciliation.findMany({
            where: { internalTransactionId: { in: internalIds } },
            select: { internalTransactionId: true, run: { select: { id: true, internalDatasetId: true, externalDatasetId: true } } },
          });
          const overlapping = current.filter(
            (c) => c.run.internalDatasetId !== internal.id || c.run.externalDatasetId !== external.id,
          );
          if (overlapping.length > 0) {
            throw new AppException(
              HttpStatus.CONFLICT,
              'CANONICAL_OVERLAP',
              'Sebagian transaksi sudah direkonsiliasi lewat pasangan dataset lain. Run tidak disimpan agar revenue tidak terhitung ganda.',
              { conflictingRunIds: [...new Set(overlapping.map((c) => c.run.id))], transactions: overlapping.length },
            );
          }
          await tx.canonicalReconciliation.deleteMany({ where: { internalTransactionId: { in: internalIds } } });
          await tx.canonicalReconciliation.createMany({
            data: results.flatMap(({ id, g }) => g.internal.map((t) => ({ internalTransactionId: t.id, runId: run.id, resultId: id }))),
          });
          await this.audit.record(tx, {
            organizationId: internal.organizationId,
            entityType: 'reconciliation_run',
            entityId: run.id,
            actorUserId: actor.userId,
            eventType: 'RECONCILIATION_RUN_COMPLETED',
            payload: { ruleVersion: rule.version, groups: groups.length, replacedRunIds: [...new Set(current.map((c) => c.run.id))] },
            traceId,
          });
          return run.id;
        },
        { timeout: 30_000 },
      );
      const run = await this.prisma.reconciliationRun.findUniqueOrThrow({ where: { id: runId }, select: runSelect });
      return { run: this.toView(run), created: true };
    } catch (err) {
      const duplicate =
        err instanceof RunAlreadyExists || (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002');
      if (duplicate) {
        const winner = await this.prisma.reconciliationRun.findUnique({ where: identity, select: runSelect });
        if (winner) return { run: this.toView(winner), created: false };
      }
      throw err;
    }
  }

  async list(actor: Actor, q: ListRunsQuery): Promise<Page<ReturnType<RunsService['toView']>>> {
    const scope = await this.scopes.resolve(actor, Permission.ReconciliationSummaryRead);
    if (q.unitId) scope.assertUnit(q.unitId, 'Unit');
    const where: Prisma.ReconciliationRunWhereInput = { unitId: q.unitId ?? { in: scope.unitIds } };
    const [rows, total] = await Promise.all([
      // id sebagai pemecah seri: run dengan created_at sama tetap berurutan stabil antar halaman.
      this.prisma.reconciliationRun.findMany({ where, select: runSelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(q) }),
      this.prisma.reconciliationRun.count({ where }),
    ]);
    const units = await this.unitLabels(rows.map((r) => r.unitId));
    return { items: rows.map((r) => this.toView(r, units.get(r.unitId))), page: q.page, pageSize: q.pageSize, total };
  }

  async results(actor: Actor, runId: string, q: ListResultsQuery) {
    await this.visibleRun(actor, runId, Permission.ReconciliationRead);
    const where: Prisma.ReconciliationResultWhereInput = { runId, status: q.status, reason: q.reason };
    const [rows, total] = await Promise.all([
      this.prisma.reconciliationResult.findMany({
        where,
        orderBy: { matchKey: 'asc' },
        ...pageArgs(q),
        include: {
          items: {
            include: {
              transaction: { select: { id: true, sourceTransactionId: true, transactionDate: true, amount: true, reference: true } },
            },
          },
        },
      }),
      this.prisma.reconciliationResult.count({ where }),
    ]);
    const items = rows.map((r) => {
      const side = (s: 'INTERNAL' | 'EXTERNAL') =>
        r.items
          .filter((i) => i.side === s)
          .map((i) => ({
            id: i.transaction.id,
            transactionId: i.transaction.sourceTransactionId,
            reference: i.transaction.reference,
            transactionDate: toIsoDate(i.transaction.transactionDate),
            amount: i.transaction.amount.toString(),
          }))
          .sort((a, b) => a.transactionId.localeCompare(b.transactionId));
      return {
        id: r.id,
        reference: r.reference,
        status: r.status,
        statusLabel: STATUS_LABEL[r.status],
        reason: r.reason,
        internal: side('INTERNAL'),
        external: side('EXTERNAL'),
        internalAmountTotal: r.internalAmountTotal.toString(),
        externalAmountTotal: r.externalAmountTotal.toString(),
        amountDifference: r.amountDifference?.toString() ?? null,
      };
    });
    return { items, page: q.page, pageSize: q.pageSize, total };
  }

  /** Ringkasan segar dari baris yang sudah commit (tanpa cache). Angka anomali tidak dijumlahkan. */
  async summary(actor: Actor, runId: string) {
    const run = await this.visibleRun(actor, runId, Permission.ReconciliationSummaryRead);
    const [byStatus, byReason, anomalous, pairDiff] = await Promise.all([
      this.prisma.reconciliationResult.groupBy({
        by: ['status'],
        where: { runId },
        _count: { _all: true },
        _sum: { internalAmountTotal: true },
      }),
      this.prisma.reconciliationResult.groupBy({ by: ['reason'], where: { runId, reason: { not: null } }, _count: { _all: true } }),
      this.prisma.reconciliationResult.aggregate({
        where: { runId, status: { not: 'MATCHED' } },
        _sum: { internalAmountTotal: true, externalAmountTotal: true },
      }),
      this.prisma.reconciliationResult.aggregate({
        where: { runId, status: 'MISMATCHED', amountDifference: { not: null } },
        _sum: { amountDifference: true },
      }),
    ]);
    const counts = { MATCHED: 0, MISMATCHED: 0, MISSING_IN_INTERNAL: 0, MISSING_IN_EXTERNAL: 0 };
    for (const s of byStatus) counts[s.status] = s._count._all;
    const groups = Object.values(counts).reduce((a, b) => a + b, 0);
    const matchedRatioPercent = groups === 0 ? null : new Decimal(counts.MATCHED).div(groups).times(100);
    const dec = (v: Prisma.Decimal | null | undefined) => (v ?? new Prisma.Decimal(0)).toString();
    return {
      runId,
      ruleVersion: run.ruleVersion,
      groups,
      counts,
      byReason: Object.fromEntries(byReason.map((r) => [r.reason as string, r._count._all])),
      matchedRatioPercent: matchedRatioPercent?.toString() ?? null,
      matchedRatioPercentDisplay: matchedRatioPercent?.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2) ?? null,
      verifiedRevenue: dec(byStatus.find((s) => s.status === 'MATCHED')?._sum.internalAmountTotal),
      anomalousInternalTotal: dec(anomalous._sum.internalAmountTotal),
      anomalousExternalTotal: dec(anomalous._sum.externalAmountTotal),
      uniquePairAmountDifferenceTotal: dec(pairDiff._sum.amountDifference),
      isCanonical: run._count.canonical > 0,
    };
  }

  async detail(actor: Actor, runId: string) {
    const run = await this.visibleRun(actor, runId, Permission.ReconciliationSummaryRead);
    const units = await this.unitLabels([run.unitId]);
    return this.toView(run, units.get(run.unitId));
  }

  private async visibleRun(actor: Actor, runId: string, permission: Permission): Promise<RunRow> {
    const scope = await this.scopes.resolve(actor, permission);
    const run = await this.prisma.reconciliationRun.findUnique({ where: { id: runId }, select: runSelect });
    if (!run || !scope.hasUnit(run.unitId)) throw notFound('Run rekonsiliasi');
    return run;
  }

  private async unitLabels(ids: string[]) {
    const units = await this.prisma.orgUnit.findMany({ where: { id: { in: ids } }, select: { id: true, externalKey: true, name: true } });
    return new Map(units.map((u) => [u.id, { id: u.id, code: u.externalKey, name: u.name }]));
  }

  private toView(r: RunRow, unit?: { id: string; code: string; name: string }) {
    return {
      id: r.id,
      ruleVersion: r.ruleVersion,
      dateToleranceDays: r.dateToleranceDays,
      amountTolerance: r.amountTolerance.toString(),
      unitId: r.unitId,
      unit: unit ?? null,
      accountId: r.accountId,
      internalDatasetId: r.internalDatasetId,
      externalDatasetId: r.externalDatasetId,
      groups: r._count.results,
      /** true bila run ini sumber canonical untuk analitik (bukan run lama yang sudah digantikan). */
      isCanonical: r._count.canonical > 0,
      createdAt: r.createdAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
    };
  }
}
