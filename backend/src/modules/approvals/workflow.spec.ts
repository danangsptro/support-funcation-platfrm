import { readFixtureJson } from '../../../test/fixtures/fixtures';
import { buildSnapshot, WorkflowStepConfig } from './workflow';

const fixture = readFixtureJson<{ id: string; version: number; type: string; steps: { order: number; role: 'MANAGER' | 'FINANCE'; condition: string }[] }>('approval/workflow.json');
const steps: WorkflowStepConfig[] = fixture.steps.map((s) => ({
  workflowStepId: `s${s.order}`,
  order: s.order,
  role: s.role,
  conditionType: s.condition === 'always' ? 'ALWAYS' : 'AMOUNT_GT',
  conditionAmount: s.condition === 'always' ? null : s.condition.replace(/[^0-9.]/g, ''),
}));
const roles = (amount: string) =>
  buildSnapshot({ id: 'w', key: fixture.id, version: fixture.version, type: fixture.type }, steps, amount).steps.filter((s) => s.applies).map((s) => s.role);

describe('pemilihan langkah workflow (approval/workflow.json)', () => {
  it.each([
    ['REQ-LOW 5.000.000', '5000000', ['MANAGER']],
    ['REQ-BOUNDARY tepat 10.000.000', '10000000', ['MANAGER']],
    ['10.000.000,01', '10000000.01', ['MANAGER', 'FINANCE']],
    ['REQ-HIGH 15.000.000', '15000000', ['MANAGER', 'FINANCE']],
  ])('%s → %j', (_l, amount, expected) => {
    expect(roles(amount)).toEqual(expected);
  });

  it('snapshot menyimpan versi, kondisi, dan langkah yang tidak berlaku', () => {
    const snap = buildSnapshot({ id: 'w', key: 'WF-BUDGET', version: 1, type: 'BUDGET' }, steps, '5000000');
    expect(snap).toMatchObject({ key: 'WF-BUDGET', version: 1, amount: '5000000' });
    expect(snap.steps.map((s) => [s.order, s.applies])).toEqual([[1, true], [2, false]]);
  });
});
