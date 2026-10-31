import { ApprovalStatus, KpiSource, OrgUnitType, Prisma, PrismaClient, Role, StepConditionType } from '@prisma/client';
import { compare, hash } from 'bcryptjs';
import { Fixtures } from './fixtures';
import { fixtureId } from './ids';

const BCRYPT_ROUNDS = 10;

export interface SeedOptions {
  fixtures: Fixtures;
  demoPassword: string;
}

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function lookup<T>(map: Map<string, T>, key: string, what: string): T {
  const v = map.get(key);
  if (v === undefined) throw new Error(`Fixture merujuk ${what} "${key}" yang tidak ada`);
  return v;
}

/** Parse kondisi step workflow fixture: "always" atau "amount > N". */
export function parseStepCondition(condition: string): { type: StepConditionType; amount: string | null } {
  if (condition.trim() === 'always') return { type: StepConditionType.ALWAYS, amount: null };
  const m = /^amount\s*>\s*(\d+(?:\.\d+)?)$/.exec(condition.trim());
  if (!m) throw new Error(`Kondisi workflow tidak dikenal: ${condition}`);
  return { type: StepConditionType.AMOUNT_GT, amount: m[1] };
}

/**
 * Seed idempotent: setiap entity memakai UUID deterministik dari external key dan di-upsert.
 * Data yang sudah ada tidak ditimpa (update kosong), kecuali hash password bila DEMO_PASSWORD berubah.
 * Urutan: organisasi → unit (parent dahulu) → user → grant → karyawan → penempatan → periode → KPI
 * → workflow → request.
 */
