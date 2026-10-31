import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp, loginAs, USERS } from '../helpers/app';
import { ownerClient, resetDatabase, seedFixtures } from '../helpers/db';
import { reconciliationBaseline } from '../helpers/reconciliation';

type Headers = Record<string, string>;
type RunView = { id: string; unit: { code: string } };

/**
 * Phase 07 — riwayat rekonsiliasi > 100 run: paginasi & filter unit dilakukan server, bukan di browser atas
 * 100 run terbaru. BR-B hanya punya satu run yang lebih tua dari 110 run BR-A.
 */
describe('Phase 07 — riwayat rekonsiliasi lebih dari 100 run (PostgreSQL nyata)', () => {
  let app: INestApplication;
  let owner: PrismaClient;
  const id: Record<string, string> = {};
  const as: Record<string, Headers> = {};
  let brbRun: string;
  const http = () => request(app.getHttpServer());
  const list = (who: string, query: string) => http().get(`/api/v1/reconciliation-runs?${query}`).set(as[who]);

  beforeAll(async () => {
    owner = ownerClient();
    await resetDatabase(owner);
    await seedFixtures(owner);
    for (const u of await owner.orgUnit.findMany()) id[u.externalKey] = u.id;
    app = await createTestApp();
    for (const [k, email] of Object.entries(USERS)) as[k] = await loginAs(app, email);

    const base = await reconciliationBaseline(app, as.finance, id);
    brbRun = base.runs.bV1;
    const orgId = (await owner.orgUnit.findUniqueOrThrow({ where: { id: id['BR-A'] } })).organizationId;
    // Run BR-B dan baseline BR-A dibuat "kemarin"; 110 run BR-A tambahan lebih baru (data uji langsung di DB test).
    const yesterday = new Date(Date.now() - 86_400_000);
    await owner.reconciliationRun.updateMany({ where: { id: { in: [base.runs.aV1, base.runs.bV1] } }, data: { createdAt: yesterday } });
    await owner.reconciliationRun.update({ where: { id: base.runs.bV1 }, data: { createdAt: new Date(yesterday.getTime() - 60_000) } });
    const ext = await owner.transactionDataset.create({
      data: { organizationId: orgId, unitId: id['BR-A'], accountId: 'ACC-HIST', side: 'EXTERNAL', fingerprint: 'hist-ext', rowCount: 0 },
    });
    const now = Date.now();
    for (let i = 0; i < 110; i++) {
      const internal = await owner.transactionDataset.create({
        data: { organizationId: orgId, unitId: id['BR-A'], accountId: 'ACC-HIST', side: 'INTERNAL', fingerprint: `hist-int-${i}`, rowCount: 0 },
      });
      await owner.reconciliationRun.create({
        data: {
          organizationId: orgId,
          unitId: id['BR-A'],
          accountId: 'ACC-HIST',
          internalDatasetId: internal.id,
          externalDatasetId: ext.id,
          ruleVersion: 'v1',
          dateToleranceDays: 1,
          amountTolerance: '0',
          // 10 run terakhir sengaja memakai created_at yang sama untuk menguji urutan stabil.
          createdAt: new Date(i >= 100 ? now : now - (100 - i) * 1000),
          completedAt: new Date(),
        },
      });
    }
  });
  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  it('total 112; halaman 1 (100 terbaru) tidak memuat BR-B; halaman 2 memuatnya', async () => {
    const p1 = await list('finance', 'page=1&pageSize=100').expect(200);
    expect(p1.body.total).toBe(112);
    expect(p1.body.items).toHaveLength(100);
    expect((p1.body.items as RunView[]).some((r) => r.unit.code === 'BR-B')).toBe(false);
    const p2 = await list('finance', 'page=2&pageSize=100').expect(200);
    expect(p2.body.items).toHaveLength(12);
    expect((p2.body.items as RunView[]).at(-1)!.id).toBe(brbRun);
  });

  it('filter unitId=BR-B di server menemukan run yang berada di luar 100 terbaru', async () => {
    const res = await list('finance', `unitId=${id['BR-B']}&page=1&pageSize=10`).expect(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items.map((r: RunView) => r.id)).toEqual([brbRun]);
    const brA = await list('finance', `unitId=${id['BR-A']}&page=12&pageSize=10`).expect(200);
    expect(brA.body.total).toBe(111);
    expect(brA.body.items).toHaveLength(1);
  });

  it('paginasi stabil: halaman kecil tidak menggandakan/menghilangkan run walau created_at sama', async () => {
    const seen: string[] = [];
    for (let page = 1; page <= 12; page++) {
      const res = await list('finance', `page=${page}&pageSize=10`).expect(200);
      seen.push(...res.body.items.map((r: RunView) => r.id));
    }
    expect(seen).toHaveLength(112);
    expect(new Set(seen).size).toBe(112);
  });

  it('deep link ke run lama: detail & ringkasan run BR-B tetap terbuka', async () => {
    await http().get(`/api/v1/reconciliation-runs/${brbRun}`).set(as.finance).expect(200);
    const sum = await http().get(`/api/v1/reconciliation-runs/${brbRun}/summary`).set(as.finance).expect(200);
    expect(sum.body.verifiedRevenue).toBe('6000000');
  });

  it('scope tetap berlaku: Manager A tidak bisa memfilter BR-B; Manager B hanya melihat run BR-B', async () => {
    await list('managerA', `unitId=${id['BR-B']}`).expect(404);
    const b = await list('managerB', 'page=1&pageSize=100').expect(200);
    expect(b.body.total).toBe(1);
    expect(b.body.items[0].id).toBe(brbRun);
    await list('finance', 'pageSize=101').expect(400);
  });
});
