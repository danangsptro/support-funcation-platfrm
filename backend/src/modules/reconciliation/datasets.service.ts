import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, TransactionSide } from '@prisma/client';
import { AppException } from '../../common/app-exception';
import { Page, pageArgs } from '../../common/pagination';
import { PrismaService } from '../../database/prisma.service';
import type { Actor } from '../access/actor';
import { Permission } from '../access/permissions';
import { ScopeService } from '../access/scope.service';
import { AuditService } from '../audit/audit.service';
import { datasetFingerprint, payloadHash } from './canonical';
import { parseTransactionsCsv } from './csv-import';
import { ImportDatasetBody, ListDatasetsQuery } from './dto';

const datasetSelect = {
  id: true,
  accountId: true,
  side: true,
  fingerprint: true,
  rowCount: true,
  sourceFilename: true,
  createdAt: true,
  organization: { select: { id: true, externalKey: true, name: true } },
  unit: { select: { id: true, externalKey: true, name: true } },
} satisfies Prisma.TransactionDatasetSelect;

type DatasetRow = Prisma.TransactionDatasetGetPayload<{ select: typeof datasetSelect }>;

export function toDatasetView(d: DatasetRow) {
  return {
    id: d.id,
    organization: { id: d.organization.id, code: d.organization.externalKey, name: d.organization.name },
    unit: { id: d.unit.id, code: d.unit.externalKey, name: d.unit.name },
    accountId: d.accountId,
    side: d.side,
    rowCount: d.rowCount,
    fingerprint: d.fingerprint,
    sourceFilename: d.sourceFilename,
    createdAt: d.createdAt.toISOString(),
  };
}

class DuplicateDataset extends Error {}

