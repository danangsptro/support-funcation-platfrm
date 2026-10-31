import Decimal from 'decimal.js';

/** Decimal presisi tinggi untuk kalkulasi performa; pembulatan hanya di tampilan (frontend). */
export const Dec = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof Dec>;

export const FORMULA_VERSION = 'kpi-v1';
export const ACHIEVEMENT_CAP = new Dec(120);

export interface KpiInput {
  kpiId: string;
  name: string;
  source: 'MANUAL' | 'VERIFIED_UNIT_REVENUE';
  unitId: string | null;
  weight: string;
  target: string;
  /** null = belum diisi (MANUAL) atau belum ada data revenue. */
  actual: string | null;
}

export interface KpiScore extends KpiInput {
  achievement: Dec | null;
  cappedAchievement: Dec | null;
  weightedScore: Dec | null;
}

export type FinalizeProblem = 'NO_KPI' | 'WEIGHT_TOTAL_NOT_100' | 'MISSING_ACTUAL';

export interface ReviewCalculation {
  formulaVersion: string;
  items: KpiScore[];
  weightTotal: Dec;
  totalScore: Dec | null;
  problems: FinalizeProblem[];
}

/**
 * achievement = actual / target × 100; capped = min(achievement, 120); weighted = capped × bobot / 100;
 * skor = Σ weighted. Tanpa pembulatan antara. Skor total null bila ada actual yang kosong.
 */
export function calculateReview(kpis: KpiInput[]): ReviewCalculation {
  const items = kpis.map((k): KpiScore => {
    if (k.actual === null) return { ...k, achievement: null, cappedAchievement: null, weightedScore: null };
    const achievement = new Dec(k.actual).div(k.target).times(100);
    const cappedAchievement = Dec.min(achievement, ACHIEVEMENT_CAP);
    return { ...k, achievement, cappedAchievement, weightedScore: cappedAchievement.times(k.weight).div(100) };
  });
  const weightTotal = kpis.reduce((s, k) => s.plus(k.weight), new Dec(0));
  const problems: FinalizeProblem[] = [];
  if (kpis.length === 0) problems.push('NO_KPI');
  if (kpis.length > 0 && !weightTotal.equals(100)) problems.push('WEIGHT_TOTAL_NOT_100');
  if (items.some((i) => i.weightedScore === null)) problems.push('MISSING_ACTUAL');
  const totalScore = items.length > 0 && items.every((i) => i.weightedScore !== null)
    ? items.reduce((s, i) => s.plus(i.weightedScore as Dec), new Dec(0))
    : null;
  return { formulaVersion: FORMULA_VERSION, items, weightTotal, totalScore, problems };
}

// ---------- Penempatan & headcount ----------

export interface AssignmentSpan {
  employeeId: string;
  unitId: string;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD eksklusif; null = masih aktif. */
  endDateExclusive: string | null;
  isPrimary: boolean;
}

export interface PeriodSpan {
  startDate: string;
  endDateExclusive: string;
}

const dayNo = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

export function periodDays(p: PeriodSpan): number {
  return dayNo(p.endDateExclusive) - dayNo(p.startDate);
}

/** Jumlah hari irisan [start, end) penempatan dengan [periodStart, periodEnd). */
export function overlapDays(a: AssignmentSpan, p: PeriodSpan): number {
  const start = Math.max(dayNo(a.startDate), dayNo(p.startDate));
  const end = Math.min(a.endDateExclusive ? dayNo(a.endDateExclusive) : Infinity, dayNo(p.endDateExclusive));
  return Math.max(0, end - start);
}

/**
 * Employee-days per unit (hanya penempatan primer). Penempatan primer tidak overlap (constraint DB),
 * sehingga satu karyawan dihitung paling banyak satu kali per hari — pindah tengah periode tidak ganda.
 */
export function employeeDaysByUnit(assignments: AssignmentSpan[], p: PeriodSpan): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of assignments) {
    if (!a.isPrimary) continue;
    const days = overlapDays(a, p);
    if (days > 0) out.set(a.unitId, (out.get(a.unitId) ?? 0) + days);
  }
  return out;
}

/**
 * Unit "rumah" karyawan untuk sebuah periode: penempatan primer terakhir yang beririsan dengan periode
 * (tanggal mulai paling akhir). EMP-3 pindah BR-A → BR-B pada 16 Sep → BR-B.
 * Dipakai sebagai dasar scope review & KPI. null bila tidak ditempatkan sama sekali di periode itu.
 */
export function homeUnitForPeriod(assignments: AssignmentSpan[], p: PeriodSpan): string | null {
  const overlapping = assignments.filter((a) => a.isPrimary && overlapDays(a, p) > 0);
  overlapping.sort((a, b) => (a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : 0));
  return overlapping[0]?.unitId ?? null;
}

export interface RpeMetrics {
  verifiedRevenue: Dec;
  recordedRevenue: Dec;
  employeeDays: number;
  periodDays: number;
  averageHeadcount: Dec;
  /** null bila headcount 0 (tampil "N/A"). */
  rpe: Dec | null;
}

/**
 * RPE = verified revenue / average headcount = revenue × hari periode / employee-days
 * (bentuk kedua dipakai agar tidak ada pembagian berulang yang menimbulkan pembulatan).
 * Agregat induk dihitung dari jumlah revenue dan jumlah employee-days (ratio of sums), bukan rata-rata RPE.
 */
export function rpeMetrics(verified: Dec, recorded: Dec, employeeDays: number, days: number): RpeMetrics {
  return {
    verifiedRevenue: verified,
    recordedRevenue: recorded,
    employeeDays,
    periodDays: days,
    averageHeadcount: new Dec(employeeDays).div(days),
    rpe: employeeDays === 0 ? null : verified.times(days).div(employeeDays),
  };
}

// ---------- Distribusi skor ----------

export const SCORE_BANDS = [
  { key: 'BELOW_60', label: '< 60', min: null, max: 60 },
  { key: 'FROM_60', label: '60 – < 80', min: 60, max: 80 },
  { key: 'FROM_80', label: '80 – < 100', min: 80, max: 100 },
  { key: 'FROM_100', label: '≥ 100', min: 100, max: null },
] as const;

export function scoreBand(score: Dec): (typeof SCORE_BANDS)[number]['key'] {
  if (score.lessThan(60)) return 'BELOW_60';
  if (score.lessThan(80)) return 'FROM_60';
  if (score.lessThan(100)) return 'FROM_80';
  return 'FROM_100';
}

export function median(values: Dec[]): Dec | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a.comparedTo(b));
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : sorted[mid - 1].plus(sorted[mid]).div(2);
}
