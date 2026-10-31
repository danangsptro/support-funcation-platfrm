import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { Actor } from '../access/actor';
import { Permission } from '../access/permissions';
import { AccessScope, ScopeService } from '../access/scope.service';
import { RevenueService } from '../reconciliation/revenue.service';
import { Dec, employeeDaysByUnit, median, RpeMetrics, rpeMetrics, SCORE_BANDS, scoreBand } from './calc';
import { PeriodQuery } from './dto';
import { OrgTree } from './org-tree';
import { PeriodsService, toPeriodView } from './periods.service';
import { periodSpan, PlacementService } from './placement.service';
import { ReviewAccessPolicy } from './review-access.policy';

const metricsView = (m: RpeMetrics, canonicalRunIds: string[] = []) => ({
  verifiedRevenue: m.verifiedRevenue.toString(),
  recordedRevenue: m.recordedRevenue.toString(),
  employeeDays: m.employeeDays,
  averageHeadcount: m.averageHeadcount.toString(),
  rpe: m.rpe?.toString() ?? null,
  canonicalRunIds,
});

/** Unit yang ditampilkan: dalam scope, dan (bila ada filter) di dalam subtree unit filter. */
function visibleUnits(scope: AccessScope, tree: OrgTree, unitId?: string): string[] {
  if (unitId) scope.assertUnit(unitId, 'Unit');
  const candidates = unitId ? tree.subtree(unitId) : [...tree.units.keys()];
  return candidates.filter((u) => scope.hasUnit(u));
}

