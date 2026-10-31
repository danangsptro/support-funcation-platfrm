export type Side = 'INTERNAL' | 'EXTERNAL';
export type MatchStatus = 'MATCHED' | 'MISMATCHED' | 'MISSING_IN_INTERNAL' | 'MISSING_IN_EXTERNAL';

export interface Dataset {
  id: string;
  unit: { id: string; code: string; name: string };
  organization: { id: string; code: string; name: string };
  accountId: string;
  side: Side;
  rowCount: number;
  sourceFilename: string | null;
  createdAt: string;
}

export interface ImportRowError {
  line: number;
  transactionId: string | null;
  code: string;
  message: string;
}

export interface Run {
  id: string;
  ruleVersion: string;
  dateToleranceDays: number;
  unit: { id: string; code: string; name: string } | null;
  accountId: string;
  internalDatasetId: string;
  externalDatasetId: string;
  groups: number;
  isCanonical: boolean;
  createdAt: string;
}

export interface RunSummary {
  runId: string;
  ruleVersion: string;
  groups: number;
  counts: Record<MatchStatus, number>;
  byReason: Record<string, number>;
  matchedRatioPercentDisplay: string | null;
  verifiedRevenue: string;
  anomalousInternalTotal: string;
  anomalousExternalTotal: string;
  uniquePairAmountDifferenceTotal: string;
  isCanonical: boolean;
}

export interface ResultTx {
  id: string;
  transactionId: string;
  transactionDate: string;
  amount: string;
}

export interface ResultGroup {
  id: string;
  reference: string;
  status: MatchStatus;
  statusLabel: string;
  reason: string | null;
  internal: ResultTx[];
  external: ResultTx[];
  amountDifference: string | null;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