export async function runSeed(prisma: PrismaClient, { fixtures: fx, demoPassword }: SeedOptions): Promise<void> {
  if (!demoPassword) throw new Error('DEMO_PASSWORD wajib diisi untuk seed');

  const existingUsers = await prisma.user.findMany({ select: { id: true, passwordHash: true } });
  const existingHash = new Map(existingUsers.map((u) => [u.id, u.passwordHash]));
  const passwordHashes = new Map<string, string>();
  for (const u of fx.users) {
    const id = fixtureId('user', u.id);
    const current = existingHash.get(id);
    passwordHashes.set(
      id,
      current && (await compare(demoPassword, current)) ? current : await hash(demoPassword, BCRYPT_ROUNDS),
    );
  }

  await prisma.$transaction(async (tx) => {
    const orgIds = new Map<string, string>();
    for (const o of fx.organizations) {
      const id = fixtureId('organization', o.id);
      orgIds.set(o.id, id);
      await tx.organization.upsert({ where: { id }, create: { id, externalKey: o.id, name: o.name }, update: {} });
    }

    const unitIds = new Map<string, string>();
    const unitOrg = new Map<string, string>();
    const pending = [...fx.orgUnits];
    while (pending.length > 0) {
      const idx = pending.findIndex((u) => u.parent_id === null || unitIds.has(u.parent_id));
      if (idx < 0) throw new Error(`Parent org unit tidak ditemukan: ${pending.map((u) => u.id).join(', ')}`);
      const [u] = pending.splice(idx, 1);
      const organizationId = lookup(orgIds, u.organization_id, 'organisasi');
      const id = fixtureId('org-unit', u.organization_id, u.id);
      unitIds.set(u.id, id);
      unitOrg.set(u.id, u.organization_id);
      await tx.orgUnit.upsert({
        where: { id },
        create: {
          id,
          organizationId,
          parentId: u.parent_id ? unitIds.get(u.parent_id) : null,
          type: u.type as OrgUnitType,
          externalKey: u.id,
          name: u.name,
        },
        update: {},
      });
    }

    const userIds = new Map<string, string>();
    for (const u of fx.users) {
      const id = fixtureId('user', u.id);
      userIds.set(u.id, id);
      const passwordHash = lookup(passwordHashes, id, 'hash user');
      await tx.user.upsert({
        where: { id },
        create: { id, externalKey: u.id, email: u.email, active: u.active, passwordHash },
        update: { passwordHash },
      });
    }

    for (const g of fx.grants) {
      const id = fixtureId('grant', g.user_id, g.role, g.organization_id, g.unit_id);
      await tx.userAccessGrant.upsert({
        where: { id },
        create: {
          id,
          userId: lookup(userIds, g.user_id, 'user'),
          role: g.role as Role,
          organizationId: lookup(orgIds, g.organization_id, 'organisasi'),
          unitId: g.unit_id ? lookup(unitIds, g.unit_id, 'unit') : null,
          includeDescendants: g.include_descendants,
        },
        update: {},
      });
    }

    const employeeIds = new Map<string, string>();
    const employeeOrg = new Map<string, string>();
    for (const e of fx.employees) {
      const id = fixtureId('employee', e.organization_id, e.id);
      employeeIds.set(e.id, id);
      employeeOrg.set(e.id, e.organization_id);
      await tx.employee.upsert({
        where: { id },
        create: { id, organizationId: lookup(orgIds, e.organization_id, 'organisasi'), externalKey: e.id, name: e.name },
        update: {},
      });
    }

    for (const a of fx.assignments) {
      const id = fixtureId('assignment', a.employee_id, a.unit_id, a.start_date);
      const org = lookup(employeeOrg, a.employee_id, 'karyawan');
      await tx.employeeAssignment.upsert({
        where: { id },
        create: {
          id,
          employeeId: lookup(employeeIds, a.employee_id, 'karyawan'),
          organizationId: lookup(orgIds, org, 'organisasi'),
          unitId: lookup(unitIds, a.unit_id, 'unit'),
          startDate: day(a.start_date),
          endDateExclusive: a.end_date_exclusive ? day(a.end_date_exclusive) : null,
          isPrimary: true,
        },
        update: {},
      });
    }

    // Fixture periode tidak menyebut organisasi; diturunkan dari karyawan pada KPI periode tsb.
    const periodIds = new Map<string, string>();
    for (const p of fx.periods) {
      const orgs = new Set(fx.kpis.filter((k) => k.period_id === p.id).map((k) => lookup(employeeOrg, k.employee_id, 'karyawan')));
      if (orgs.size !== 1) throw new Error(`Organisasi periode ${p.id} tidak dapat ditentukan`);
      const [org] = [...orgs];
      const id = fixtureId('period', org, p.id);
      periodIds.set(p.id, id);
      await tx.reviewPeriod.upsert({
        where: { id },
        create: {
          id,
          organizationId: lookup(orgIds, org, 'organisasi'),
          externalKey: p.id,
          startDate: day(p.start_date),
          endDateExclusive: day(p.end_date_exclusive),
          timezone: p.timezone,
        },
        update: {},
      });
    }

    for (const k of fx.kpis) {
      const org = lookup(employeeOrg, k.employee_id, 'karyawan');
      const id = fixtureId('kpi', org, k.id);
      const source = k.source as KpiSource;
      await tx.kpiAssignment.upsert({
        where: { id },
        create: {
          id,
          organizationId: lookup(orgIds, org, 'organisasi'),
          employeeId: lookup(employeeIds, k.employee_id, 'karyawan'),
          periodId: lookup(periodIds, k.period_id, 'periode'),
          externalKey: k.id,
          name: k.name,
          source,
          unitId: source === KpiSource.VERIFIED_UNIT_REVENUE ? lookup(unitIds, k.unit_id ?? '', 'unit') : null,
          weight: new Prisma.Decimal(k.weight),
          target: new Prisma.Decimal(k.target),
          actual: source === KpiSource.MANUAL && k.actual != null ? new Prisma.Decimal(k.actual) : null,
        },
        update: {},
      });
    }

    // Workflow fixture tidak menyebut organisasi; dipasang pada organisasi request yang memakainya.
    const wf = fx.workflow;
    const wfOrgs = new Set(fx.requests.filter((r) => r.workflow_id === wf.id).map((r) => r.organization_id));
    const workflowIds = new Map<string, string>();
    for (const org of wfOrgs) {
      const workflowId = fixtureId('workflow', org, wf.id, wf.version);
      workflowIds.set(org, workflowId);
      await tx.workflowDefinition.upsert({
        where: { id: workflowId },
        create: {
          id: workflowId,
          organizationId: lookup(orgIds, org, 'organisasi'),
          externalKey: wf.id,
          version: wf.version,
          type: wf.type,
          currency: wf.currency,
          selfApproval: wf.self_approval,
        },
        update: {},
      });
      for (const s of wf.steps) {
        const cond = parseStepCondition(s.condition);
        const id = fixtureId('workflow-step', org, wf.id, wf.version, s.order);
        await tx.workflowStep.upsert({
          where: { id },
          create: {
            id,
            workflowId,
            stepOrder: s.order,
            role: s.role as Role,
            conditionType: cond.type,
            conditionAmount: cond.amount ? new Prisma.Decimal(cond.amount) : null,
          },
          update: {},
        });
      }
    }

    for (const r of fx.requests) {
      if (unitOrg.get(r.unit_id) !== r.organization_id) {
        throw new Error(`Request ${r.id}: unit ${r.unit_id} bukan milik ${r.organization_id}`);
      }
      const id = fixtureId('approval-request', r.organization_id, r.id);
      await tx.approvalRequest.upsert({
        where: { id },
        create: {
          id,
          organizationId: lookup(orgIds, r.organization_id, 'organisasi'),
          unitId: lookup(unitIds, r.unit_id, 'unit'),
          externalKey: r.id,
          requesterUserId: lookup(userIds, r.requester_id, 'user'),
          workflowId: lookup(workflowIds, r.organization_id, 'workflow'),
          title: `Pengajuan anggaran ${r.id}`,
          amount: new Prisma.Decimal(r.amount),
          currency: r.currency,
          status: r.status as ApprovalStatus,
        },
        update: {},
      });
    }
  });
}

/** Jumlah entity per tabel hasil seed, dipakai untuk verifikasi idempotensi. */
export async function seedCounts(prisma: PrismaClient): Promise<Record<string, number>> {
  const [organizations, orgUnits, users, grants, employees, assignments, periods, kpis, workflows, workflowSteps, requests] =
    await Promise.all([
      prisma.organization.count(),
      prisma.orgUnit.count(),
      prisma.user.count(),
      prisma.userAccessGrant.count(),
      prisma.employee.count(),
      prisma.employeeAssignment.count(),
      prisma.reviewPeriod.count(),
      prisma.kpiAssignment.count(),
      prisma.workflowDefinition.count(),
      prisma.workflowStep.count(),
      prisma.approvalRequest.count(),
    ]);
  return { organizations, orgUnits, users, grants, employees, assignments, periods, kpis, workflows, workflowSteps, requests };
}
