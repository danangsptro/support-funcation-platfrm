import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Bentuk fixture samples/test-data (snake_case, nominal string desimal). */
export interface Fixtures {
  organizations: { id: string; name: string }[];
  orgUnits: { id: string; organization_id: string; parent_id: string | null; type: string; name: string }[];
  users: { id: string; email: string; active: boolean }[];
  grants: { user_id: string; role: string; organization_id: string; unit_id: string | null; include_descendants: boolean }[];
  employees: { id: string; organization_id: string; name: string }[];
  assignments: { employee_id: string; unit_id: string; start_date: string; end_date_exclusive: string | null }[];
  periods: { id: string; start_date: string; end_date_exclusive: string; timezone: string }[];
  kpis: {
    id: string;
    employee_id: string;
    period_id: string;
    name: string;
    source: string;
    unit_id?: string | null;
    weight: string;
    target: string;
    actual?: string | null;
  }[];
  workflow: {
    id: string;
    version: number;
    type: string;
    currency: string;
    self_approval: boolean;
    steps: { order: number; role: string; condition: string }[];
  };
  requests: {
    id: string;
    organization_id: string;
    unit_id: string;
    requester_id: string;
    amount: string;
    currency: string;
    status: string;
    workflow_id: string;
  }[];
}

export function defaultFixtureDir(): string {
  return process.env.FIXTURE_DIR ?? resolve(__dirname, '../../../../samples/test-data');
}

export function loadFixtures(dir = defaultFixtureDir()): Fixtures {
  const read = <T>(file: string): T => JSON.parse(readFileSync(join(dir, file), 'utf8')) as T;
  return {
    organizations: read('seed/organizations.json'),
    orgUnits: read('seed/org-units.json'),
    users: read('seed/users.json'),
    grants: read('seed/access-grants.json'),
    employees: read('seed/employees.json'),
    assignments: read('seed/employee-assignments.json'),
    periods: read('hr/review-periods.json'),
    kpis: read('hr/kpi-assignments.json'),
    workflow: read('approval/workflow.json'),
    requests: read('approval/requests.json'),
  };
}
