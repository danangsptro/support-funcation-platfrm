import { HttpStatus, Injectable } from '@nestjs/common';
import { KpiSource, Prisma } from '@prisma/client';
import { AppException } from '../../common/app-exception';
import { PrismaService } from '../../database/prisma.service';
import type { Actor } from '../access/actor';
import { Permission } from '../access/permissions';
import { notFound, ScopeService } from '../access/scope.service';
import { AuditService } from '../audit/audit.service';
import { RevenueService } from '../reconciliation/revenue.service';
import { calculateReview, Dec, FORMULA_VERSION, KpiInput, ReviewCalculation } from './calc';
import { CalculateBody, CreateKpiBody, PeriodQuery, UpdateKpiBody } from './dto';
import { OrgTree } from './org-tree';
import { PeriodsService, toPeriodView } from './periods.service';
import { PeriodRow, periodSpan, PlacementService } from './placement.service';
import { ReviewAccessPolicy } from './review-access.policy';

type Tx = Prisma.TransactionClient;
type Db = PrismaService | Tx;

interface LockedReview {
  id: string;
  status: 'DRAFT' | 'FINALIZED';
  unit_id: string;
}

interface RevenueSource {
  kpiId: string;
  unitId: string;
  unitIds: string[];
  amount: string;
  canonicalRunIds: string[];
}