@Injectable()
export class PerformanceAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: ScopeService,
    private readonly periods: PeriodsService,
    private readonly placement: PlacementService,
    private readonly revenue: RevenueService,
  ) {}

  /**
   * RPE per unit dalam scope. `own` = unit itu sendiri; `subtotal` = unit + seluruh turunan, HANYA bila
   * seluruh turunan ada di scope pembaca (selain itu null + alasan) — agregat parsial tidak pernah disebut
   * total. Benchmark induk hanya bila subtotal induk tersedia bagi pembaca. Ratio of sums, Decimal.
   */
  async revenuePerEmployee(actor: Actor, q: PeriodQuery) {
    const period = await this.periods.visible(actor, q.periodId, Permission.RevenueAnalyticsRead);
    const scope = await this.scopes.resolve(actor, Permission.RevenueAnalyticsRead);
    const tree = await OrgTree.load(this.prisma, period.organizationId);
    const span = periodSpan(period);
    const days = toPeriodView(period).days;
    const units = visibleUnits(scope, tree, q.unitId);

    const complete = (u: string) => tree.subtree(u).every((x) => scope.hasUnit(x));
    const parentAvailable = (p: string | null): p is string => p !== null && scope.hasUnit(p) && complete(p);
    // Subtotal untuk unit yang ditampilkan + induk yang dipakai sebagai benchmark (walau tersaring filter).
    const benchmarkParents = units.map((u) => tree.units.get(u)!.parentId).filter(parentAvailable);
    const withSubtotal = [...new Set([...units.filter((u) => tree.hasChildren(u) && complete(u)), ...benchmarkParents])];
    const orgWide = scope.orgWideOrganizationIds.includes(period.organizationId) && !q.unitId;
    const groups = [
      ...units.map((u) => ({ key: `own:${u}`, unitIds: [u] })),
      ...withSubtotal.map((u) => ({ key: `sub:${u}`, unitIds: tree.subtree(u) })),
      ...(orgWide ? [{ key: 'org', unitIds: [...tree.units.keys()] }] : []),
    ];
    const [verified, recorded, spans] = await Promise.all([
      this.revenue.verifiedForGroups(groups, span.startDate, span.endDateExclusive),
      this.revenue.recordedForGroups(groups, span.startDate, span.endDateExclusive),
      this.placement.spans({ organizationId: period.organizationId }, period),
    ]);
    const dayMap = employeeDaysByUnit(spans, span);
    const v = new Map(verified.map((r) => [r.key, r]));
    const r = new Map(recorded.map((x) => [x.key, x.amount]));
    const metrics = (key: string, unitIds: string[]) => {
      const m = rpeMetrics(new Dec(v.get(key)!.amount), new Dec(r.get(key)!), unitIds.reduce((s, u) => s + (dayMap.get(u) ?? 0), 0), days);
      return { m, view: metricsView(m, v.get(key)!.canonicalRunIds) };
    };

    const subtotalRpe = new Map<string, Dec | null>();
    const rows = units.map((u) => {
      const unit = tree.units.get(u)!;
      const own = metrics(`own:${u}`, [u]);
      const sub = tree.hasChildren(u) ? (complete(u) ? metrics(`sub:${u}`, tree.subtree(u)) : null) : own;
      subtotalRpe.set(u, sub?.m.rpe ?? null);
      return { unit, own, sub };
    });

    const items = rows.map(({ unit, own, sub }) => {
      const parent = unit.parentId;
      const hasParentBenchmark = parentAvailable(parent);
      let benchmark = null;
      if (hasParentBenchmark) {
        const parentRpe = subtotalRpe.has(parent) ? subtotalRpe.get(parent)! : metrics(`sub:${parent}`, tree.subtree(parent)).m.rpe;
        const mine = sub?.m.rpe ?? null;
        benchmark = {
          parentUnitId: parent,
          parentRpe: parentRpe?.toString() ?? null,
          difference: mine && parentRpe ? mine.minus(parentRpe).toString() : null,
          index: mine && parentRpe && !parentRpe.isZero() ? mine.div(parentRpe).toString() : null,
        };
      }
      return {
        unit: { id: unit.id, code: unit.code, name: unit.name, type: unit.type, parentId: parent && scope.hasUnit(parent) ? parent : null },
        own: own.view,
        hasChildren: tree.hasChildren(unit.id),
        subtotal: sub?.view ?? null,
        subtotalUnavailableReason: sub ? null : 'PARTIAL_SCOPE',
        benchmark,
        benchmarkUnavailableReason: parent === null ? 'NO_PARENT' : hasParentBenchmark ? null : 'PARENT_OUT_OF_SCOPE',
      };
    });

    const branches = items.filter((i) => i.unit.type === 'BRANCH' && i.subtotal?.rpe != null);
    const sorted = [...branches].sort((a, b) => new Dec(b.subtotal!.rpe!).comparedTo(new Dec(a.subtotal!.rpe!)));
    const branchSpread =
      sorted.length >= 2
        ? {
            highest: { unitId: sorted[0].unit.id, rpe: sorted[0].subtotal!.rpe },
            lowest: { unitId: sorted[sorted.length - 1].unit.id, rpe: sorted[sorted.length - 1].subtotal!.rpe },
            difference: new Dec(sorted[0].subtotal!.rpe!).minus(sorted[sorted.length - 1].subtotal!.rpe!).toString(),
            branchesWithoutRpe: items.filter((i) => i.unit.type === 'BRANCH' && i.subtotal?.rpe == null).map((i) => i.unit.id),
          }
        : null;

    return {
      period: toPeriodView(period),
      units: items,
      organizationTotal: orgWide ? metrics('org', [...tree.units.keys()]).view : null,
      branchSpread,
    };
  }

  /** Distribusi skor review FINAL per unit (unit review = unit rumah saat finalisasi) dalam scope. */
  async performance(actor: Actor, q: PeriodQuery) {
    const period = await this.periods.visible(actor, q.periodId, Permission.PerformanceAnalyticsRead);
    const scope = await this.scopes.resolve(actor, Permission.PerformanceAnalyticsRead);
    const tree = await OrgTree.load(this.prisma, period.organizationId);
    const units = visibleUnits(scope, tree, q.unitId);
    const finals = await this.prisma.performanceReview.findMany({
      where: { periodId: period.id, status: 'FINALIZED', unitId: { in: units } },
      select: { unitId: true, totalScore: true, provenance: true },
    });
    // Review yang sumber KPI-nya di luar scope tidak dihitung (jumlah & skor pun tidak boleh bocor).
    const reviews = finals.filter((r) => ReviewAccessPolicy.covers(scope, ReviewAccessPolicy.snapshotUnits(r.provenance)));
    const summarize = (scores: Dec[]) => {
      const bands = Object.fromEntries(SCORE_BANDS.map((b) => [b.key, 0])) as Record<(typeof SCORE_BANDS)[number]['key'], number>;
      for (const s of scores) bands[scoreBand(s)] += 1;
      return {
        count: scores.length,
        bands,
        average: scores.length ? scores.reduce((a, b) => a.plus(b), new Dec(0)).div(scores.length).toString() : null,
        median: median(scores)?.toString() ?? null,
      };
    };
    const byUnit = new Map<string, Dec[]>();
    for (const r of reviews) byUnit.set(r.unitId, [...(byUnit.get(r.unitId) ?? []), new Dec(r.totalScore!.toString())]);
    return {
      period: toPeriodView(period),
      bands: SCORE_BANDS,
      /** Hanya review dalam cakupan pembaca — bukan total organisasi/divisi. */
      withinScope: summarize(reviews.map((r) => new Dec(r.totalScore!.toString()))),
      units: units
        .filter((u) => byUnit.has(u))
        .map((u) => {
          const unit = tree.units.get(u)!;
          return { unit: { id: unit.id, code: unit.code, name: unit.name, type: unit.type }, ...summarize(byUnit.get(u)!) };
        }),
    };
  }
}
