import Decimal from 'decimal.js';

export interface MatchRule {
  version: string;
  /** Selisih hari maksimum yang masih diterima (inklusif). */
  dateToleranceDays: number;
  /** Selisih nominal maksimum yang masih diterima (inklusif). */
  amountTolerance: Decimal;
}

/** Versi aturan bersifat immutable: hasil run selalu bisa ditelusuri ke definisi ini. */
export const MATCH_RULES: Record<string, MatchRule> = {
  v1: { version: 'v1', dateToleranceDays: 1, amountTolerance: new Decimal(0) },
  v2: { version: 'v2', dateToleranceDays: 2, amountTolerance: new Decimal(0) },
};

export const RULE_VERSIONS = Object.keys(MATCH_RULES);

export const STATUS_LABEL = {
  MATCHED: 'Matched',
  MISMATCHED: 'Mismatched',
  MISSING_IN_INTERNAL: 'Missing in Internal',
  MISSING_IN_EXTERNAL: 'Missing in External',
} as const;

export type MatchStatusCode = keyof typeof STATUS_LABEL;

export type MatchReason = 'DUPLICATE_REFERENCE' | 'NO_INTERNAL' | 'NO_EXTERNAL' | 'AMOUNT_DIFFERENCE' | 'DATE_OUTSIDE_TOLERANCE';
