import { PrismaClient } from '@prisma/client';
import { ownerClient, resetDatabase, runtimeClient, seedFixtures } from '../helpers/db';

/**
 * Constraint DB yang ditambahkan lewat SQL migration. Test ini juga menjaga agar migration
 * berikutnya tidak menghapusnya secara tidak sengaja (mis. dari `prisma migrate diff`).
 */
describe('constraint database & hak role runtime', () => {
  let owner: PrismaClient;
  let runtime: PrismaClient;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    owner = ownerClient();
    runtime = runtimeClient();
    await resetDatabase(owner);
    await seedFixtures(owner);
    for (const u of await owner.orgUnit.findMany()) ids[u.externalKey] = u.id;
    for (const o of await owner.organization.findMany()) ids[o.externalKey] = o.id;
    for (const e of await owner.employee.findMany()) ids[e.externalKey] = e.id;
    for (const u of await owner.user.findMany()) ids[`user:${u.externalKey}`] = u.id;
  });
  afterAll(async () => {
    await owner.$disconnect();
    await runtime.$disconnect();
  });

  describe('T-INF-04 role runtime', () => {
    it('bukan superuser dan tidak memiliki tabel apa pun', async () => {
      const [role] = await runtime.$queryRaw<{ rolsuper: boolean; owned: bigint }[]>`
        SELECT r.rolsuper,
               (SELECT count(*) FROM pg_tables t WHERE t.schemaname = 'public' AND t.tableowner = current_user) AS owned
        FROM pg_roles r WHERE r.rolname = current_user`;
      expect(role.rolsuper).toBe(false);
      expect(Number(role.owned)).toBe(0);
    });

    it('hanya SELECT/INSERT pada audit_events dan tanpa akses _prisma_migrations', async () => {
      const [p] = await runtime.$queryRaw<Record<string, boolean>[]>`
        SELECT has_table_privilege(current_user, 'audit_events', 'SELECT')   AS sel,
               has_table_privilege(current_user, 'audit_events', 'INSERT')   AS ins,
               has_table_privilege(current_user, 'audit_events', 'UPDATE')   AS upd,
               has_table_privilege(current_user, 'audit_events', 'DELETE')   AS del,
               has_table_privilege(current_user, 'audit_events', 'TRUNCATE') AS trn,
               has_table_privilege(current_user, '_prisma_migrations', 'SELECT') AS mig`;
      expect(p).toEqual({ sel: true, ins: true, upd: false, del: false, trn: false, mig: false });
    });
  });

  describe('audit append-only (lapisan DB untuk T-APR-10)', () => {
    it('runtime boleh INSERT, tetapi UPDATE/DELETE ditolak dan data tidak berubah', async () => {
      const event = await runtime.auditEvent.create({
        data: { organizationId: ids['ORG-1'], entityType: 'test', entityId: ids['BR-A'], eventType: 'CREATED' },
      });
      await expect(runtime.$executeRaw`UPDATE audit_events SET event_type = 'X' WHERE id = ${event.id}`).rejects.toThrow(
        /permission denied/i,
      );
      await expect(runtime.$executeRaw`DELETE FROM audit_events WHERE id = ${event.id}`).rejects.toThrow(/permission denied/i);
      const stored = await owner.auditEvent.findUniqueOrThrow({ where: { id: event.id } });
      expect(stored.eventType).toBe('CREATED');
    });

    it('owner pun ditolak trigger untuk UPDATE/DELETE', async () => {
      const event = await owner.auditEvent.create({
        data: { organizationId: ids['ORG-1'], entityType: 'test', entityId: ids['BR-A'], eventType: 'CREATED' },
      });
      await expect(owner.$executeRaw`UPDATE audit_events SET event_type = 'X' WHERE id = ${event.id}`).rejects.toThrow(
        /append-only/,
      );
      await expect(owner.$executeRaw`DELETE FROM audit_events WHERE id = ${event.id}`).rejects.toThrow(/append-only/);
    });
  });

  describe('konsistensi organisasi', () => {
    it('parent org unit wajib satu organisasi', async () => {
      await expect(
        runtime.orgUnit.create({
          data: { organizationId: ids['ORG-2'], parentId: ids['DIV-1'], type: 'BRANCH', externalKey: 'BR-BAD', name: 'x' },
        }),
      ).rejects.toThrow(/org_units_parent_same_org_fkey/);
    });

    it('grant unit wajib milik organisasi grant', async () => {
      await expect(
        runtime.userAccessGrant.create({
          data: { userId: ids['user:OUTSIDER'], role: 'MANAGER', organizationId: ids['ORG-2'], unitId: ids['BR-A'] },
        }),
      ).rejects.toThrow(/user_access_grants_unit_same_org_fkey/);
    });

    it('grant identik ditolak walau unit null', async () => {
      await expect(
        runtime.userAccessGrant.create({ data: { userId: ids['user:ADMIN'], role: 'ADMIN', organizationId: ids['ORG-1'] } }),
      ).rejects.toThrow(/Unique constraint/);
    });

    it('penempatan ke unit organisasi lain ditolak', async () => {
      await expect(
        runtime.employeeAssignment.create({
          data: {
            employeeId: ids['EMP-4'],
            organizationId: ids['ORG-1'],
            unitId: ids['BR-X'],
            startDate: new Date('2026-12-01'),
            // Non-primer agar yang teruji murni FK organisasi, bukan exclusion overlap.
            isPrimary: false,
          },
        }),
      ).rejects.toThrow(/employee_assignments_unit_same_org_fkey/);
    });
  });

  describe('T-HR-13 penempatan primer [start, end_exclusive)', () => {
    it('overlap ditolak oleh exclusion constraint', async () => {
      await expect(
        runtime.employeeAssignment.create({
          data: { employeeId: ids['EMP-1'], organizationId: ids['ORG-1'], unitId: ids['BR-B'], startDate: new Date('2026-09-10') },
        }),
      ).rejects.toThrow(/employee_assignments_primary_no_overlap/);
    });

    it('interval bersebelahan diterima (EMP-3 BR-A s.d. 16 Sep, BR-B mulai 16 Sep)', async () => {
      const emp3 = await owner.employeeAssignment.findMany({ where: { employeeId: ids['EMP-3'] } });
      expect(emp3).toHaveLength(2);
    });

    it('end_date_exclusive harus setelah start_date', async () => {
      await expect(
        runtime.employeeAssignment.create({
          data: {
            employeeId: ids['EMP-4'],
            organizationId: ids['ORG-1'],
            unitId: ids['BR-B'],
            startDate: new Date('2027-01-10'),
            endDateExclusive: new Date('2027-01-10'),
            isPrimary: false,
          },
        }),
      ).rejects.toThrow(/employee_assignments_interval_chk/);
    });
  });

  describe('CHECK domain', () => {
    it('KPI target harus > 0', async () => {
      const kpi = await owner.kpiAssignment.findFirstOrThrow({ where: { externalKey: 'KPI-2' } });
      await expect(runtime.kpiAssignment.update({ where: { id: kpi.id }, data: { target: 0 } })).rejects.toThrow(
        /kpi_assignments_target_positive_chk/,
      );
    });

    it('transaksi revenue harus > 0', async () => {
      await expect(
        runtime.financialTransaction.create({
          data: {
            organizationId: ids['ORG-1'],
            unitId: ids['BR-A'],
            side: 'INTERNAL',
            accountId: 'ACC-1',
            sourceTransactionId: 'NEG-1',
            reference: 'REF-X',
            transactionDate: new Date('2026-09-10'),
            amount: -100,
            currency: 'IDR',
            transactionType: 'REVENUE',
            payloadHash: 'x',
          },
        }),
      ).rejects.toThrow(/financial_transactions_amount_positive_chk/);
    });
  });

  describe('satu keputusan terminal per step', () => {
    it('APPROVE kedua pada step yang sama ditolak unique index', async () => {
      const request = await owner.approvalRequest.findFirstOrThrow({ where: { externalKey: 'REQ-HIGH' } });
      const wfStep = await owner.workflowStep.findFirstOrThrow({ where: { stepOrder: 1 } });
      const step = await runtime.approvalStep.create({
        data: { requestId: request.id, workflowStepId: wfStep.id, stepOrder: 1, role: 'MANAGER', status: 'ACTIVE' },
      });
      const base = { stepId: step.id, requestId: request.id };
      await runtime.approvalAction.create({ data: { ...base, actorUserId: ids['user:MANAGER-A'], action: 'APPROVE' } });
      await expect(
        runtime.approvalAction.create({ data: { ...base, actorUserId: ids['user:MANAGER-A2'], action: 'REJECT' } }),
      ).rejects.toThrow(/Unique constraint/);
      // Delegasi bukan keputusan terminal sehingga tidak terkena index tersebut.
      await runtime.approvalAction.create({
        data: { ...base, actorUserId: ids['user:MANAGER-A'], action: 'DELEGATE', delegateToUserId: ids['user:MANAGER-A2'] },
      });
    });
  });
});
