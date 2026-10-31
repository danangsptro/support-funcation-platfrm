import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import type { Actor } from '../../src/modules/access/actor';
import { ActorService } from '../../src/modules/access/actor.service';
import { Permission } from '../../src/modules/access/permissions';
import { ScopeService } from '../../src/modules/access/scope.service';
import { createTestApp, loginAs, USERS } from '../helpers/app';
import { ownerClient, resetDatabase, seedFixtures } from '../helpers/db';

type Headers = Record<string, string>;

describe('Phase 02 — RBAC & data scoping (PostgreSQL nyata)', () => {
  let app: INestApplication;
  let owner: PrismaClient;
  const id: Record<string, string> = {};
  const as: Record<string, Headers> = {};
  const http = () => request(app.getHttpServer());
  const codes = (items: { code: string }[]) => items.map((i) => i.code).sort();

  beforeAll(async () => {
    owner = ownerClient();
    await resetDatabase(owner);
    await seedFixtures(owner);
    for (const u of await owner.orgUnit.findMany()) id[u.externalKey] = u.id;
    for (const o of await owner.organization.findMany()) id[o.externalKey] = o.id;
    for (const e of await owner.employee.findMany()) id[e.externalKey] = e.id;
    app = await createTestApp();
    for (const [key, email] of Object.entries(USERS)) as[key] = await loginAs(app, email);
  });
  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  describe('list org unit sesuai grant', () => {
    it.each([
      ['admin', ['BR-A', 'BR-B', 'BR-ZERO', 'CC-A', 'DIV-1']],
      ['hr', ['BR-A', 'BR-B', 'BR-ZERO', 'CC-A', 'DIV-1']],
      ['managerA', ['BR-A', 'CC-A']],
      ['managerB', ['BR-B']],
      ['outsider', ['BR-X']],
    ])('%s melihat %j', async (who, expected) => {
      const res = await http().get('/api/v1/org-units').set(as[who]).expect(200);
      expect(codes(res.body.items)).toEqual(expected);
      expect(res.body.total).toBe(expected.length);
    });

    it('induk di luar scope tidak dibocorkan (BR-A milik DIV-1 → parentId null bagi MANAGER-A)', async () => {
      const res = await http().get(`/api/v1/org-units/${id['BR-A']}`).set(as.managerA).expect(200);
      expect(res.body.parentId).toBeNull();
      expect(codes(res.body.children)).toEqual(['CC-A']);
    });
  });

  describe('detail di luar scope → 404', () => {
    it('T-SEC-01 MANAGER-A detail BR-B → 404', async () => {
      const res = await http().get(`/api/v1/org-units/${id['BR-B']}`).set(as.managerA).expect(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });

    it('T-SEC-02 ADMIN ORG-1 detail BR-X (ORG-2) → 404; OUTSIDER detail BR-A → 404', async () => {
      await http().get(`/api/v1/org-units/${id['BR-X']}`).set(as.admin).expect(404);
      await http().get(`/api/v1/org-units/${id['BR-A']}`).set(as.outsider).expect(404);
    });

    it('UUID acak sama-sama 404 (tidak membedakan tidak ada vs terlarang)', async () => {
      const a = await http().get('/api/v1/org-units/00000000-0000-4000-8000-000000000000').set(as.managerA).expect(404);
      const b = await http().get(`/api/v1/org-units/${id['BR-B']}`).set(as.managerA).expect(404);
      expect(a.body.message).toBe(b.body.message);
    });

    it('karyawan: MANAGER-A tidak melihat EMP-4 (hanya pernah di BR-B)', async () => {
      await http().get(`/api/v1/employees/${id['EMP-4']}`).set(as.managerA).expect(404);
      await http().get(`/api/v1/employees/${id['EMP-1']}`).set(as.managerA).expect(200);
    });
  });

  describe('T-SEC-03 tanpa permission → 403', () => {
    it('NO-GRANT dan REQUESTER tidak boleh membaca master', async () => {
      for (const who of ['noGrant', 'employeeA']) {
        const res = await http().get('/api/v1/org-units').set(as[who]).expect(403);
        expect(res.body.code).toBe('FORBIDDEN');
        await http().get('/api/v1/employees').set(as[who]).expect(403);
      }
    });
  });

  describe('karyawan dalam scope', () => {
    it('MANAGER-A: EMP-1, EMP-2, EMP-3 (riwayat BR-B EMP-3 disembunyikan)', async () => {
      const res = await http().get('/api/v1/employees').set(as.managerA).expect(200);
      expect(codes(res.body.items)).toEqual(['EMP-1', 'EMP-2', 'EMP-3']);
      const emp3 = res.body.items.find((e: { code: string }) => e.code === 'EMP-3');
      expect(emp3.assignments.map((a: { unitCode: string }) => a.unitCode)).toEqual(['BR-A']);
    });

    it('ADMIN melihat seluruh karyawan ORG-1 termasuk riwayat lengkap', async () => {
      const res = await http().get('/api/v1/employees').set(as.admin).expect(200);
      expect(codes(res.body.items)).toEqual(['EMP-1', 'EMP-2', 'EMP-3', 'EMP-4']);
      const emp3 = res.body.items.find((e: { code: string }) => e.code === 'EMP-3');
      expect(emp3.assignments.map((a: { unitCode: string }) => a.unitCode)).toEqual(['BR-A', 'BR-B']);
    });

    it('OUTSIDER (ADMIN ORG-2) tidak melihat karyawan ORG-1', async () => {
      const res = await http().get('/api/v1/employees').set(as.outsider).expect(200);
      expect(res.body).toMatchObject({ items: [], total: 0 });
    });
  });

  describe('agregat ber-scope', () => {
    it('MANAGER-A per 2026-09-10: BR-A 2 (EMP-1, EMP-3), CC-A 0; tidak ada BR-B', async () => {
      const res = await http().get('/api/v1/employees/summary?asOf=2026-09-10').set(as.managerA).expect(200);
      expect(res.body.total).toBe(2);
      expect(res.body.byUnit.map((u: { code: string; count: number }) => [u.code, u.count])).toEqual([
        ['BR-A', 2],
        ['CC-A', 0],
      ]);
    });

    it('ADMIN per 2026-09-20: BR-A 2 (EMP-1, EMP-2), BR-B 2 (EMP-3, EMP-4); total 4', async () => {
      const res = await http().get('/api/v1/employees/summary?asOf=2026-09-20').set(as.admin).expect(200);
      const byCode = Object.fromEntries(res.body.byUnit.map((u: { code: string; count: number }) => [u.code, u.count]));
      expect(byCode).toEqual({ 'BR-A': 2, 'BR-B': 2, 'BR-ZERO': 0, 'CC-A': 0, 'DIV-1': 0 });
      expect(res.body.total).toBe(4);
    });

    it('asOf tidak valid → 400', async () => {
      await http().get('/api/v1/employees/summary?asOf=2026-02-30').set(as.admin).expect(400);
    });
  });

  describe('manipulasi input tidak memperluas akses', () => {
    it('ADMIN ORG-1 memfilter organizationId=ORG-2 → 404', async () => {
      await http().get(`/api/v1/org-units?organizationId=${id['ORG-2']}`).set(as.admin).expect(404);
    });

    it('MANAGER-A memfilter unitId=BR-B atau parentId=DIV-1 → 404', async () => {
      await http().get(`/api/v1/employees?unitId=${id['BR-B']}`).set(as.managerA).expect(404);
      await http().get(`/api/v1/org-units?parentId=${id['DIV-1']}`).set(as.managerA).expect(404);
    });

    it('parameter tak dikenal (mis. scope=all) dan pagination di luar batas → 400', async () => {
      await http().get('/api/v1/org-units?scope=all').set(as.managerA).expect(400);
      await http().get('/api/v1/org-units?pageSize=1000').set(as.admin).expect(400);
      await http().get('/api/v1/org-units?page=0').set(as.admin).expect(400);
      await http().get('/api/v1/org-units/bukan-uuid').set(as.admin).expect(400);
    });

    it('pagination bekerja di dalam scope', async () => {
      const p1 = await http().get('/api/v1/org-units?page=1&pageSize=2').set(as.admin).expect(200);
      const p3 = await http().get('/api/v1/org-units?page=3&pageSize=2').set(as.admin).expect(200);
      expect(p1.body).toMatchObject({ page: 1, pageSize: 2, total: 5 });
      expect(p1.body.items).toHaveLength(2);
      expect(p3.body.items).toHaveLength(1);
    });
  });

  describe('mutasi master ber-scope + audit', () => {
    it('ADMIN mengganti nama BR-A → 200 dan audit tercatat di transaksi yang sama', async () => {
      const res = await http()
        .patch(`/api/v1/org-units/${id['BR-A']}`)
        .set({ ...as.admin, 'x-request-id': 'rename-br-a' })
        .send({ name: 'Cabang A' })
        .expect(200);
      expect(res.body.name).toBe('Cabang A');
      const audit = await owner.auditEvent.findFirstOrThrow({ where: { entityId: id['BR-A'], eventType: 'ORG_UNIT_RENAMED' } });
      expect(audit).toMatchObject({ traceId: 'rename-br-a', payload: { from: 'BR-A', to: 'Cabang A' } });
    });

    it('ADMIN ORG-1 mengubah BR-X → 404 dan nama tidak berubah', async () => {
      await http().patch(`/api/v1/org-units/${id['BR-X']}`).set(as.admin).send({ name: 'diretas' }).expect(404);
      expect((await owner.orgUnit.findUniqueOrThrow({ where: { id: id['BR-X'] } })).name).toBe('BR-X');
    });

    it('MANAGER-A / HR tidak punya org.manage → 403', async () => {
      await http().patch(`/api/v1/org-units/${id['BR-A']}`).set(as.managerA).send({ name: 'x' }).expect(403);
      await http().patch(`/api/v1/org-units/${id['BR-A']}`).set(as.hr).send({ name: 'x' }).expect(403);
    });

    it('body dengan organizationId sisipan → 400', async () => {
      await http()
        .patch(`/api/v1/org-units/${id['BR-A']}`)
        .set(as.admin)
        .send({ name: 'x', organizationId: id['ORG-2'] })
        .expect(400);
    });
  });

  describe('grant terikat: role tidak dipinjam ke scope grant lain', () => {
    let actor: Actor;
    let scopes: ScopeService;

    beforeAll(async () => {
      // User test-only: FINANCE di BR-A + MANAGER di BR-B. Tidak ada di seed.
      const user = await owner.user.create({
        data: { externalKey: 'MIXED', email: 'mixed@example.test', passwordHash: 'x' },
      });
      await owner.userAccessGrant.createMany({
        data: [
          { userId: user.id, role: 'FINANCE', organizationId: id['ORG-1'], unitId: id['BR-A'] },
          { userId: user.id, role: 'MANAGER', organizationId: id['ORG-1'], unitId: id['BR-B'] },
        ],
      });
      actor = (await app.get(ActorService).load(user.id)) as Actor;
      scopes = app.get(ScopeService);
    });

    it('scope dataset.import (FINANCE) hanya subtree BR-A', async () => {
      const scope = await scopes.resolve(actor, Permission.DatasetImport);
      expect(scope.hasUnit(id['BR-A'])).toBe(true);
      expect(scope.hasUnit(id['CC-A'])).toBe(true);
      expect(scope.hasUnit(id['BR-B'])).toBe(false);
    });

    it('scope approval.decide (FINANCE + MANAGER) = BR-A ∪ BR-B', async () => {
      const scope = await scopes.resolve(actor, Permission.ApprovalDecide);
      expect(['BR-A', 'CC-A', 'BR-B'].every((c) => scope.hasUnit(id[c]))).toBe(true);
      expect(scope.hasUnit(id['DIV-1'])).toBe(false);
    });

    it('permission tanpa grant pemberi → scope kosong', async () => {
      const scope = await scopes.resolve(actor, Permission.ReviewManage);
      expect(scope.isEmpty).toBe(true);
    });
  });
});