@Injectable()
export class DatasetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: ScopeService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Import atomik & idempoten. Seluruh file divalidasi dulu; satu baris salah → 400, nol baris tersimpan.
   * File yang sama (atau urutan baris berbeda) → dataset yang sama (`created: false`).
   * Transaksi sumber disimpan sekali per identitas; dataset hanya menyimpan keanggotaan.
   */
  async import(actor: Actor, body: ImportDatasetBody, file: { buffer: Buffer; originalname: string }, traceId?: string) {
    const scope = await this.scopes.resolve(actor, Permission.DatasetImport);
    scope.assertUnit(body.unitId, 'Unit');
    const unit = await this.prisma.orgUnit.findUniqueOrThrow({
      where: { id: body.unitId },
      select: { id: true, externalKey: true, organizationId: true, organization: { select: { externalKey: true } } },
    });

    const allUnits = await this.prisma.orgUnit.findMany({ select: { externalKey: true, organization: { select: { externalKey: true } } } });
    const unitOrganizations = new Map<string, Set<string>>();
    for (const u of allUnits) {
      const owners = unitOrganizations.get(u.externalKey) ?? new Set<string>();
      owners.add(u.organization.externalKey);
      unitOrganizations.set(u.externalKey, owners);
    }

    const parsed = parseTransactionsCsv(file.buffer, {
      organizationCode: unit.organization.externalKey,
      unitCode: unit.externalKey,
      accountId: body.accountId,
      unitOrganizations,
    });
    if (!parsed.ok) {
      if ('fileError' in parsed) throw new AppException(HttpStatus.BAD_REQUEST, parsed.fileError.code, parsed.fileError.message);
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'IMPORT_REJECTED',
        `File ditolak: ${parsed.totalErrors} baris tidak valid. Tidak ada data yang disimpan.`,
        { totalErrors: parsed.totalErrors, errors: parsed.rowErrors },
      );
    }

    const scopeKey = { organizationId: unit.organizationId, unitId: unit.id, accountId: body.accountId, side: body.side };
    const fingerprint = datasetFingerprint(scopeKey, parsed.rows);
    const existing = await this.findByFingerprint(unit.organizationId, fingerprint);
    if (existing) return { dataset: toDatasetView(existing), created: false };

    try {
      const dataset = await this.prisma.$transaction(
        async (tx) => {
          const rows = parsed.rows.map((r) => ({ r, hash: payloadHash(r) }));
          await tx.financialTransaction.createMany({
            data: rows.map(({ r, hash }) => ({
              organizationId: unit.organizationId,
              unitId: unit.id,
              side: body.side,
              accountId: body.accountId,
              sourceTransactionId: r.transactionId,
              reference: r.reference,
              transactionDate: new Date(`${r.transactionDate}T00:00:00.000Z`),
              amount: new Prisma.Decimal(r.amount),
              currency: r.currency,
              transactionType: r.transactionType,
              payloadHash: hash,
            })),
            skipDuplicates: true,
          });
          const stored = await tx.financialTransaction.findMany({
            where: {
              organizationId: unit.organizationId,
              side: body.side,
              accountId: body.accountId,
              sourceTransactionId: { in: rows.map(({ r }) => r.transactionId) },
            },
            select: { id: true, sourceTransactionId: true, payloadHash: true },
          });
          const bySource = new Map(stored.map((s) => [s.sourceTransactionId, s]));
          const conflicts = rows.filter(({ r, hash }) => bySource.get(r.transactionId)?.payloadHash !== hash);
          if (conflicts.length > 0) {
            throw new AppException(
              HttpStatus.CONFLICT,
              'TRANSACTION_CONFLICT',
              'Sebagian transaction_id sudah pernah diimport dengan isi berbeda. Koreksi data memerlukan versi baru; tidak ada data yang disimpan.',
              { transactionIds: conflicts.slice(0, 100).map(({ r }) => r.transactionId), totalConflicts: conflicts.length },
            );
          }

          let created;
          try {
            created = await tx.transactionDataset.create({
              data: {
                organizationId: unit.organizationId,
                unitId: unit.id,
                accountId: body.accountId,
                side: body.side,
                fingerprint,
                rowCount: rows.length,
                sourceFilename: file.originalname.slice(0, 255),
                importedBy: actor.userId,
              },
              select: datasetSelect,
            });
          } catch (err) {
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new DuplicateDataset();
            throw err;
          }
          await tx.datasetTransaction.createMany({
            data: rows.map(({ r }) => ({ datasetId: created.id, transactionId: bySource.get(r.transactionId)!.id })),
          });
          await this.audit.record(tx, {
            organizationId: unit.organizationId,
            entityType: 'transaction_dataset',
            entityId: created.id,
            actorUserId: actor.userId,
            eventType: 'DATASET_IMPORTED',
            payload: { side: body.side, accountId: body.accountId, rowCount: rows.length, fingerprint },
            traceId,
          });
          return created;
        },
        { timeout: 30_000 },
      );
      return { dataset: toDatasetView(dataset), created: true };
    } catch (err) {
      // Import identik paralel: transaksi lain sudah commit dataset yang sama.
      if (err instanceof DuplicateDataset) {
        const winner = await this.findByFingerprint(unit.organizationId, fingerprint);
        if (winner) return { dataset: toDatasetView(winner), created: false };
      }
      throw err;
    }
  }

  async list(actor: Actor, q: ListDatasetsQuery): Promise<Page<ReturnType<typeof toDatasetView>>> {
    const scope = await this.scopes.resolve(actor, Permission.ReconciliationRead);
    if (q.unitId) scope.assertUnit(q.unitId, 'Unit');
    const where: Prisma.TransactionDatasetWhereInput = {
      unitId: q.unitId ?? { in: scope.unitIds },
      side: q.side as TransactionSide | undefined,
    };
    const [rows, total] = await Promise.all([
      this.prisma.transactionDataset.findMany({ where, select: datasetSelect, orderBy: { createdAt: 'desc' }, ...pageArgs(q) }),
      this.prisma.transactionDataset.count({ where }),
    ]);
    return { items: rows.map(toDatasetView), page: q.page, pageSize: q.pageSize, total };
  }

  private findByFingerprint(organizationId: string, fingerprint: string) {
    return this.prisma.transactionDataset.findUnique({
      where: { organizationId_fingerprint: { organizationId, fingerprint } },
      select: datasetSelect,
    });
  }
}

