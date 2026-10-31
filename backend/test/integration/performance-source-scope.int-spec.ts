import { INestApplication } from '@nestjs/common';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { createTestApp, loginAs, USERS } from '../helpers/app';
import { ownerClient, resetDatabase, seedFixtures } from '../helpers/db';
import { importCsv, reconciliationBaseline, runRecon } from '../helpers/reconciliation';

type Headers = Record<string, string>;
const HEADER = 'transaction_id,organization_id,unit_id,account_id,reference,transaction_date,amount,currency,transaction_type';

/**
 * Celah Phase 04 (review): grant TANPA include_descendants di BR-A tidak boleh membaca revenue CC-A
 * (turunan BR-A) lewat KPI revenue BR-A yang dihitung dari BR-A + turunannya.
 * Actor khusus test dibuat di sini; fixture utama & grant seed tidak diubah.
 */
describe('Phase 04 — akses sumber KPI (include_descendants)', () => {
  let app: INestApplication;
  let owner: PrismaClient;
  const id: Record<string, string> = {};
  const as: Record<string, Headers> = {};
  const review: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const sep = () => id['PERIOD-SEP'];

  async function testUser(key: string, role: Role, unit: string, includeDescendants: boolean) {
    const template = await owner.user.findUniqueOrThrow({ where: { email: USERS.managerA } });
    const email = `${key.toLowerCase()}@example.test`;
    const u = await owner.user.create({ data: { externalKey: key, email, passwordHash: template.passwordHash } });
    await owner.userAccessGrant.create({ data: { userId: u.id, role, organizationId: id['ORG-1'], unitId: id[unit], includeDescendants } });
    as[key] = await loginAs(app, email);
  }

  beforeAll(async () => {
    owner = ownerClient();
    await resetDatabase(owner);
    await seedFixtures(owner);
    for (const u of await owner.orgUnit.findMany()) id[u.externalKey] = u.id;
    for (const o of await owner.organization.findMany()) id[o.externalKey] = o.id;
    for (const e of await owner.employee.findMany()) id[e.externalKey] = e.id;
    for (const p of await owner.reviewPeriod.findMany()) id[p.externalKey] = p.id;
    for (const k of await owner.kpiAssignment.findMany()) id[k.externalKey!] = k.id;
    app = await createTestApp();
    for (const [k, email] of Object.entries(USERS)) as[k] = await loginAs(app, email);
    await reconciliationBaseline(app, as.finance, id);
    await testUser('MGR-EXACT', 'MANAGER', 'BR-A', false);
    await testUser('HR-EXACT', 'HR', 'BR-A', false);
  });
  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  it('baseline (CC-A belum punya revenue): HR berwenang penuh → EMP-1 = 85', async () => {
    const res = await http().post('/api/v1/reviews/calculate').set(as.hr).send({ employeeId: id['EMP-1'], periodId: sep() }).expect(200);
    review['EMP-1'] = res.body.id;
    expect([res.body.items[0].actual, res.body.totalScore]).toEqual(['15000000', '85']);
  });

  it('setup: CC-A (turunan BR-A) mendapat revenue matched 2.000.000', async () => {
    const csv = (p: string) => `${HEADER}\n${p}CC1,ORG-1,CC-A,ACC-1,REF-CC1,2026-09-12,2000000,IDR,REVENUE`;
    const i = await importCsv(app, as.finance, id['CC-A'], 'INTERNAL', csv('I'));
    const e = await importCsv(app, as.finance, id['CC-A'], 'EXTERNAL', csv('E'));
    await runRecon(app, as.finance, i, e);
  });

  describe('actor berwenang penuh (include_descendants=true) tetap mendapat hasil lengkap', () => {
    it('MANAGER-A: detail EMP-1 berisi revenue BR-A + CC-A = 17 jt, skor 91', async () => {
      const res = await http().get(`/api/v1/reviews/${review['EMP-1']}`).set(as.managerA).expect(200);
      expect([res.body.items[0].actual, res.body.totalScore]).toEqual(['17000000', '91']);
    });

    it('MANAGER-A: RPE BR-A subtotal (BR-A + CC-A) 17 jt', async () => {
      const res = await http().get(`/api/v1/analytics/revenue-per-employee?periodId=${sep()}`).set(as.managerA).expect(200);
      const brA = res.body.units.find((u: { unit: { code: string } }) => u.unit.code === 'BR-A');
      expect(brA.subtotal.verifiedRevenue).toBe('17000000');
    });
  });

  describe('grant BR-A tanpa turunan (MGR-EXACT) tidak membuka data CC-A lewat review', () => {
    it('list: EMP-1 (KPI revenue mencakup CC-A) dikecualikan; EMP-2 tanpa sumber luar scope tetap tampil', async () => {
      const res = await http().get(`/api/v1/reviews?periodId=${sep()}`).set(as['MGR-EXACT']).expect(200);
      expect(res.body.items.map((i: { employee: { code: string } }) => i.employee.code)).toEqual(['EMP-2']);
      expect(JSON.stringify(res.body)).not.toContain(review['EMP-1']);
    });

    it('detail review DRAFT EMP-1 → 404 (tidak ada actual, target, skor, atau provenance yang terkirim)', async () => {
      const res = await http().get(`/api/v1/reviews/${review['EMP-1']}`).set(as['MGR-EXACT']).expect(404);
      expect(JSON.stringify(res.body)).not.toMatch(/17000000|20000000|"totalScore"/);
    });

    it('analitik RPE: hanya BR-A milik sendiri (15 jt), subtotal null PARTIAL_SCOPE, tanpa angka CC-A', async () => {
      const res = await http().get(`/api/v1/analytics/revenue-per-employee?periodId=${sep()}`).set(as['MGR-EXACT']).expect(200);
      expect(res.body.units.map((u: { unit: { code: string } }) => u.unit.code)).toEqual(['BR-A']);
      expect(res.body.units[0]).toMatchObject({ own: { verifiedRevenue: '15000000' }, subtotal: null, subtotalUnavailableReason: 'PARTIAL_SCOPE' });
      expect(JSON.stringify(res.body)).not.toMatch(/17000000|"2000000"/);
    });

    it('karyawan pindahan tetap dibatasi: EMP-3 (unit rumah BR-B) tidak tampil', async () => {
      const res = await http().get(`/api/v1/reviews?periodId=${sep()}`).set(as['MGR-EXACT']).expect(200);
      expect(JSON.stringify(res.body)).not.toContain('EMP-3');
    });
  });

  describe('HR BR-A tanpa turunan (HR-EXACT): preview, finalisasi, dan KPI menerapkan kebijakan yang sama', () => {
    it('preview & finalisasi EMP-1 → 404; ubah KPI EMP-1 → 404', async () => {
      await http().post('/api/v1/reviews/calculate').set(as['HR-EXACT']).send({ employeeId: id['EMP-1'], periodId: sep() }).expect(404);
      await http().post(`/api/v1/reviews/${review['EMP-1']}/finalize`).set(as['HR-EXACT']).expect(404);
      await http().patch(`/api/v1/kpi-assignments/${id['KPI-2']}`).set(as['HR-EXACT']).send({ actual: '9' }).expect(404);
      expect((await owner.performanceReview.findUniqueOrThrow({ where: { id: review['EMP-1'] } })).status).toBe('DRAFT');
      expect((await owner.kpiAssignment.findUniqueOrThrow({ where: { id: id['KPI-2'] } })).actual!.toString()).toBe('10');
    });

    it('membuat KPI revenue BR-A (yang mencakup CC-A) untuk EMP-2 → 404; KPI manual tetap boleh', async () => {
      const base = { employeeId: id['EMP-2'], periodId: sep(), weight: '40', target: '10' };
      await http().post('/api/v1/kpi-assignments').set(as['HR-EXACT']).send({ ...base, name: 'Revenue', source: 'VERIFIED_UNIT_REVENUE', unitId: id['BR-A'], weight: '60', target: '20000000' }).expect(404);
      await http().post('/api/v1/kpi-assignments').set(as['HR-EXACT']).send({ ...base, name: 'Pekerjaan selesai', source: 'MANUAL', actual: '10' }).expect(201);
    });
  });

  describe('snapshot FINAL tidak membocorkan sumber di luar scope', () => {
    it('HR penuh menambah KPI revenue EMP-2 & memfinalisasi (provenance mencakup CC-A)', async () => {
      await http()
        .post('/api/v1/kpi-assignments')
        .set(as.hr)
        .send({ employeeId: id['EMP-2'], periodId: sep(), name: 'Revenue cabang', source: 'VERIFIED_UNIT_REVENUE', unitId: id['BR-A'], weight: '60', target: '20000000' })
        .expect(201);
      const calc = await http().post('/api/v1/reviews/calculate').set(as.hr).send({ employeeId: id['EMP-2'], periodId: sep() }).expect(200);
      review['EMP-2'] = calc.body.id;
      const fin = await http().post(`/api/v1/reviews/${review['EMP-2']}/finalize`).set(as.hr).expect(200);
      expect(fin.body.provenance.revenueSources[0].unitIds).toEqual(expect.arrayContaining([id['BR-A'], id['CC-A']]));
      expect(fin.body.totalScore).toBe('91');
    });

    it('MGR-EXACT: review FINAL EMP-2 → 404, tidak ada di list, tidak dihitung di distribusi', async () => {
      await http().get(`/api/v1/reviews/${review['EMP-2']}`).set(as['MGR-EXACT']).expect(404);
      const list = await http().get(`/api/v1/reviews?periodId=${sep()}`).set(as['MGR-EXACT']).expect(200);
      expect(list.body.items).toEqual([]);
      const dist = await http().get(`/api/v1/analytics/performance?periodId=${sep()}`).set(as['MGR-EXACT']).expect(200);
      expect(dist.body.withinScope.count).toBe(0);
      expect(dist.body.units).toEqual([]);
      expect(JSON.stringify(dist.body)).not.toMatch(/"91"|"average":"9/);
    });

    it('MANAGER-A (penuh): review FINAL EMP-2 terbaca lengkap dan terhitung di distribusi', async () => {
      await http().get(`/api/v1/reviews/${review['EMP-2']}`).set(as.managerA).expect(200);
      const dist = await http().get(`/api/v1/analytics/performance?periodId=${sep()}`).set(as.managerA).expect(200);
      expect(dist.body.withinScope.count).toBe(1);
      const list = await http().get(`/api/v1/reviews?periodId=${sep()}`).set(as.managerA).expect(200);
      expect(list.body.items.map((i: { employee: { code: string } }) => i.employee.code)).toEqual(['EMP-1', 'EMP-2']);
    });

    it('HR penuh tetap bisa memfinalisasi EMP-1 (skor lengkap 91)', async () => {
      const fin = await http().post(`/api/v1/reviews/${review['EMP-1']}/finalize`).set(as.hr).expect(200);
      expect(fin.body.totalScore).toBe('91');
    });
  });

  describe('regresi: snapshot menyimpan seluruh cakupan sumber, termasuk unit tanpa transaksi', () => {
    it('Oktober: CC-A tanpa transaksi tetap tercatat di provenance; MGR-EXACT tetap 404/dikecualikan', async () => {
      const period = await http().post('/api/v1/review-periods').set(as.hr).send({ code: 'PERIOD-OKT', startDate: '2026-10-01', endDateExclusive: '2026-11-01' }).expect(201);
      const okt = period.body.id as string;
      const kpi = (body: Record<string, unknown>) => http().post('/api/v1/kpi-assignments').set(as.hr).send({ employeeId: id['EMP-1'], periodId: okt, ...body }).expect(201);
      await kpi({ name: 'Revenue cabang', source: 'VERIFIED_UNIT_REVENUE', unitId: id['BR-A'], weight: '60', target: '1000000' });
      await kpi({ name: 'Pekerjaan selesai', source: 'MANUAL', weight: '40', target: '10', actual: '10' });
      const calc = await http().post('/api/v1/reviews/calculate').set(as.hr).send({ employeeId: id['EMP-1'], periodId: okt }).expect(200);
      expect(await owner.financialTransaction.count({ where: { unitId: id['CC-A'], transactionDate: { gte: new Date('2026-10-01') } } })).toBe(0);
      const fin = await http().post(`/api/v1/reviews/${calc.body.id}/finalize`).set(as.hr).expect(200);
      const src = fin.body.provenance.revenueSources[0];
      expect(src).toMatchObject({ verifiedRevenue: '0', canonicalRunIds: [] });
      expect([...src.unitIds].sort()).toEqual([id['BR-A'], id['CC-A']].sort());
      await http().get(`/api/v1/reviews/${calc.body.id}`).set(as['MGR-EXACT']).expect(404);
      const list = await http().get(`/api/v1/reviews?periodId=${okt}`).set(as['MGR-EXACT']).expect(200);
      expect(list.body.items.map((i: { employee: { code: string } }) => i.employee.code)).not.toContain('EMP-1');
      await http().get(`/api/v1/reviews/${calc.body.id}`).set(as.managerA).expect(200);
    });
  });
});
