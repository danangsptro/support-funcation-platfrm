import { INestApplication } from '@nestjs/common';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { readFixtureJson } from '../fixtures/fixtures';
import { act, createRequest, submitRequest, submittedRequest } from '../helpers/approvals';
import { createTestApp, loginAs, USERS } from '../helpers/app';
import { ownerClient, resetDatabase, runtimeClient, seedFixtures } from '../helpers/db';

type Headers = Record<string, string>;

describe('Phase 05 — workflow approval, akses, delegasi, audit (PostgreSQL nyata)', () => {
  let app: INestApplication;
  let owner: PrismaClient;
  const id: Record<string, string> = {};
  const as: Record<string, Headers> = {};
  const http = () => request(app.getHttpServer());
  const get = (who: string, path: string) => http().get(`/api/v1/approval-requests${path}`).set(as[who]);
  const auditTypes = async (requestId: string) =>
    (await owner.auditEvent.findMany({ where: { entityType: 'approval_request', entityId: requestId }, orderBy: { id: 'asc' } })).map((e) => e.eventType);

  async function testUser(key: string, role: Role, unit: string, active = true) {
    const template = await owner.user.findUniqueOrThrow({ where: { email: USERS.managerA } });
    const u = await owner.user.create({ data: { externalKey: key, email: `${key.toLowerCase()}@example.test`, passwordHash: template.passwordHash, active } });
    await owner.userAccessGrant.create({ data: { userId: u.id, role, organizationId: id['ORG-1'], unitId: id[unit] } });
    id[`user:${key}`] = u.id;
    if (active) as[key] = await loginAs(app, u.email);
  }

  beforeAll(async () => {
    owner = ownerClient();
    await resetDatabase(owner);
    await seedFixtures(owner);
    for (const u of await owner.orgUnit.findMany()) id[u.externalKey] = u.id;
    for (const o of await owner.organization.findMany()) id[o.externalKey] = o.id;
    for (const u of await owner.user.findMany()) id[`user:${u.externalKey}`] = u.id;
    for (const r of await owner.approvalRequest.findMany()) id[r.externalKey!] = r.id;
    app = await createTestApp();
    for (const [k, email] of Object.entries(USERS)) as[k] = await loginAs(app, email);
    await testUser('MGR-INACTIVE', 'MANAGER', 'BR-A', false);
    await testUser('REQ-OTHER', 'REQUESTER', 'BR-A');
  });
  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  describe('1–2. nominal menentukan langkah (fixture approval/test-scenarios.json)', () => {
    const scenarios = readFixtureJson<{ id: string; request_id?: string; expected_status?: string; expected_steps?: number }[]>('approval/test-scenarios.json');

    it.each(['LOW', 'BOUNDARY'])('%s: satu langkah Manager → APPROVED', async (key) => {
      const sc = scenarios.find((s) => s.id === key)!;
      const submitted = await submitRequest(app, as.employeeA, id[sc.request_id!]);
      expect(submitted.steps.map((s) => [s.role, s.status])).toEqual([['MANAGER', 'ACTIVE']]);
      const res = await act(app, as.managerA, submitted.id, submitted.steps[0].id, 'approve').expect(200);
      expect(res.body.status).toBe(sc.expected_status);
      expect(res.body.steps).toHaveLength(sc.expected_steps ?? 1);
      // Finance tidak terlibat → tidak melihat pengajuan ini.
      await get('finance', `/${submitted.id}`).expect(404);
    });

    it('HIGH: Manager lalu Finance → APPROVED; snapshot workflow tersimpan', async () => {
      const submitted = await submitRequest(app, as.employeeA, id['REQ-HIGH']);
      expect(submitted.steps.map((s) => [s.order, s.role, s.status])).toEqual([[1, 'MANAGER', 'ACTIVE'], [2, 'FINANCE', 'WAITING']]);
      const [s1, s2] = submitted.steps;
      // 3. Step kedua tidak bisa mendahului step pertama; Finance tidak berwenang di step 1.
      expect((await act(app, as.finance, submitted.id, s2.id, 'approve').expect(409)).body.code).toBe('STEP_NOT_ACTIVE');
      expect((await act(app, as.finance, submitted.id, s1.id, 'approve').expect(403)).body.code).toBe('NOT_ELIGIBLE');
      const mid = await act(app, as.managerA, submitted.id, s1.id, 'approve').expect(200);
      expect([mid.body.status, mid.body.activeStep.role]).toEqual(['PENDING', 'FINANCE']);
      // Manager tidak berwenang di langkah Finance.
      expect((await act(app, as.managerA, submitted.id, s2.id, 'approve').expect(403)).body.code).toBe('NOT_ELIGIBLE');
      // 9. stepId lama (step 1) tidak memproses step 2.
      expect((await act(app, as.managerA, submitted.id, s1.id, 'approve').expect(409)).body.code).toBe('STEP_NOT_ACTIVE');
      expect((await owner.approvalStep.findUniqueOrThrow({ where: { id: s2.id } })).status).toBe('ACTIVE');
      expect(await owner.approvalAction.count({ where: { stepId: s2.id } })).toBe(0);
      const done = await act(app, as.finance, submitted.id, s2.id, 'approve').expect(200);
      expect(done.body.status).toBe('APPROVED');
      const row = await owner.approvalRequest.findUniqueOrThrow({ where: { id: submitted.id } });
      expect(row.workflowSnapshot).toMatchObject({ key: 'WF-BUDGET', version: 1, amount: '15000000' });
      expect(await auditTypes(submitted.id)).toEqual(['SUBMITTED', 'APPROVED', 'APPROVED']);
    });

    it('reject di langkah mana pun → REJECTED; alasan penolakan wajib', async () => {
      const r = await submittedRequest(app, as.employeeA, id['BR-A'], '20000000');
      await act(app, as.managerA, r.id, r.steps[0].id, 'reject', { comment: '' }).expect(400);
      const res = await act(app, as.managerA, r.id, r.steps[0].id, 'reject').expect(200);
      expect(res.body.status).toBe('REJECTED');
      expect(res.body.steps.map((s: { status: string }) => s.status)).toEqual(['REJECTED', 'WAITING']);
      expect((await act(app, as.finance, r.id, r.steps[1].id, 'approve').expect(409)).body.code).toBe('REQUEST_NOT_PENDING');
    });
  });

  describe('draft, submit, dan imutabilitas', () => {
    it('validasi draft & unit di luar scope pengaju', async () => {
      const base = { unitId: id['BR-A'], title: 'Laptop', reason: 'Pengganti perangkat rusak' };
      await http().post('/api/v1/approval-requests').set(as.employeeA).send({ ...base, amount: '0' }).expect(400);
      await http().post('/api/v1/approval-requests').set(as.employeeA).send({ ...base, amount: 5000000 }).expect(400);
      await http().post('/api/v1/approval-requests').set(as.employeeA).send({ ...base, amount: '1', reason: 'x' }).expect(400);
      await http().post('/api/v1/approval-requests').set(as.employeeA).send({ ...base, amount: '1', unitId: id['BR-B'] }).expect(404);
      await http().post('/api/v1/approval-requests').set(as.managerA).send({ ...base, amount: '1' }).expect(403);
    });

    it('draft bisa diubah; setelah submit nominal/unit/alasan tidak bisa diubah dan submit ulang 409', async () => {
      const draft = await createRequest(app, as.employeeA, id['BR-A'], '1000000');
      await http().patch(`/api/v1/approval-requests/${draft}`).set(as.employeeA).send({ amount: '2000000' }).expect(200);
      await submitRequest(app, as.employeeA, draft);
      const res = await http().patch(`/api/v1/approval-requests/${draft}`).set(as.employeeA).send({ amount: '99000000' }).expect(409);
      expect(res.body.code).toBe('REQUEST_NOT_DRAFT');
      expect((await owner.approvalRequest.findUniqueOrThrow({ where: { id: draft } })).amount.toString()).toBe('2000000');
      expect((await http().post(`/api/v1/approval-requests/${draft}/submit`).set(as.employeeA).expect(409)).body.code).toBe('REQUEST_ALREADY_SUBMITTED');
      expect(await auditTypes(draft)).toEqual(['CREATED', 'DRAFT_UPDATED', 'SUBMITTED']);
    });

    it('draft hanya terlihat oleh pengajunya', async () => {
      const draft = await createRequest(app, as.employeeA, id['BR-A'], '3000000');
      await get('employeeA', `/${draft}`).expect(200);
      for (const who of ['managerA', 'admin', 'REQ-OTHER']) await get(who, `/${draft}`).expect(404);
    });
  });

  describe('4–5. self-approval & akses lintas cabang/organisasi', () => {
    it('SELF: MANAGER-A (grant REQUESTER khusus test, D-04) mengajukan → menyetujui sendiri 403; MANAGER-A2 boleh', async () => {
      await owner.userAccessGrant.create({ data: { userId: id['user:MANAGER-A'], role: 'REQUESTER', organizationId: id['ORG-1'], unitId: id['BR-A'] } });
      const r = await submittedRequest(app, as.managerA, id['BR-A'], '4000000');
      const self = await act(app, as.managerA, r.id, r.steps[0].id, 'approve').expect(403);
      expect(self.body.code).toBe('SELF_APPROVAL_FORBIDDEN');
      expect(await owner.approvalAction.count({ where: { requestId: r.id } })).toBe(0);
      const inbox = await get('managerA', '?view=inbox').expect(200);
      expect(inbox.body.items.map((i: { id: string }) => i.id)).not.toContain(r.id);
      await act(app, as.managerA2, r.id, r.steps[0].id, 'approve').expect(200);
    });

    it('MANAGER-B (cabang lain), OUTSIDER (organisasi lain), HR, NO-GRANT tidak bisa melihat/bertindak', async () => {
      const r = await submittedRequest(app, as.employeeA, id['BR-A'], '6000000');
      await get('managerB', `/${r.id}`).expect(404);
      await act(app, as.managerB, r.id, r.steps[0].id, 'approve').expect(404);
      await get('outsider', `/${r.id}`).expect(404);
      await get('outsider', `/${r.id}/audit`).expect(404);
      await get('hr', `/${r.id}`).expect(404);
      await act(app, as.hr, r.id, r.steps[0].id, 'approve').expect(403);
      await act(app, as.noGrant, r.id, r.steps[0].id, 'approve').expect(403);
      for (const who of ['managerB', 'outsider', 'hr', 'noGrant']) {
        const list = await get(who, '?view=all&pageSize=100').expect(200);
        expect(list.body.items.map((i: { id: string }) => i.id)).not.toContain(r.id);
      }
    });

    it('pengaju lain (REQ-OTHER) hanya melihat miliknya sendiri, bukan pengajuan EMPLOYEE-A', async () => {
      const r = await submittedRequest(app, as.employeeA, id['BR-A'], '6100000');
      await get('REQ-OTHER', `/${r.id}`).expect(404);
      await get('REQ-OTHER', `/${r.id}/audit`).expect(404);
      const mine = await createRequest(app, as['REQ-OTHER'], id['BR-A'], '100000');
      const list = await get('REQ-OTHER', '?view=all&pageSize=100').expect(200);
      expect(list.body.items.map((i: { id: string }) => i.id)).toEqual([mine]);
    });

    it('ADMIN: oversight baca (list/detail/audit pengajuan tersubmit ORG-1) tetapi tidak bisa memutuskan', async () => {
      const r = await submittedRequest(app, as.employeeA, id['BR-A'], '7000000');
      await get('admin', `/${r.id}`).expect(200);
      await get('admin', `/${r.id}/audit`).expect(200);
      const detail = await get('admin', `/${r.id}`).expect(200);
      expect(detail.body.permissions).toMatchObject({ canDecide: false, canSubmit: false });
      await act(app, as.admin, r.id, r.steps[0].id, 'approve').expect(403);
      const list = await get('admin', '?view=all&pageSize=100').expect(200);
      expect(list.body.items.every((i: { status: string }) => i.status !== 'DRAFT')).toBe(true);
      await act(app, as.managerA, r.id, r.steps[0].id, 'approve').expect(200);
    });

    it('inbox hanya berisi langkah aktif yang bisa diputuskan actor', async () => {
      const low = await submittedRequest(app, as.employeeA, id['BR-A'], '1500000');
      const high = await submittedRequest(app, as.employeeA, id['BR-A'], '16000000');
      const ids = async (who: string) => (await get(who, '?view=inbox&pageSize=100').expect(200)).body.items.map((i: { id: string }) => i.id);
      expect(await ids('managerA')).toEqual(expect.arrayContaining([low.id, high.id]));
      expect(await ids('finance')).not.toContain(high.id); // step 1 belum diputuskan
      await act(app, as.managerA, high.id, high.steps[0].id, 'approve').expect(200);
      expect(await ids('finance')).toContain(high.id);
      expect(await ids('managerA')).not.toContain(high.id);
      expect(await ids('managerB')).not.toContain(low.id);
      expect(await ids('employeeA')).toEqual([]);
    });
  });

  describe('10–11. delegasi', () => {
    it('DELEGATE (fixture): MANAGER-A → MANAGER-A2; approver lama tidak bisa bertindak; audit SUBMITTED, DELEGATED, APPROVED', async () => {
      const r = await submitRequest(app, as.employeeA, id['REQ-DELEGATE']);
      const step1 = r.steps[0].id;
      const cands = await get('managerA', `/${r.id}/steps/${step1}/delegates`).expect(200);
      expect(cands.body.items.map((u: { email: string }) => u.email)).toEqual([USERS.managerA2]);
      await act(app, as.managerA, r.id, step1, 'delegate', { toUserId: id['user:MANAGER-A2'], comment: 'Sedang cuti' }).expect(200);
      const old = await act(app, as.managerA, r.id, step1, 'approve').expect(403);
      expect(old.body.code).toBe('NOT_ASSIGNEE');
      const inboxA = await get('managerA', '?view=inbox&pageSize=100').expect(200);
      expect(inboxA.body.items.map((i: { id: string }) => i.id)).not.toContain(r.id);
      const res = await act(app, as.managerA2, r.id, step1, 'approve').expect(200);
      expect([res.body.status, res.body.activeStep.order]).toEqual(['PENDING', 2]);
      expect(await auditTypes(r.id)).toEqual(['SUBMITTED', 'DELEGATED', 'APPROVED']);
      // Delegasi tidak menambah grant.
      expect(await owner.userAccessGrant.count({ where: { userId: id['user:MANAGER-A2'] } })).toBe(1);
    });

    it('INVALID-DELEGATE: MANAGER-B, pengaju, pengguna nonaktif, role salah (Finance), diri sendiri → 403; calon delegasi pun disaring', async () => {
      const r = await submittedRequest(app, as.employeeA, id['BR-A'], '8000000');
      const step1 = r.steps[0].id;
      for (const target of ['MANAGER-B', 'EMPLOYEE-A', 'MGR-INACTIVE', 'FINANCE', 'MANAGER-A']) {
        const res = await act(app, as.managerA, r.id, step1, 'delegate', { toUserId: id[`user:${target}`] }).expect(403);
        expect([target, res.body.code]).toEqual([target, 'INVALID_DELEGATE']);
      }
      expect(await owner.approvalAction.count({ where: { requestId: r.id } })).toBe(0);
      await get('managerB', `/${r.id}/steps/${step1}/delegates`).expect(404);
      await get('employeeA', `/${r.id}/steps/${step1}/delegates`).expect(403);
    });

    it('eligibility penerima divalidasi ulang saat bertindak (bukan dari state delegasi)', async () => {
      const r = await submittedRequest(app, as.employeeA, id['BR-A'], '8100000');
      await act(app, as.managerA, r.id, r.steps[0].id, 'delegate', { toUserId: id['user:MANAGER-A2'] }).expect(200);
      const grant = await owner.userAccessGrant.findFirstOrThrow({ where: { userId: id['user:MANAGER-A2'], role: 'MANAGER' } });
      // (a) Tetap MANAGER, tetapi scope dipindah ke BR-B → di luar cakupan → 404, langkah tidak diproses.
      await owner.userAccessGrant.update({ where: { id: grant.id }, data: { unitId: id['BR-B'] } });
      try {
        await act(app, as.managerA2, r.id, r.steps[0].id, 'approve').expect(404);
        // (b) Grant dicabut seluruhnya → tidak punya izin keputusan sama sekali → 403.
        await owner.userAccessGrant.delete({ where: { id: grant.id } });
        expect((await act(app, as.managerA2, r.id, r.steps[0].id, 'approve').expect(403)).body.code).toBe('FORBIDDEN');
        expect((await owner.approvalStep.findUniqueOrThrow({ where: { id: r.steps[0].id } })).status).toBe('ACTIVE');
        expect(await owner.approvalAction.count({ where: { requestId: r.id, action: { in: ['APPROVE', 'REJECT'] } } })).toBe(0);
      } finally {
        await owner.userAccessGrant.upsert({
          where: { id: grant.id },
          create: { id: grant.id, userId: grant.userId, role: grant.role, organizationId: grant.organizationId, unitId: id['BR-A'] },
          update: { unitId: id['BR-A'] },
        });
      }
      await act(app, as.managerA2, r.id, r.steps[0].id, 'approve').expect(200);
    });
  });

  describe('15. perubahan konfigurasi workflow tidak mengubah pengajuan tersubmit', () => {
    it('ubah ambang step Finance setelah submit: pengajuan lama tetap 2 langkah & snapshot lama; pengajuan baru ikut konfigurasi baru', async () => {
      const before = await submittedRequest(app, as.employeeA, id['BR-A'], '15000000');
      const step2 = await owner.workflowStep.findFirstOrThrow({ where: { stepOrder: 2, workflow: { organizationId: id['ORG-1'] } } });
      await owner.workflowStep.update({ where: { id: step2.id }, data: { conditionAmount: 100000000 } });
      try {
        const after = await submittedRequest(app, as.employeeA, id['BR-A'], '15000000');
        expect(after.steps.map((s) => s.role)).toEqual(['MANAGER']);
        const old = await get('employeeA', `/${before.id}`).expect(200);
        expect(old.body.steps.map((s: { role: string }) => s.role)).toEqual(['MANAGER', 'FINANCE']);
        expect(old.body.workflow.steps[1]).toMatchObject({ conditionAmount: '10000000', applies: true });
        await act(app, as.managerA, before.id, before.steps[0].id, 'approve').expect(200);
        const st = await get('employeeA', `/${before.id}`).expect(200);
        expect([st.body.status, st.body.activeStep.role]).toEqual(['PENDING', 'FINANCE']);
      } finally {
        await owner.workflowStep.update({ where: { id: step2.id }, data: { conditionAmount: step2.conditionAmount } });
      }
    });
  });

  describe('14. audit append-only', () => {
    it('app_runtime: UPDATE/DELETE/TRUNCATE audit_events ditolak; data tidak berubah', async () => {
      const runtime = runtimeClient();
      try {
        const ev = await owner.auditEvent.findFirstOrThrow({ where: { entityType: 'approval_request', eventType: 'SUBMITTED' } });
        await expect(runtime.$executeRaw`UPDATE audit_events SET event_type = 'X' WHERE id = ${ev.id}`).rejects.toThrow(/permission denied/i);
        await expect(runtime.$executeRaw`DELETE FROM audit_events WHERE id = ${ev.id}`).rejects.toThrow(/permission denied/i);
        await expect(runtime.$executeRawUnsafe('TRUNCATE audit_events')).rejects.toThrow(/permission denied/i);
        expect((await owner.auditEvent.findUniqueOrThrow({ where: { id: ev.id } })).eventType).toBe('SUBMITTED');
        const [role] = await runtime.$queryRaw<{ rolsuper: boolean; owner: boolean }[]>`
          SELECT r.rolsuper, (SELECT tableowner = current_user FROM pg_tables WHERE tablename = 'audit_events') AS owner FROM pg_roles r WHERE r.rolname = current_user`;
        expect(role).toEqual({ rolsuper: false, owner: false });
      } finally {
        await runtime.$disconnect();
      }
    });

    it('audit mencatat actor, langkah, waktu, perubahan status, dan request ID; terbaca lewat API oleh pihak berhak', async () => {
      const r = await submittedRequest(app, as.employeeA, id['BR-A'], '2500000');
      await act(app, as.managerA, r.id, r.steps[0].id, 'approve').set('x-request-id', 'trace-approve-1').expect(200);
      const trail = await get('employeeA', `/${r.id}/audit`).expect(200);
      const approved = trail.body.items.find((e: { eventType: string }) => e.eventType === 'APPROVED');
      expect(approved).toMatchObject({
        actor: USERS.managerA,
        traceId: 'trace-approve-1',
        payload: { stepId: r.steps[0].id, stepOrder: 1, role: 'MANAGER', fromStatus: 'PENDING', toStatus: 'APPROVED' },
      });
      expect(Date.parse(approved.at)).not.toBeNaN();
    });
  });
});
