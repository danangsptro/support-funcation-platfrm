import Decimal from 'decimal.js';
import { MatchReason, MatchRule, MatchStatusCode } from './rules';

export interface MatchInput {
  /** ID internal (UUID DB) — dipakai untuk menyimpan item hasil. */
  id: string;
  sourceTransactionId: string;
  organizationId: string;
  unitId: string;
  accountId: string;
  currency: string;
  reference: string;
  /** Business date YYYY-MM-DD (tanpa timezone). */
  transactionDate: string;
  amount: string;
}

export interface MatchGroup {
  matchKey: string;
  reference: string;
  status: MatchStatusCode;
  reason: MatchReason | null;
  internal: MatchInput[];
  external: MatchInput[];
  internalAmountTotal: Decimal;
  externalAmountTotal: Decimal;
  /** |internal − eksternal| hanya untuk pasangan 1:1; null untuk missing/duplicate. */
  amountDifference: Decimal | null;
}

export function matchKey(t: MatchInput): string {
  return [t.organizationId, t.unitId, t.accountId, t.currency, t.reference.trim()].join('|');
}

function dayNumber(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

const bySource = (a: MatchInput, b: MatchInput) => a.sourceTransactionId.localeCompare(b.sourceTransactionId);

/**
 * Matching one-to-one deterministik. Prioritas: duplicate → missing → amount → date → matched.
 * Grup dengan referensi ganda TIDAK dipasangkan (tidak ada pemilihan acak); semua anggota disimpan.
 * Hasil diurutkan berdasarkan matchKey sehingga urutan input tidak memengaruhi output.
 */
export function reconcile(internal: MatchInput[], external: MatchInput[], rule: MatchRule): MatchGroup[] {
  const groups = new Map<string, { internal: MatchInput[]; external: MatchInput[] }>();
  const add = (t: MatchInput, side: 'internal' | 'external') => {
    const key = matchKey(t);
    const g = groups.get(key) ?? { internal: [], external: [] };
    g[side].push(t);
    groups.set(key, g);
  };
  internal.forEach((t) => add(t, 'internal'));
  external.forEach((t) => add(t, 'external'));

  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, g]) => {
      const ints = [...g.internal].sort(bySource);
      const exts = [...g.external].sort(bySource);
      const internalAmountTotal = ints.reduce((s, t) => s.plus(t.amount), new Decimal(0));
      const externalAmountTotal = exts.reduce((s, t) => s.plus(t.amount), new Decimal(0));
      const base = {
        matchKey: key,
        reference: (ints[0] ?? exts[0]).reference.trim(),
        internal: ints,
        external: exts,
        internalAmountTotal,
        externalAmountTotal,
      };
      if (ints.length > 1 || exts.length > 1) {
        return { ...base, status: 'MISMATCHED', reason: 'DUPLICATE_REFERENCE', amountDifference: null } as MatchGroup;
      }
      if (ints.length === 0) return { ...base, status: 'MISSING_IN_INTERNAL', reason: 'NO_INTERNAL', amountDifference: null } as MatchGroup;
      if (exts.length === 0) return { ...base, status: 'MISSING_IN_EXTERNAL', reason: 'NO_EXTERNAL', amountDifference: null } as MatchGroup;

      const amountDifference = new Decimal(ints[0].amount).minus(exts[0].amount).abs();
      if (amountDifference.greaterThan(rule.amountTolerance)) {
        return { ...base, status: 'MISMATCHED', reason: 'AMOUNT_DIFFERENCE', amountDifference } as MatchGroup;
      }
      const dayDiff = Math.abs(dayNumber(ints[0].transactionDate) - dayNumber(exts[0].transactionDate));
      if (dayDiff > rule.dateToleranceDays) {
        return { ...base, status: 'MISMATCHED', reason: 'DATE_OUTSIDE_TOLERANCE', amountDifference } as MatchGroup;
      }
      return { ...base, status: 'MATCHED', reason: null, amountDifference } as MatchGroup;
    });
}

export interface RunSummaryNumbers {
  groups: number;
  counts: Record<MatchStatusCode, number>;
  byReason: Record<string, number>;
  verifiedRevenue: Decimal;
  anomalousInternalTotal: Decimal;
  anomalousExternalTotal: Decimal;
  uniquePairAmountDifferenceTotal: Decimal;
}

/** Ringkasan dari grup; angka anomali internal & eksternal dipisah dan tidak dijumlahkan. */
export function summarize(groups: Pick<MatchGroup, 'status' | 'reason' | 'internalAmountTotal' | 'externalAmountTotal' | 'amountDifference'>[]): RunSummaryNumbers {
  const counts: Record<MatchStatusCode, number> = { MATCHED: 0, MISMATCHED: 0, MISSING_IN_INTERNAL: 0, MISSING_IN_EXTERNAL: 0 };
  const byReason: Record<string, number> = {};
  let verifiedRevenue = new Decimal(0);
  let anomalousInternalTotal = new Decimal(0);
  let anomalousExternalTotal = new Decimal(0);
  let uniquePairAmountDifferenceTotal = new Decimal(0);
  for (const g of groups) {
    counts[g.status] += 1;
    if (g.reason) byReason[g.reason] = (byReason[g.reason] ?? 0) + 1;
    if (g.status === 'MATCHED') {
      verifiedRevenue = verifiedRevenue.plus(g.internalAmountTotal);
      continue;
    }
    anomalousInternalTotal = anomalousInternalTotal.plus(g.internalAmountTotal);
    anomalousExternalTotal = anomalousExternalTotal.plus(g.externalAmountTotal);
    if (g.status === 'MISMATCHED' && g.amountDifference !== null) {
      uniquePairAmountDifferenceTotal = uniquePairAmountDifferenceTotal.plus(g.amountDifference);
    }
  }
  return { groups: groups.length, counts, byReason, verifiedRevenue, anomalousInternalTotal, anomalousExternalTotal, uniquePairAmountDifferenceTotal };
}
