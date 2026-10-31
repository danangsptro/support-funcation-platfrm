export type ApprovalStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED';
export type StepStatus = 'WAITING' | 'ACTIVE' | 'APPROVED' | 'REJECTED';

export interface UserRef {
  id: string;
  email: string;
}

export interface RequestSummary {
  id: string;
  code: string | null;
  title: string;
  amount: string;
  currency: string;
  status: ApprovalStatus;
  unit: { id: string; code: string; name: string };
  requester: UserRef;
  createdAt: string;
  submittedAt: string | null;
  decidedAt: string | null;
  activeStep: { id: string; order: number; role: string; assignee: UserRef | null } | null;
}

export interface RequestDetail extends RequestSummary {
  reason: string;
  workflow: { key: string; version: number; steps: { order: number; role: string; conditionType: string; conditionAmount: string | null; applies: boolean }[] } | null;
  steps: { id: string; order: number; role: string; status: StepStatus; assignee: UserRef | null; decidedBy: UserRef | null; decidedAt: string | null }[];
  history: { action: 'APPROVE' | 'REJECT' | 'DELEGATE'; stepOrder: number; actor: string; delegateTo: string | null; comment: string | null; at: string }[];
  permissions: { canEdit: boolean; canSubmit: boolean; canDecide: boolean; activeStepId: string | null };
}

export interface AuditItem {
  id: string;
  eventType: string;
  actor: string | null;
  at: string;
  traceId: string | null;
  payload: Record<string, unknown>;
}

export interface Options {
  units: { id: string; code: string; name: string; type: string; organizationId: string }[];
  workflows: { organizationId: string; key: string; version: number; steps: { order: number; role: string; conditionType: string; conditionAmount: string | null }[] }[];
}
