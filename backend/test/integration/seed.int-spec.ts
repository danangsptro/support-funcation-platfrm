import { PrismaClient } from '@prisma/client';
import { compare } from 'bcryptjs';
import { seedCounts } from '../../src/database/seed/seed';
import { ownerClient, resetDatabase, seedFixtures, testEnv } from '../helpers/db';

const EXPECTED = {
  organizations: 2,
  orgUnits: 6,
  users: 9,
  grants: 8,
  employees: 4,
  assignments: 5,
  periods: 1,
  kpis: 2,
  workflows: 1,
  workflowSteps: 2,
  requests: 5,
};

describe('T-INF-02 seed dari fixture', () => {
  let owner: PrismaClient;

  beforeAll(async () => {
    owner = ownerClient();
    await resetDatabase(owner);
  });
  afterAll(() => owner.$disconnect());

  it('database kosong → seed menghasilkan jumlah entity fixture', async () => {
    expect(await seedCounts(owner)).toEqual(Object.fromEntries(Object.keys(EXPECTED).map((k) => [k, 0])));
    await seedFixtures(owner);
    expect(await seedCounts(owner)).toEqual(EXPECTED);
  });

  it('seed kedua kali tidak menggandakan data dan UUID tetap', async () => {
    const before = await owner.orgUnit.findMany({ select: { id: true, externalKey: true }, orderBy: { externalKey: 'asc' } });
    await seedFixtures(owner);
    expect(await seedCounts(owner)).toEqual(EXPECTED);
    const after = await owner.orgUnit.findMany({ select: { id: true, externalKey: true }, orderBy: { externalKey: 'asc' } });
    expect(after).toEqual(before);
  });

  it('password demo disimpan sebagai hash, bukan plaintext', async () => {
    const user = await owner.user.findUniqueOrThrow({ where: { email: 'manager-a@example.test' } });
    expect(user.passwordHash).not.toContain(testEnv.demoPassword);
    expect(await compare(testEnv.demoPassword, user.passwordHash)).toBe(true);
  });

  it('pergantian DEMO_PASSWORD memperbarui hash tanpa menambah entity', async () => {
    await seedFixtures(owner, `${testEnv.demoPassword}-rotated`);
    const user = await owner.user.findUniqueOrThrow({ where: { email: 'hr@example.test' } });
    expect(await compare(`${testEnv.demoPassword}-rotated`, user.passwordHash)).toBe(true);
    expect(await seedCounts(owner)).toEqual(EXPECTED);
    await seedFixtures(owner);
  });

  it('relasi fixture terpetakan: hierarki, grant, KPI, workflow', async () => {
    const brA = await owner.orgUnit.findFirstOrThrow({ where: { externalKey: 'BR-A' }, include: { parent: true } });
    expect(brA.parent?.externalKey).toBe('DIV-1');
    const ccA = await owner.orgUnit.findFirstOrThrow({ where: { externalKey: 'CC-A' }, include: { parent: true } });
    expect(ccA.parent?.externalKey).toBe('BR-A');

    const adminGrant = await owner.userAccessGrant.findFirstOrThrow({ where: { user: { externalKey: 'ADMIN' } } });
    expect(adminGrant.unitId).toBeNull();
    expect(await owner.userAccessGrant.count({ where: { user: { externalKey: 'NO-GRANT' } } })).toBe(0);

    const kpi1 = await owner.kpiAssignment.findFirstOrThrow({ where: { externalKey: 'KPI-1' }, include: { unit: true } });
    expect(kpi1.source).toBe('VERIFIED_UNIT_REVENUE');
    expect(kpi1.unit?.externalKey).toBe('BR-A');
    expect(kpi1.weight.toString()).toBe('60');
    expect(kpi1.actual).toBeNull();

    const steps = await owner.workflowStep.findMany({ orderBy: { stepOrder: 'asc' } });
    expect(steps.map((s) => [s.stepOrder, s.role, s.conditionType, s.conditionAmount?.toString() ?? null])).toEqual([
      [1, 'MANAGER', 'ALWAYS', null],
      [2, 'FINANCE', 'AMOUNT_GT', '10000000'],
    ]);

    const requests = await owner.approvalRequest.findMany({ select: { externalKey: true, status: true } });
    expect(requests.every((r) => r.status === 'DRAFT')).toBe(true);
  });
});
