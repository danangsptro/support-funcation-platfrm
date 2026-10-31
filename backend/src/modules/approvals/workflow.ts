import Decimal from 'decimal.js';

export interface WorkflowStepConfig {
  workflowStepId: string;
  order: number;
  role: 'ADMIN' | 'HR' | 'FINANCE' | 'MANAGER' | 'REQUESTER';
  conditionType: 'ALWAYS' | 'AMOUNT_GT';
  conditionAmount: string | null;
}

export interface WorkflowSnapshot {
  workflowId: string;
  key: string;
  version: number;
  type: string;
  amount: string;
  steps: (WorkflowStepConfig & { applies: boolean })[];
}

/** Langkah berlaku bila kondisinya terpenuhi untuk nominal pengajuan (urut sesuai konfigurasi). */
export function stepApplies(step: Pick<WorkflowStepConfig, 'conditionType' | 'conditionAmount'>, amount: string): boolean {
  if (step.conditionType === 'ALWAYS') return true;
  return new Decimal(amount).greaterThan(step.conditionAmount ?? '0');
}

export function buildSnapshot(
  workflow: { id: string; key: string; version: number; type: string },
  steps: WorkflowStepConfig[],
  amount: string,
): WorkflowSnapshot {
  const ordered = [...steps].sort((a, b) => a.order - b.order);
  return { workflowId: workflow.id, key: workflow.key, version: workflow.version, type: workflow.type, amount, steps: ordered.map((s) => ({ ...s, applies: stepApplies(s, amount) })) };
}