const str = (d: Dec | Prisma.Decimal | null | undefined) => (d === null || d === undefined ? null : d.toString());

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: ScopeService,
    private readonly audit: AuditService,
    private readonly placement: PlacementService,
    private readonly periods: PeriodsService,
    private readonly revenue: RevenueService,
    private readonly policy: ReviewAccessPolicy,
  ) {}

  // ---------- Daftar ----------

  /**
   * Karyawan per periode dalam scope, berdasarkan unit rumah karyawan pada periode tsb (bukan riwayat
   * penempatan sepanjang masa). EMP-3 (pindah ke BR-B) tidak muncul untuk MANAGER-A.
   */
  async listForPeriod(actor: Actor, q: PeriodQuery) {
    const period = await this.periods.visible(actor, q.periodId, Permission.PerformanceAnalyticsRead);
    const scope = await this.scopes.resolve(actor, Permission.PerformanceAnalyticsRead);
    const tree = await OrgTree.load(this.prisma, period.organizationId);
    let allowed = (unitId: string) => scope.hasUnit(unitId);
    if (q.unitId) {
      scope.assertUnit(q.unitId, 'Unit');
      const sub = new Set(tree.subtree(q.unitId));
      allowed = (unitId) => scope.hasUnit(unitId) && sub.has(unitId);
    }
    const [homes, reviews, kpis] = await Promise.all([
      this.placement.homeUnits(period),
      this.prisma.performanceReview.findMany({ where: { periodId: period.id } }),
      this.prisma.kpiAssignment.groupBy({ by: ['employeeId'], where: { periodId: period.id }, _count: { _all: true }, _sum: { weight: true } }),
    ]);
    const reviewByEmp = new Map(reviews.map((r) => [r.employeeId, r]));
    const kpiByEmp = new Map(kpis.map((k) => [k.employeeId, k]));
    const candidates = [...homes.entries()]
      .map(([employeeId, home]) => ({ employeeId, unitId: reviewByEmp.get(employeeId)?.status === 'FINALIZED' ? reviewByEmp.get(employeeId)!.unitId : home }))
      .filter((r) => allowed(r.unitId));
    // Karyawan yang KPI-nya bersumber dari unit di luar scope dikecualikan seluruhnya (bukan disamarkan).
    const sources = await this.policy.sourceUnits(period.id, candidates.map((c) => c.employeeId), tree);
    const rows = candidates.filter((r) => ReviewAccessPolicy.covers(scope, sources.get(r.employeeId)!));
    const employees = await this.prisma.employee.findMany({
      where: { id: { in: rows.map((r) => r.employeeId) } },
      select: { id: true, externalKey: true, name: true },
    });
    const empById = new Map(employees.map((e) => [e.id, e]));
    const items = rows
      .map((r) => {
        const e = empById.get(r.employeeId)!;
        const review = reviewByEmp.get(r.employeeId);
        const k = kpiByEmp.get(r.employeeId);
        const u = tree.units.get(r.unitId)!;
        return {
          employee: { id: e.id, code: e.externalKey, name: e.name },
          unit: { id: u.id, code: u.code, name: u.name },
          reviewId: review?.id ?? null,
          status: review?.status ?? 'NOT_STARTED',
          totalScore: review?.status === 'FINALIZED' ? str(review.totalScore) : null,
          kpiCount: k?._count._all ?? 0,
          weightTotal: str(k?._sum.weight ?? new Prisma.Decimal(0)),
        };
      })
      .sort((a, b) => a.employee.code.localeCompare(b.employee.code));
    return { period: toPeriodView(period), items, total: items.length };
  }

  // ---------- Preview & detail ----------

  async calculate(actor: Actor, body: CalculateBody) {
    const period = await this.periods.visible(actor, body.periodId, Permission.ReviewManage);
    const home = await this.assertManageable(actor, body.employeeId, period);
    const review = await this.prisma.$transaction((tx) => this.lockReview(tx, period, body.employeeId, home));
    return this.view(review.id);
  }

  async detail(actor: Actor, id: string) {
    const review = await this.prisma.performanceReview.findUnique({ where: { id } });
    const scope = await this.scopes.resolve(actor, Permission.PerformanceAnalyticsRead);
    if (!review || !scope.hasUnit(review.unitId)) throw notFound('Review');
    await this.policy.assertCovered(scope, review.periodId, review.employeeId, await OrgTree.load(this.prisma, review.organizationId));
    return this.view(id);
  }

  // ---------- Finalisasi ----------

  /**
   * Satu transaksi: kunci review → tolak bila sudah final → kunci KPI → validasi → baca revenue dalam satu
   * statement (konsisten terhadap pergantian canonical) → simpan snapshot + audit. Finalisasi paralel:
   * yang kedua menunggu kunci lalu mendapat 409; unique (employee, periode) mencegah review ganda.
   */
  async finalize(actor: Actor, id: string, traceId?: string) {
    const existing = await this.prisma.performanceReview.findUnique({ where: { id } });
    const scope = await this.scopes.resolve(actor, Permission.ReviewManage);
    if (!existing || !scope.hasUnit(existing.unitId)) throw notFound('Review');
    const period = await this.prisma.reviewPeriod.findUniqueOrThrow({ where: { id: existing.periodId } });
    const tree = await OrgTree.load(this.prisma, period.organizationId);
    await this.policy.assertCovered(scope, period.id, existing.employeeId, tree);

    await this.prisma.$transaction(
      async (tx) => {
        const [locked] = await tx.$queryRaw<LockedReview[]>`
          SELECT id, status::text AS status, unit_id FROM performance_reviews WHERE id = ${id}::uuid FOR UPDATE`;
        if (locked.status === 'FINALIZED') {
          throw new AppException(HttpStatus.CONFLICT, 'REVIEW_ALREADY_FINALIZED', 'Review ini sudah difinalisasi');
        }
        const { calc, sources } = await this.compute(tx, existing.employeeId, period, tree, true);
        // Cek ulang setelah KPI terkunci: sumber yang benar-benar dijumlahkan harus dalam scope actor.
        if (!ReviewAccessPolicy.covers(scope, sources.flatMap((s) => s.unitIds))) throw notFound('Review');
        if (calc.problems.length > 0 || calc.totalScore === null) {
          throw new AppException(HttpStatus.CONFLICT, 'FINALIZE_REJECTED', 'Review belum bisa difinalisasi', {
            problems: calc.problems,
            weightTotal: calc.weightTotal.toString(),
          });
        }
        const runs = await tx.reconciliationRun.findMany({
          where: { id: { in: [...new Set(sources.flatMap((s) => s.canonicalRunIds))] } },
          select: { id: true, ruleVersion: true },
        });
        const ruleById = new Map(runs.map((r) => [r.id, r.ruleVersion]));
        const finalizedAt = new Date();
        await tx.reviewItem.deleteMany({ where: { reviewId: id } });
        await tx.reviewItem.createMany({
          data: calc.items.map((i) => ({
            reviewId: id,
            kpiAssignmentId: i.kpiId,
            kpiName: i.name,
            source: i.source as KpiSource,
            unitId: i.unitId,
            weight: new Prisma.Decimal(i.weight),
            target: new Prisma.Decimal(i.target),
            actual: new Prisma.Decimal(i.actual as string),
            achievement: new Prisma.Decimal(i.achievement!.toString()),
            cappedAchievement: new Prisma.Decimal(i.cappedAchievement!.toString()),
            weightedScore: new Prisma.Decimal(i.weightedScore!.toString()),
          })),
        });
        await tx.performanceReview.update({
          where: { id },
          data: {
            status: 'FINALIZED',
            totalScore: new Prisma.Decimal(calc.totalScore.toString()),
            formulaVersion: FORMULA_VERSION,
            calculatedAt: finalizedAt,
            finalizedAt,
            finalizedBy: actor.userId,
            provenance: {
              formulaVersion: FORMULA_VERSION,
              calculatedAt: finalizedAt.toISOString(),
              period: { ...periodSpan(period) },
              revenueSources: sources.map((s) => ({
                kpiId: s.kpiId,
                unitId: s.unitId,
                unitCode: tree.units.get(s.unitId)?.code ?? null,
                unitIds: s.unitIds,
                verifiedRevenue: s.amount,
                canonicalRunIds: s.canonicalRunIds,
                ruleVersions: [...new Set(s.canonicalRunIds.map((r) => ruleById.get(r)).filter((v): v is string => Boolean(v)))],
              })),
            },
          },
        });
        await this.audit.record(tx, {
          organizationId: period.organizationId,
          entityType: 'performance_review',
          entityId: id,
          actorUserId: actor.userId,
          eventType: 'REVIEW_FINALIZED',
          payload: { totalScore: calc.totalScore.toString(), formulaVersion: FORMULA_VERSION },
          traceId,
        });
      },
      { timeout: 30_000 },
    );
    return this.view(id);
  }

  // ---------- KPI ----------

  async createKpi(actor: Actor, body: CreateKpiBody, traceId?: string) {
    const period = await this.periods.visible(actor, body.periodId, Permission.ReviewManage);
    const home = await this.assertManageable(actor, body.employeeId, period);
    const employee = await this.prisma.employee.findUniqueOrThrow({ where: { id: body.employeeId } });
    if (employee.organizationId !== period.organizationId) throw notFound('Karyawan');
    await this.assertKpiSource(actor, period, home, body.source, body.unitId ?? null, body.actual);

    const kpiId = await this.prisma.$transaction(async (tx) => {
      const review = await this.lockReview(tx, period, body.employeeId, home);
      this.assertEditable(review);
      const kpi = await tx.kpiAssignment.create({
        data: {
          organizationId: period.organizationId,
          employeeId: body.employeeId,
          periodId: period.id,
          name: body.name,
          source: body.source,
          unitId: body.source === 'VERIFIED_UNIT_REVENUE' ? body.unitId : null,
          weight: new Prisma.Decimal(body.weight),
          target: new Prisma.Decimal(body.target),
          actual: body.source === 'MANUAL' && body.actual != null ? new Prisma.Decimal(body.actual) : null,
        },
      });
      await this.audit.record(tx, {
        organizationId: period.organizationId,
        entityType: 'kpi_assignment',
        entityId: kpi.id,
        actorUserId: actor.userId,
        eventType: 'KPI_CREATED',
        payload: { reviewId: review.id, name: body.name, source: body.source, weight: body.weight, target: body.target, actual: body.actual ?? null },
        traceId,
      });
      return kpi.id;
    });
    return { kpiId, review: await this.view((await this.prisma.performanceReview.findFirstOrThrow({ where: { employeeId: body.employeeId, periodId: period.id } })).id) };
  }

  async updateKpi(actor: Actor, id: string, body: UpdateKpiBody, traceId?: string) {
    const kpi = await this.prisma.kpiAssignment.findUnique({ where: { id } });
    if (!kpi) throw notFound('KPI');
    const period = await this.periods.visible(actor, kpi.periodId, Permission.ReviewManage);
    const home = await this.assertManageable(actor, kpi.employeeId, period);
    if (kpi.source === 'VERIFIED_UNIT_REVENUE' && body.actual !== undefined) {
      throw new AppException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Actual KPI revenue diambil otomatis dari revenue terverifikasi unit dan tidak bisa diisi manual');
    }
    await this.prisma.$transaction(async (tx) => {
      const review = await this.lockReview(tx, period, kpi.employeeId, home);
      this.assertEditable(review);
      await tx.kpiAssignment.update({
        where: { id },
        data: {
          name: body.name,
          weight: body.weight !== undefined ? new Prisma.Decimal(body.weight) : undefined,
          target: body.target !== undefined ? new Prisma.Decimal(body.target) : undefined,
          actual: body.actual === undefined ? undefined : body.actual === null ? null : new Prisma.Decimal(body.actual),
        },
      });
      await this.audit.record(tx, {
        organizationId: period.organizationId,
        entityType: 'kpi_assignment',
        entityId: id,
        actorUserId: actor.userId,
        eventType: 'KPI_UPDATED',
        payload: { reviewId: review.id, changes: { ...body } },
        traceId,
      });
    });
    const review = await this.prisma.performanceReview.findFirstOrThrow({ where: { employeeId: kpi.employeeId, periodId: period.id } });
    return { kpiId: id, review: await this.view(review.id) };
  }

  // ---------- Internal ----------

  /** Karyawan harus ditempatkan di periode itu dan unit rumahnya dalam scope review.manage; selain itu 404. */
  private async assertManageable(actor: Actor, employeeId: string, period: PeriodRow): Promise<string> {
    const scope = await this.scopes.resolve(actor, Permission.ReviewManage);
    const existing = await this.prisma.performanceReview.findUnique({ where: { employeeId_periodId: { employeeId, periodId: period.id } } });
    const home = existing?.status === 'FINALIZED' ? existing.unitId : await this.placement.homeUnit(employeeId, period);
    if (!home || !scope.hasUnit(home)) throw notFound('Karyawan');
    await this.policy.assertCovered(scope, period.id, employeeId, await OrgTree.load(this.prisma, period.organizationId));
    return home;
  }

  /**
   * KPI revenue harus menunjuk unit rumah karyawan atau turunannya (dan dalam scope), agar pembaca review
   * tidak melihat revenue unit lain. KPI manual tidak boleh punya unit; KPI revenue tidak boleh punya actual.
   */
  private async assertKpiSource(actor: Actor, period: PeriodRow, home: string, source: KpiSource, unitId: string | null, actual?: string | null) {
    if (source === 'MANUAL') {
      if (unitId) throw new AppException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'KPI manual tidak memakai unitId');
      return;
    }
    if (!unitId) throw new AppException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'KPI revenue wajib memilih unitId');
    if (actual != null) throw new AppException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Actual KPI revenue diambil otomatis dari revenue terverifikasi unit');
    const scope = await this.scopes.resolve(actor, Permission.ReviewManage);
    const tree = await OrgTree.load(this.prisma, period.organizationId);
    // Actual dihitung dari unit + seluruh turunannya → seluruh subtree wajib dalam scope (bukan unitnya saja).
    if (!ReviewAccessPolicy.covers(scope, tree.subtree(unitId))) throw notFound('Unit');
    if (!tree.subtree(home).includes(unitId)) {
      throw new AppException(HttpStatus.BAD_REQUEST, 'KPI_UNIT_OUT_OF_RANGE', 'Unit revenue KPI harus unit penempatan karyawan atau turunannya');
    }
  }

  private assertEditable(review: LockedReview) {
    if (review.status === 'FINALIZED') {
      throw new AppException(HttpStatus.CONFLICT, 'REVIEW_FINALIZED', 'Review sudah final; KPI periode ini tidak bisa diubah');
    }
  }

  /** Pastikan baris review ada (DRAFT) lalu kunci. Urutan kunci: review → KPI (sama dengan finalisasi). */
  private async lockReview(tx: Tx, period: PeriodRow, employeeId: string, home: string): Promise<LockedReview> {
    await tx.$executeRaw`
      INSERT INTO performance_reviews (id, organization_id, employee_id, period_id, unit_id, status, formula_version)
      VALUES (gen_random_uuid(), ${period.organizationId}::uuid, ${employeeId}::uuid, ${period.id}::uuid, ${home}::uuid, 'DRAFT', ${FORMULA_VERSION})
      ON CONFLICT (employee_id, period_id) DO NOTHING`;
    const [row] = await tx.$queryRaw<LockedReview[]>`
      SELECT id, status::text AS status, unit_id FROM performance_reviews
      WHERE employee_id = ${employeeId}::uuid AND period_id = ${period.id}::uuid FOR UPDATE`;
    if (row.status === 'DRAFT' && row.unit_id !== home) {
      await tx.performanceReview.update({ where: { id: row.id }, data: { unitId: home } });
      row.unit_id = home;
    }
    return row;
  }

  private async compute(db: Db, employeeId: string, period: PeriodRow, tree: OrgTree, lock: boolean): Promise<{ calc: ReviewCalculation; sources: RevenueSource[] }> {
    if (lock) {
      await (db as Tx).$queryRaw`SELECT id FROM kpi_assignments WHERE employee_id = ${employeeId}::uuid AND period_id = ${period.id}::uuid ORDER BY id FOR UPDATE`;
    }
    const kpis = await db.kpiAssignment.findMany({ where: { employeeId, periodId: period.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const span = periodSpan(period);
    const revenueKpis = kpis.filter((k) => k.source === 'VERIFIED_UNIT_REVENUE' && k.unitId);
    const groups = revenueKpis.map((k) => ({ key: k.id, unitIds: tree.subtree(k.unitId!) }));
    const revenue = await this.revenue.verifiedForGroups(groups, span.startDate, span.endDateExclusive, db);
    const byKpi = new Map(revenue.map((r) => [r.key, r]));
    const inputs: KpiInput[] = kpis.map((k) => ({
      kpiId: k.id,
      name: k.name,
      source: k.source,
      unitId: k.unitId,
      weight: k.weight.toString(),
      target: k.target.toString(),
      actual: k.source === 'VERIFIED_UNIT_REVENUE' ? (byKpi.get(k.id)?.amount ?? '0') : (k.actual?.toString() ?? null),
    }));
    const sources = revenueKpis.map((k) => ({ kpiId: k.id, unitId: k.unitId!, unitIds: groups.find((g) => g.key === k.id)!.unitIds, amount: byKpi.get(k.id)!.amount, canonicalRunIds: byKpi.get(k.id)!.canonicalRunIds }));
    return { calc: calculateReview(inputs), sources };
  }

  /** FINAL → snapshot tersimpan (tidak dihitung ulang). DRAFT → preview langsung dari KPI & revenue saat ini. */
  private async view(id: string) {
    const review = await this.prisma.performanceReview.findUniqueOrThrow({
      where: { id },
      include: { employee: { select: { id: true, externalKey: true, name: true } }, period: true, items: { orderBy: { id: 'asc' } } },
    });
    const tree = await OrgTree.load(this.prisma, review.organizationId);
    const unitLabel = (uid: string | null) => {
      const u = uid ? tree.units.get(uid) : undefined;
      return u ? { id: u.id, code: u.code, name: u.name } : null;
    };
    const base = {
      id: review.id,
      status: review.status,
      employee: { id: review.employee.id, code: review.employee.externalKey, name: review.employee.name },
      unit: unitLabel(review.unitId),
      period: toPeriodView(review.period),
    };
    if (review.status === 'FINALIZED') {
      const kpiIds = review.items.map((i) => i.kpiAssignmentId);
      const order = await this.prisma.kpiAssignment.findMany({ where: { id: { in: kpiIds } }, select: { id: true, createdAt: true } });
      const rank = new Map(order.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)).map((k, i) => [k.id, i]));
      const items = [...review.items].sort((a, b) => (rank.get(a.kpiAssignmentId) ?? 0) - (rank.get(b.kpiAssignmentId) ?? 0));
      return {
        ...base,
        formulaVersion: review.formulaVersion,
        isSnapshot: true,
        items: items.map((i) => ({
          kpiId: i.kpiAssignmentId,
          name: i.kpiName,
          source: i.source,
          unit: unitLabel(i.unitId),
          weight: str(i.weight),
          target: str(i.target),
          actual: str(i.actual),
          achievement: str(i.achievement),
          cappedAchievement: str(i.cappedAchievement),
          weightedScore: str(i.weightedScore),
        })),
        weightTotal: items.reduce((s, i) => s.plus(i.weight.toString()), new Dec(0)).toString(),
        totalScore: str(review.totalScore),
        problems: [],
        canFinalize: false,
        finalizedAt: review.finalizedAt?.toISOString() ?? null,
        provenance: review.provenance,
      };
    }
    const { calc } = await this.compute(this.prisma, review.employeeId, review.period, tree, false);
    return {
      ...base,
      formulaVersion: calc.formulaVersion,
      isSnapshot: false,
      items: calc.items.map((i) => ({
        kpiId: i.kpiId,
        name: i.name,
        source: i.source,
        unit: unitLabel(i.unitId),
        weight: i.weight,
        target: i.target,
        actual: i.actual,
        achievement: str(i.achievement),
        cappedAchievement: str(i.cappedAchievement),
        weightedScore: str(i.weightedScore),
      })),
      weightTotal: calc.weightTotal.toString(),
      totalScore: str(calc.totalScore),
      problems: calc.problems,
      canFinalize: calc.problems.length === 0,
      finalizedAt: null,
      provenance: null,
    };
  }
}

