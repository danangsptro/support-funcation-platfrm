export interface Period {
  id: string;
  code: string;
  startDate: string;
  endDateExclusive: string;
  days: number;
}

export interface Metrics {
  verifiedRevenue: string;
  recordedRevenue: string;
  employeeDays: number;
  averageHeadcount: string;
  rpe: string | null;
  canonicalRunIds: string[];
}

export interface RpeUnit {
  unit: { id: string; code: string; name: string; type: string; parentId: string | null };
  own: Metrics;
  hasChildren: boolean;
  subtotal: Metrics | null;
  subtotalUnavailableReason: string | null;
  benchmark: { parentUnitId: string; parentRpe: string | null; difference: string | null; index: string | null } | null;
  benchmarkUnavailableReason: string | null;
}

export interface RpeResponse {
  period: Period;
  units: RpeUnit[];
  organizationTotal: Metrics | null;
  branchSpread: { highest: { unitId: string; rpe: string }; lowest: { unitId: string; rpe: string }; difference: string; branchesWithoutRpe: string[] } | null;
}

export type BandKey = 'BELOW_60' | 'FROM_60' | 'FROM_80' | 'FROM_100';

export interface Distribution {
  count: number;
  bands: Record<BandKey, number>;
  average: string | null;
  median: string | null;
}

export interface PerformanceResponse {
  period: Period;
  bands: { key: BandKey; label: string }[];
  withinScope: Distribution;
  units: ({ unit: { id: string; code: string; name: string } } & Distribution)[];
}

export interface ReviewListItem {
  employee: { id: string; code: string; name: string };
  unit: { id: string; code: string; name: string };
  reviewId: string | null;
  status: 'NOT_STARTED' | 'DRAFT' | 'FINALIZED';
  totalScore: string | null;
  kpiCount: number;
  weightTotal: string;
}

export interface ReviewItem {
  kpiId: string;
  name: string;
  source: 'MANUAL' | 'VERIFIED_UNIT_REVENUE';
  unit: { id: string; code: string; name: string } | null;
  weight: string;
  target: string;
  actual: string | null;
  achievement: string | null;
  cappedAchievement: string | null;
  weightedScore: string | null;
}

export interface Review {
  id: string;
  status: 'DRAFT' | 'FINALIZED';
  employee: { id: string; code: string; name: string };
  unit: { id: string; code: string; name: string } | null;
  period: Period;
  formulaVersion: string;
  isSnapshot: boolean;
  items: ReviewItem[];
  weightTotal: string;
  totalScore: string | null;
  problems: ('NO_KPI' | 'WEIGHT_TOTAL_NOT_100' | 'MISSING_ACTUAL')[];
  canFinalize: boolean;
  finalizedAt: string | null;
  provenance: { revenueSources: { kpiId: string; unitCode: string | null; verifiedRevenue: string; ruleVersions: string[] }[] } | null;
}
