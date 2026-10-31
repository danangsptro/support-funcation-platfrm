import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { act, createRequest, StepView, submittedRequest } from '../helpers/approvals';
import { createTestApp, loginAs, USERS } from '../helpers/app';
import { ownerClient, resetDatabase, seedFixtures } from '../helpers/db';
import { HoldBeforeCommit, waitForLockWaiter } from '../helpers/race';

type Headers = Record<string, string>;
type Res = request.Response;

describe('Phase 05 — concurrency approval (PostgreSQL nyata, dua pool koneksi, transaksi tumpang tindih)', () => {
  let holder: INestApplication; // instance A: transaksinya ditahan sebelum commit
  let other: INestApplication; // instance B: pool koneksi terpisah
  let owner: PrismaClient;
  const hold = new HoldBeforeCommit();
  const id: Record<string, string> = {};
  const as: Record<string, Headers> = {};

  /** Jalankan `first` di A sampai tertahan sebelum commit, lalu `second` di B; pastikan B menunggu lock. */
  async function overlap(kind: string, first: () => request.Test, second: () => request.Test): Promise<[Res, Res, number]> {
    hold.arm(kind);
    const p1 = first().then((r) => r);
    let p2: Promise<Res> | undefined;
    let waiters = 0;
    try {
      await hold.entered;
      p2 = second().then((r) => r);
      waiters = await waitForLockWaiter(owner);
    } finally {
      // Selalu lepas transaksi pertama agar tidak ada transaksi menggantung bila verifikasi gagal.
      hold.release();
    }
    const [r1, r2] = await Promise.all([p1, p2!]);
    return [r1, r2, waiters];
  }

  const state = async (requestId: string) => {
    const r = await owner.approvalRequest.findUniqueOrThrow({ where: { id: requestId }, include: { steps: { orderBy: { stepOrder: 'asc' } }, actions: true } });
    const audit = await owner.auditEvent.findMany({ where: { entityType: 'approval_request', entityId: requestId }, orderBy: { id: 'asc' } });
    return { r, audit: audit.map((a) => a.eventType) };
  };

  beforeAll(async () => {
    owner = ownerClient();
    await resetDatabase(owner);
    await seedFixtures(owner);
    for (const u of await owner.orgUnit.findMany()) id[u.externalKey] = u.id;
    for (const u of await owner.user.findMany()) id[`user:${u.externalKey}`] = u.id;
    holder = await createTestApp(undefined, { approvalHooks: hold.hooks });
    other = await createTestApp();
    for (const [k, email] of Object.entries(USERS)) as[k] = await loginAs(other, email);
  });
  afterAll(async () => {
    await holder.close();
    await other.close();
    await owner.$disconnect();
  });

  const high = () => submittedRequest(other, as.employeeA, id['BR-A'], '15000000');

  it('6. RACE approve vs approve (MANAGER-A di A, MANAGER-A2 di B): satu 200, satu 409; satu keputusan terminal; step 2 aktif', async () => {
    const r = await high();
    const s1 = r.steps[0].id;
    const [a, b, waiters] = await overlap(
      'APPROVE',
      () => act(holder, as.managerA, r.id, s1, 'approve'),
      () => act(other, as.managerA2, r.id, s1, 'approve'),
    );
    expect(waiters).toBeGreaterThanOrEqual(1);
    expect([a.status, b.status]).toEqual([200, 409]);
    expect(b.body.code).toBe('STEP_NOT_ACTIVE');
    const { r: row, audit } = await state(r.id);
    expect(row.actions.filter((x) => x.stepId === s1 && ['APPROVE', 'REJECT'].includes(x.action))).toHaveLength(1);
    expect(row.steps.map((s) => s.status)).toEqual(['APPROVED', 'ACTIVE']);
    expect(row.steps[0].decidedBy).toBe(id['user:MANAGER-A']);
    expect([row.status, row.currentStepOrder]).toEqual(['PENDING', 2]);
    expect(audit).toEqual(['CREATED', 'SUBMITTED', 'APPROVED']);
  });

  it.each([
    ['approve menang', 'APPROVE', 'approve', 'reject', ['PENDING', 2], ['APPROVED', 'ACTIVE'], 'STEP_NOT_ACTIVE'],
    ['reject menang', 'REJECT', 'reject', 'approve', ['REJECTED', null], ['REJECTED', 'WAITING'], 'REQUEST_NOT_PENDING'],
  ] as const)('7. RACE-REJECT (%s): tepat satu keputusan terminal, state sesuai pemenang', async (_l, kind, firstAction, secondAction, expectedRequest, expectedSteps, loserCode) => {
    const r = await high();
    const s1 = r.steps[0].id;
    const [a, b] = await overlap(
      kind,
      () => act(holder, as.managerA, r.id, s1, firstAction),
      () => act(other, as.managerA2, r.id, s1, secondAction),
    );
    expect([a.status, b.status]).toEqual([200, 409]);
    expect(b.body.code).toBe(loserCode);
    const { r: row, audit } = await state(r.id);
    expect(row.actions.filter((x) => ['APPROVE', 'REJECT'].includes(x.action))).toHaveLength(1);
    expect([row.status, row.currentStepOrder]).toEqual(expectedRequest);
    expect(row.steps.map((s) => s.status)).toEqual(expectedSteps);
    expect(audit.filter((e) => e === 'APPROVED' || e === 'REJECTED')).toHaveLength(1);
  });

  it('8. submit paralel (A & B): satu 200, satu 409; satu snapshot & satu set langkah; satu audit SUBMITTED', async () => {
    const draft = await createRequest(other, as.employeeA, id['BR-A'], '15000000');
    const submit = (app: INestApplication) => request(app.getHttpServer()).post(`/api/v1/approval-requests/${draft}/submit`).set(as.employeeA);
    const [a, b, waiters] = await overlap('SUBMIT', () => submit(holder), () => submit(other));
    expect(waiters).toBeGreaterThanOrEqual(1);
    expect([a.status, b.status]).toEqual([200, 409]);
    expect(b.body.code).toBe('REQUEST_ALREADY_SUBMITTED');
    const { r: row, audit } = await state(draft);
    expect(row.steps.map((s) => [s.stepOrder, s.role, s.status])).toEqual([[1, 'MANAGER', 'ACTIVE'], [2, 'FINANCE', 'WAITING']]);
    expect(row.workflowSnapshot).toMatchObject({ key: 'WF-BUDGET', version: 1 });
    expect(audit.filter((e) => e === 'SUBMITTED')).toHaveLength(1);
  });

  it('12a. delegate vs approve (delegasi menang): approver lama ditolak NOT_ASSIGNEE; langkah tetap aktif ke penerima', async () => {
    const r = await high();
    const s1 = r.steps[0].id;
    const [a, b] = await overlap(
      'DELEGATE',
      () => act(holder, as.managerA, r.id, s1, 'delegate', { toUserId: id['user:MANAGER-A2'] }),
      () => act(other, as.managerA, r.id, s1, 'approve'),
    );
    expect([a.status, b.status]).toEqual([200, 403]);
    expect(b.body.code).toBe('NOT_ASSIGNEE');
    const { r: row, audit } = await state(r.id);
    expect([row.steps[0].status, row.steps[0].assigneeUserId]).toEqual(['ACTIVE', id['user:MANAGER-A2']]);
    expect(row.actions.map((x) => x.action)).toEqual(['DELEGATE']);
    expect(audit).toEqual(['CREATED', 'SUBMITTED', 'DELEGATED']);
  });

  it('12b. approve vs delegate (approve menang): delegasi ditolak STEP_NOT_ACTIVE; tidak ada penerima tercatat', async () => {
    const r = await high();
    const s1 = r.steps[0].id;
    const [a, b] = await overlap(
      'APPROVE',
      () => act(holder, as.managerA, r.id, s1, 'approve'),
      () => act(other, as.managerA, r.id, s1, 'delegate', { toUserId: id['user:MANAGER-A2'] }),
    );
    expect([a.status, b.status]).toEqual([200, 409]);
    expect(b.body.code).toBe('STEP_NOT_ACTIVE');
    const { r: row } = await state(r.id);
    expect([row.steps[0].status, row.steps[0].assigneeUserId]).toEqual(['APPROVED', null]);
    expect(row.actions.map((x) => x.action)).toEqual(['APPROVE']);
  });

  it('6b. tekanan tanpa penahanan: 6 approve serentak dari dua instance → tepat satu 200', async () => {
    const r = await high();
    const s1 = r.steps[0].id;
    const res = await Promise.all(
      [holder, other, holder, other, holder, other].map((app, i) => act(app, i % 2 ? as.managerA2 : as.managerA, r.id, s1, 'approve')),
    );
    expect(res.map((x) => x.status).sort()).toEqual([200, 409, 409, 409, 409, 409]);
    const { r: row } = await state(r.id);
    expect(row.actions.filter((x) => x.action === 'APPROVE')).toHaveLength(1);
  });

  describe('13. kegagalan sebelum commit membatalkan keputusan, status, dan audit bersama', () => {
    let faulty: INestApplication;
    let failKind: string | null = null;
    beforeAll(async () => {
      faulty = await createTestApp(undefined, {
        approvalHooks: {
          beforeCommit: (e) => {
            if (e.kind === failKind) throw new Error('injeksi kegagalan');
          },
        },
      });
    });
    afterAll(() => faulty.close());

    it.each(['APPROVE', 'REJECT', 'DELEGATE'] as const)('%s gagal → 500; tidak ada action, langkah & status tetap, audit tidak bertambah; retry berhasil', async (kind) => {
      const r = await high();
      const s1: StepView = r.steps[0];
      const before = await state(r.id);
      failKind = kind;
      const action = kind === 'APPROVE' ? 'approve' : kind === 'REJECT' ? 'reject' : 'delegate';
      const body = kind === 'DELEGATE' ? { toUserId: id['user:MANAGER-A2'] } : {};
      const res = await act(faulty, as.managerA, r.id, s1.id, action, body).expect(500);
      expect(JSON.stringify(res.body)).not.toContain('injeksi');
      const after = await state(r.id);
      expect(after.r.actions).toHaveLength(0);
      expect(after.r.steps.map((s) => [s.status, s.assigneeUserId])).toEqual(before.r.steps.map((s) => [s.status, s.assigneeUserId]));
      expect([after.r.status, after.r.version]).toEqual([before.r.status, before.r.version]);
      expect(after.audit).toEqual(before.audit);
      failKind = null;
      await act(other, as.managerA, r.id, s1.id, action, body).expect(200);
    });

    it('SUBMIT gagal → tetap DRAFT tanpa langkah/snapshot/audit SUBMITTED; retry berhasil', async () => {
      const draft = await createRequest(other, as.employeeA, id['BR-A'], '12000000');
      failKind = 'SUBMIT';
      await request(faulty.getHttpServer()).post(`/api/v1/approval-requests/${draft}/submit`).set(as.employeeA).expect(500);
      const after = await state(draft);
      expect([after.r.status, after.r.steps.length, after.r.workflowSnapshot, after.r.submittedAt]).toEqual(['DRAFT', 0, null, null]);
      expect(after.audit).toEqual(['CREATED']);
      failKind = null;
      await request(other.getHttpServer()).post(`/api/v1/approval-requests/${draft}/submit`).set(as.employeeA).expect(200);
    });
  });
});
