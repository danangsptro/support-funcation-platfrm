import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import request from 'supertest';
import { readFixture, readFixtureJson } from '../fixtures/fixtures';
import { createTestApp, loginAs, USERS } from '../helpers/app';
import { ownerClient, resetDatabase, seedFixtures } from '../helpers/db';
import { importCsv, reconciliationBaseline, runRecon } from '../helpers/reconciliation';

type Headers = Record<string, string>;
type UnitRow = {
  unit: { id: string; code: string; parentId: string | null };
  own: { verifiedRevenue: string; recordedRevenue: string; employeeDays: number; averageHeadcount: string; rpe: string | null; canonicalRunIds: string[] };
  subtotal: UnitRow['own'] | null;
  subtotalUnavailableReason: string | null;
  benchmark: { parentUnitId: string; parentRpe: string | null; difference: string | null; index: string | null } | null;
  benchmarkUnavailableReason: string | null;
};
const HEADER = 'transaction_id,organization_id,unit_id,account_id,reference,transaction_date,amount,currency,transaction_type';

describe('Phase 04 — performa & revenue per employee (PostgreSQL nyata)', () => {
  let app: INestApplication;
  let owner: PrismaClient;
  const id: Record<string, string> = {};
  const as: Record<string, Headers> = {};
  let baseline: Awaited<ReturnType<typeof reconciliationBaseline>>;
  const review: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const rpe = (who: string, periodId = id['PERIOD-SEP'], extra = '') =>
    http().get(`/api/v1/analytics/revenue-per-employee?periodId=${periodId}${extra}`).set(as[who]);
  const byCode = (units: UnitRow[]) => Object.fromEntries(units.map((u) => [u.unit.code, u]));
  const calc = (employee: string, who = 'hr') =>
    http().post('/api/v1/reviews/calculate').set(as[who]).send({ employeeId: id[employee], periodId: id['PERIOD-SEP'] });
  const kpi = (body: Record<string, unknown>) =>
    http().post('/api/v1/kpi-assignments').set(as.hr).send({ periodId: id['PERIOD-SEP'], source: 'MANUAL', name: 'KPI test', ...body });

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
    for (const [key, email] of Object.entries(USERS)) as[key] = await loginAs(app, email);
    baseline = await reconciliationBaseline(app, as.finance, id);
  });
  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  describe('1. baseline RPE vs hr/expected-results.json', () => {
    const hr = readFixtureJson<{ branches: { unit_id: string; employee_days: number; average_headcount: string; verified_revenue: string; rpe: string | null }[]; division: { verified_revenue: string; average_headcount: string; rpe: string } }>(
      'hr/expected-results.json',
    );

    it('HR (DIV-1): cabang, BR-ZERO null, dan DIV-1 = 21.000.000 / 3,5 = 6.000.000 (ratio of sums)', async () => {
      const res = await rpe('hr').expect(200);
      const u = byCode(res.body.units);
      for (const b of hr.branches) {
        expect([b.unit_id, u[b.unit_id].own.verifiedRevenue, u[b.unit_id].own.employeeDays, u[b.unit_id].own.averageHeadcount, u[b.unit_id].own.rpe]).toEqual([
          b.unit_id,
          b.verified_revenue,
          b.employee_days,
          b.average_headcount,
          b.rpe,
        ]);
      }
      expect(u['DIV-1'].subtotal).toMatchObject({ verifiedRevenue: hr.division.verified_revenue, averageHeadcount: hr.division.average_headcount, rpe: hr.division.rpe, employeeDays: 105 });
      expect(u['DIV-1'].own.rpe).toBeNull(); // DIV-1 sendiri tanpa karyawan & transaksi
      expect(u['BR-A'].own.recordedRevenue).toBe('22900000'); // tercatat ≠ terverifikasi
      expect(u['BR-A'].own.canonicalRunIds).toEqual([baseline.runs.aV1]);
      expect(u['BR-A'].benchmark).toEqual({ parentUnitId: id['DIV-1'], parentRpe: '6000000', difference: '1500000', index: '1.25' });
      expect(res.body.branchSpread).toMatchObject({ highest: { unitId: id['BR-A'], rpe: '7500000' }, lowest: { unitId: id['BR-B'], rpe: '4000000' }, difference: '3500000', branchesWithoutRpe: [id['BR-ZERO']] });
      expect(res.body.organizationTotal).toBeNull(); // HR bukan grant seluruh organisasi
      expect(res.body.period).toMatchObject({ code: 'PERIOD-SEP', days: 30 });
    });

    it('EMP-1 via API: revenue 15 jt / 20 jt = 75% × 60 = 45; manual 100% × 40 = 40; total 85 → final dengan provenance v1', async () => {
      const expected = readFixtureJson<{ employee_review: { kpi_scores: { id: string; achievement_percent: string; weighted_score: string }[]; total_score: string } }>('hr/expected-results.json').employee_review;
      const res = await calc('EMP-1').expect(200);
      review['EMP-1'] = res.body.id;
      expect(res.body).toMatchObject({ status: 'DRAFT', isSnapshot: false, unit: { code: 'BR-A' }, canFinalize: true, weightTotal: '100' });
      expect(res.body.items.map((i: { achievement: string; weightedScore: string }, n: number) => ({ id: `KPI-${n + 1}`, achievement_percent: i.achievement, weighted_score: i.weightedScore }))).toEqual(expected.kpi_scores);
      expect(res.body.items[0].actual).toBe('15000000');
      expect(res.body.totalScore).toBe(expected.total_score);

      const fin = await http().post(`/api/v1/reviews/${review['EMP-1']}/finalize`).set(as.hr).expect(200);
      expect(fin.body).toMatchObject({ status: 'FINALIZED', isSnapshot: true, formulaVersion: 'kpi-v1', totalScore: '85' });
      expect(fin.body.provenance.revenueSources).toEqual([
        expect.objectContaining({ unitCode: 'BR-A', verifiedRevenue: '15000000', ruleVersions: ['v1'], canonicalRunIds: [baseline.runs.aV1] }),
      ]);
      const again = await http().post(`/api/v1/reviews/${review['EMP-1']}/finalize`).set(as.hr).expect(409);
      expect(again.body.code).toBe('REVIEW_ALREADY_FINALIZED');
      await http().patch(`/api/v1/kpi-assignments/${id['KPI-2']}`).set(as.hr).send({ actual: '5' }).expect(409);
      await kpi({ employeeId: id['EMP-1'], weight: '10', target: '10', actual: '1' }).expect(409);
      expect(await owner.performanceReview.count({ where: { employeeId: id['EMP-1'], periodId: id['PERIOD-SEP'] } })).toBe(1);
      expect(await owner.reviewItem.count({ where: { reviewId: review['EMP-1'] } })).toBe(2);
    });

    it('ADMIN (seluruh ORG-1): total organisasi 21.000.000, BR-X (ORG-2) tidak ikut', async () => {
      const res = await rpe('admin').expect(200);
      expect(res.body.organizationTotal).toMatchObject({ verifiedRevenue: '21000000', rpe: '6000000' });
      expect(Object.keys(byCode(res.body.units))).not.toContain('BR-X');
    });

    it('filter unitId hanya mempersempit; unit di luar scope → 404', async () => {
      const res = await rpe('hr', id['PERIOD-SEP'], `&unitId=${id['BR-A']}`).expect(200);
      expect(Object.keys(byCode(res.body.units)).sort()).toEqual(['BR-A', 'CC-A']);
      // Regresi: induk tersaring filter tetap dipakai sebagai benchmark bila pembaca berwenang atasnya.
      expect(byCode(res.body.units)['BR-A'].benchmark).toMatchObject({ parentUnitId: id['DIV-1'], parentRpe: '6000000' });
      await rpe('managerA', id['PERIOD-SEP'], `&unitId=${id['DIV-1']}`).expect(404);
      await rpe('managerA', id['PERIOD-SEP'], `&unitId=${id['BR-B']}`).expect(404);
    });
  });

  describe('10a. benchmark induk & agregat tidak bocor', () => {
    it('MANAGER-A: hanya BR-A & CC-A; benchmark DIV-1 unavailable; angka cabang lain/divisi tidak muncul', async () => {
      const res = await rpe('managerA').expect(200);
      const u = byCode(res.body.units);
      expect(Object.keys(u).sort()).toEqual(['BR-A', 'CC-A']);
      expect(u['BR-A'].subtotal).toMatchObject({ verifiedRevenue: '15000000', rpe: '7500000' });
      expect([u['BR-A'].benchmark, u['BR-A'].benchmarkUnavailableReason, u['BR-A'].unit.parentId]).toEqual([null, 'PARENT_OUT_OF_SCOPE', null]);
      const raw = JSON.stringify(res.body);
      for (const leaked of ['21000000', '6000000', '4000000', id['DIV-1'], id['BR-B']]) expect(raw).not.toContain(leaked);
      expect(res.body.organizationTotal).toBeNull();
      expect(res.body.branchSpread).toBeNull(); // hanya satu cabang dalam scope
    });

    it('FINANCE boleh RPE, tetapi tidak membaca review/distribusi skor', async () => {
      await rpe('finance').expect(200);
      await http().get(`/api/v1/analytics/performance?periodId=${id['PERIOD-SEP']}`).set(as.finance).expect(403);
      await http().get(`/api/v1/reviews?periodId=${id['PERIOD-SEP']}`).set(as.finance).expect(403);
    });

    it('periode organisasi lain → 404; tanpa grant → 403', async () => {
      await rpe('outsider').expect(404);
      await rpe('noGrant').expect(403);
    });
  });

  describe('6–7. revenue: periode, unmatched, organisasi lain', () => {
    it('periode Oktober dibuat HR; transaksi Oktober tidak masuk September (dan sebaliknya)', async () => {
      const created = await http().post('/api/v1/review-periods').set(as.hr).send({ code: 'PERIOD-OKT', startDate: '2026-10-01', endDateExclusive: '2026-11-01' }).expect(201);
      id['PERIOD-OKT'] = created.body.id;
      await http().post('/api/v1/review-periods').set(as.hr).send({ code: 'PERIOD-OKT', startDate: '2026-10-01', endDateExclusive: '2026-11-01' }).expect(409);
      await http().post('/api/v1/review-periods').set(as.hr).send({ code: 'BAD', startDate: '2026-10-05', endDateExclusive: '2026-10-01' }).expect(400);
      await http().post('/api/v1/review-periods').set(as.managerA).send({ code: 'X-1', startDate: '2026-10-01', endDateExclusive: '2026-11-01' }).expect(403);

      const oct = (prefix: string, amount: string) => `${HEADER}\n${prefix}20,ORG-1,BR-A,ACC-1,REF-020,2026-10-05,${amount},IDR,REVENUE\n${prefix}21,ORG-1,BR-A,ACC-1,REF-021,2026-09-30,${amount},IDR,REVENUE`;
      // REF-021 internal 30 Sep, eksternal 30 Sep → masuk September; REF-020 5 Okt → masuk Oktober.
      const i = await importCsv(app, as.finance, id['BR-A'], 'INTERNAL', oct('I', '1000000'));
      const e = await importCsv(app, as.finance, id['BR-A'], 'EXTERNAL', oct('E', '1000000'));
      await runRecon(app, as.finance, i, e);

      const sep = byCode((await rpe('hr').expect(200)).body.units);
      expect(sep['BR-A'].own.verifiedRevenue).toBe('16000000'); // 15 jt + REF-021 (30 Sep)
      const okt = byCode((await rpe('hr', id['PERIOD-OKT']).expect(200)).body.units);
      expect(okt['BR-A'].own).toMatchObject({ verifiedRevenue: '1000000', employeeDays: 62, averageHeadcount: '2', rpe: '500000' });
      expect(okt['BR-B'].own).toMatchObject({ verifiedRevenue: '0', employeeDays: 62 }); // EMP-3 & EMP-4 penuh Oktober
    });

    it('transaksi unmatched tidak menambah verified revenue (I3, I4, I5, I6, I7 BR-A tetap di luar)', async () => {
      const u = byCode((await rpe('hr').expect(200)).body.units);
      expect(new Set([u['BR-A'].own.verifiedRevenue, u['BR-A'].own.recordedRevenue]).size).toBe(2);
      expect(u['BR-A'].own.recordedRevenue).toBe('23900000'); // 22,9 jt + REF-021
    });

    it('ORG-2 BR-X matched 9.000.000 hanya terlihat oleh ORG-2, RPE null (tanpa karyawan)', async () => {
      const outsider = await owner.user.findUniqueOrThrow({ where: { email: USERS.outsider } });
      const fin2 = await owner.user.create({ data: { externalKey: 'FIN-ORG2', email: 'finance-org2@example.test', passwordHash: outsider.passwordHash } });
      await owner.userAccessGrant.create({ data: { userId: fin2.id, role: 'FINANCE', organizationId: id['ORG-2'], unitId: id['BR-X'] } });
      const headers = await loginAs(app, 'finance-org2@example.test');
      const scoped = (f: string) => readFixture(`reconciliation/scoped/${f}`);
      const i = await importCsv(app, headers, id['BR-X'], 'INTERNAL', scoped('ORG-2-BR-X-internal.csv'), 'ACC-2');
      const e = await importCsv(app, headers, id['BR-X'], 'EXTERNAL', scoped('ORG-2-BR-X-external.csv'), 'ACC-2');
      await runRecon(app, headers, i, e);
      const p2 = await owner.reviewPeriod.create({ data: { organizationId: id['ORG-2'], externalKey: 'P2-SEP', startDate: new Date('2026-09-01'), endDateExclusive: new Date('2026-10-01') } });

      const org2 = await rpe('outsider', p2.id).expect(200);
      expect(org2.body.organizationTotal).toMatchObject({ verifiedRevenue: '9000000', employeeDays: 0, rpe: null });
      const org1 = await rpe('admin').expect(200);
      expect(org1.body.organizationTotal.verifiedRevenue).toBe('22000000'); // 21 jt + REF-021; tanpa 9 jt ORG-2
      expect(JSON.stringify(org1.body)).not.toContain('9000000');
    });
  });

  describe('2–4. KPI, validasi, bobot, cap', () => {
    it.each([
      ['target nol', { target: '0', weight: '10', actual: '1' }],
      ['target negatif', { target: '-1', weight: '10', actual: '1' }],
      ['actual negatif', { target: '10', weight: '10', actual: '-5' }],
      ['bobot nol', { target: '10', weight: '0', actual: '1' }],
      ['bobot > 100', { target: '10', weight: '100.5', actual: '1' }],
      ['target berupa number (bukan string desimal)', { target: 10, weight: '10', actual: '1' }],
      ['bobot 3 desimal', { target: '10', weight: '10.125', actual: '1' }],
    ])('%s → 400 VALIDATION_ERROR', async (_l, body) => {
      const res = await kpi({ employeeId: id['EMP-2'], ...body }).expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('aturan sumber KPI: revenue wajib unit & tanpa actual; manual tanpa unit; unit revenue harus unit rumah/turunannya', async () => {
      await kpi({ employeeId: id['EMP-2'], source: 'VERIFIED_UNIT_REVENUE', weight: '10', target: '10' }).expect(400);
      await kpi({ employeeId: id['EMP-2'], source: 'VERIFIED_UNIT_REVENUE', unitId: id['BR-A'], weight: '10', target: '10', actual: '5' }).expect(400);
      await kpi({ employeeId: id['EMP-2'], unitId: id['BR-A'], weight: '10', target: '10' }).expect(400);
      const out = await kpi({ employeeId: id['EMP-2'], source: 'VERIFIED_UNIT_REVENUE', unitId: id['BR-B'], weight: '10', target: '10' }).expect(400);
      expect(out.body.code).toBe('KPI_UNIT_OUT_OF_RANGE');
      await http().patch(`/api/v1/kpi-assignments/${id['KPI-1']}`).set(as.hr).send({ actual: '1' }).expect(400);
      await http().patch(`/api/v1/kpi-assignments/${id['KPI-2']}`).set(as.hr).send({ target: '0' }).expect(400);
    });

    it('3. BAD-WEIGHTS 60 + 30 → preview menandai, finalisasi 409; setelah 60 + 40 bisa', async () => {
      await kpi({ employeeId: id['EMP-2'], source: 'VERIFIED_UNIT_REVENUE', unitId: id['BR-A'], name: 'Revenue cabang', weight: '60', target: '20000000' }).expect(201);
      const manual = await kpi({ employeeId: id['EMP-2'], name: 'Pekerjaan selesai', weight: '30', target: '10', actual: '10' }).expect(201);
      const preview = await calc('EMP-2').expect(200);
      review['EMP-2'] = preview.body.id;
      expect(preview.body).toMatchObject({ canFinalize: false, problems: ['WEIGHT_TOTAL_NOT_100'], weightTotal: '90' });
      const rejected = await http().post(`/api/v1/reviews/${review['EMP-2']}/finalize`).set(as.hr).expect(409);
      expect(rejected.body).toMatchObject({ code: 'FINALIZE_REJECTED', details: { problems: ['WEIGHT_TOTAL_NOT_100'], weightTotal: '90' } });
      expect((await owner.performanceReview.findUniqueOrThrow({ where: { id: review['EMP-2'] } })).status).toBe('DRAFT');
      await http().patch(`/api/v1/kpi-assignments/${manual.body.kpiId}`).set(as.hr).send({ weight: '40' }).expect(200);
      expect((await calc('EMP-2').expect(200)).body.canFinalize).toBe(true);
    });

    it('4. cap 120%: EMP-4 manual 15/10 bobot 100 → skor 120', async () => {
      await kpi({ employeeId: id['EMP-4'], name: 'Target kunjungan', weight: '100', target: '10', actual: '15' }).expect(201);
      const res = await calc('EMP-4').expect(200);
      review['EMP-4'] = res.body.id;
      expect(res.body.items[0]).toMatchObject({ achievement: '150', cappedAchievement: '120', weightedScore: '120' });
      expect(res.body.totalScore).toBe('120');
    });

    it('actual kosong → MISSING_ACTUAL (EMP-3, unit rumah BR-B)', async () => {
      await kpi({ employeeId: id['EMP-3'], name: 'Pekerjaan selesai', weight: '100', target: '10' }).expect(201);
      const res = await calc('EMP-3').expect(200);
      review['EMP-3'] = res.body.id;
      expect(res.body).toMatchObject({ unit: { code: 'BR-B' }, canFinalize: false, problems: ['MISSING_ACTUAL'], totalScore: null });
    });
  });

  describe('9. finalisasi & snapshot', () => {
    it('8 & 11. finalisasi EMP-2 bersamaan dengan pergantian canonical v1 → v2: snapshot utuh dari salah satu keadaan', async () => {
      const [fin, run] = await Promise.all([
        http().post(`/api/v1/reviews/${review['EMP-2']}/finalize`).set(as.hr),
        http().post('/api/v1/reconciliation-runs').set(as.finance).send({ internalDatasetId: baseline.datasets.aInt, externalDatasetId: baseline.datasets.aExt, ruleVersion: 'v2' }),
      ]);
      expect([fin.status, run.status]).toEqual([200, 201]);
      const aV2 = run.body.run.id as string;
      const src = fin.body.provenance.revenueSources[0];
      const revenueItem = fin.body.items.find((i: { source: string }) => i.source === 'VERIFIED_UNIT_REVENUE');
      // Sebelum switch: 16 jt (v1 + REF-021) — sesudah: 18 jt (v2 + REF-021). Tidak pernah campuran.
      if (src.canonicalRunIds.includes(aV2)) {
        expect([src.verifiedRevenue, revenueItem.actual]).toEqual(['18000000', '18000000']);
        expect(src.canonicalRunIds).not.toContain(baseline.runs.aV1);
      } else {
        expect([src.verifiedRevenue, revenueItem.actual]).toEqual(['16000000', '16000000']);
        expect(src.canonicalRunIds).toContain(baseline.runs.aV1);
      }
      expect(revenueItem.weightedScore).toBe(new Decimal(revenueItem.actual).div(20000000).times(60).toString());
    });

    it('8. analytics setelah v2: BR-A 18 jt (bukan 15 + 17), DIV-1 = 24 jt / 3,5', async () => {
      const u = byCode((await rpe('hr').expect(200)).body.units);
      expect(u['BR-A'].own.verifiedRevenue).toBe('18000000');
      expect(u['BR-A'].own.rpe).toBe('9000000');
      expect(u['DIV-1'].subtotal!.verifiedRevenue).toBe('24000000');
      expect(u['DIV-1'].subtotal!.rpe!.startsWith('6857142.857142857142')).toBe(true);
    });

    it('9. snapshot EMP-1 tetap 85 setelah revenue BR-A naik ke 18 jt & canonical v2 (preview ulang mengembalikan snapshot)', async () => {
      const detail = await http().get(`/api/v1/reviews/${review['EMP-1']}`).set(as.hr).expect(200);
      expect(detail.body).toMatchObject({ status: 'FINALIZED', totalScore: '85' }); // fixture SNAPSHOT: tetap 85
      expect(detail.body.items[0].actual).toBe('15000000');
      expect(detail.body.provenance.revenueSources[0].canonicalRunIds).toEqual([baseline.runs.aV1]);
      expect((await calc('EMP-1').expect(200)).body.totalScore).toBe('85');
    });

    it('11. enam finalisasi serentak (dua instance API) untuk EMP-4 → tepat satu 200, sisanya 409; satu review, satu set item', async () => {
      const second = await createTestApp();
      try {
        const send = (a: INestApplication) => request(a.getHttpServer()).post(`/api/v1/reviews/${review['EMP-4']}/finalize`).set(as.hr);
        const res = await Promise.all([send(app), send(second), send(app), send(second), send(app), send(second)]);
        expect(res.map((r) => r.status).sort()).toEqual([200, 409, 409, 409, 409, 409]);
        expect(res.filter((r) => r.status === 409).every((r) => r.body.code === 'REVIEW_ALREADY_FINALIZED')).toBe(true);
        expect(await owner.performanceReview.count({ where: { employeeId: id['EMP-4'], periodId: id['PERIOD-SEP'] } })).toBe(1);
        expect(await owner.reviewItem.count({ where: { reviewId: review['EMP-4'] } })).toBe(1);
        expect(await owner.auditEvent.count({ where: { entityId: review['EMP-4'], eventType: 'REVIEW_FINALIZED' } })).toBe(1);
      } finally {
        await second.close();
      }
    });

    it('11. finalisasi bersamaan dengan perubahan KPI: snapshot selalu sama dengan nilai KPI yang berlaku', async () => {
      const k = await owner.kpiAssignment.findFirstOrThrow({ where: { employeeId: id['EMP-3'] } });
      await http().patch(`/api/v1/kpi-assignments/${k.id}`).set(as.hr).send({ actual: '8' }).expect(200);
      const [fin, patch] = await Promise.all([
        http().post(`/api/v1/reviews/${review['EMP-3']}/finalize`).set(as.hr),
        http().patch(`/api/v1/kpi-assignments/${k.id}`).set(as.hr).send({ actual: '9' }),
      ]);
      expect(fin.status).toBe(200);
      expect([200, 409]).toContain(patch.status);
      const stored = await owner.kpiAssignment.findUniqueOrThrow({ where: { id: k.id } });
      const item = await owner.reviewItem.findFirstOrThrow({ where: { reviewId: review['EMP-3'] } });
      expect(item.actual.toString()).toBe(stored.actual!.toString());
      expect(stored.actual!.toString()).toBe(patch.status === 200 ? '9' : '8');
    });
  });

  describe('10b. akses review karyawan pindahan', () => {
    it('HR melihat semua; EMP-3 berunit BR-B (penempatan terakhir di periode)', async () => {
      const res = await http().get(`/api/v1/reviews?periodId=${id['PERIOD-SEP']}`).set(as.hr).expect(200);
      expect(res.body.items.map((i: { employee: { code: string }; unit: { code: string }; status: string }) => [i.employee.code, i.unit.code, i.status])).toEqual([
        ['EMP-1', 'BR-A', 'FINALIZED'],
        ['EMP-2', 'BR-A', 'FINALIZED'],
        ['EMP-3', 'BR-B', 'FINALIZED'],
        ['EMP-4', 'BR-B', 'FINALIZED'],
      ]);
    });

    it('MANAGER-A tidak melihat review EMP-3 walau EMP-3 pernah di BR-A; MANAGER-B bisa', async () => {
      const list = await http().get(`/api/v1/reviews?periodId=${id['PERIOD-SEP']}`).set(as.managerA).expect(200);
      expect(list.body.items.map((i: { employee: { code: string } }) => i.employee.code)).toEqual(['EMP-1', 'EMP-2']);
      await http().get(`/api/v1/reviews/${review['EMP-3']}`).set(as.managerA).expect(404);
      await http().get(`/api/v1/reviews/${review['EMP-3']}`).set(as.managerB).expect(200);
      await http().get(`/api/v1/reviews/${review['EMP-1']}`).set(as.managerA).expect(200);
      await http().get(`/api/v1/reviews?periodId=${id['PERIOD-SEP']}&unitId=${id['BR-B']}`).set(as.managerA).expect(404);
      // Master karyawan (D-21) tetap menampilkan EMP-3 untuk MANAGER-A — itu bukan izin membaca review-nya.
      const employees = await http().get('/api/v1/employees').set(as.managerA).expect(200);
      expect(employees.body.items.map((e: { code: string }) => e.code)).toContain('EMP-3');
    });

    it('MANAGER tidak bisa mengelola review; HR tidak bisa mengelola karyawan di luar scope', async () => {
      await calc('EMP-1', 'managerA').expect(403);
      await http().post(`/api/v1/reviews/${review['EMP-1']}/finalize`).set(as.managerA).expect(403);
      const hrEmp = await http().post('/api/v1/reviews/calculate').set(as.hr).send({ employeeId: id['EMP-1'], periodId: (await owner.reviewPeriod.findFirstOrThrow({ where: { externalKey: 'P2-SEP' } })).id });
      expect(hrEmp.status).toBe(404);
    });

    it('distribusi skor: MANAGER-A hanya BR-A; HR seluruh DIV-1', async () => {
      const mgr = await http().get(`/api/v1/analytics/performance?periodId=${id['PERIOD-SEP']}`).set(as.managerA).expect(200);
      expect(mgr.body.withinScope.count).toBe(2);
      expect(mgr.body.units.map((u: { unit: { code: string } }) => u.unit.code)).toEqual(['BR-A']);
      const hr = await http().get(`/api/v1/analytics/performance?periodId=${id['PERIOD-SEP']}`).set(as.hr).expect(200);
      expect(hr.body.withinScope.count).toBe(4);
      expect(hr.body.withinScope.bands.FROM_100).toBe(1);
      expect(hr.body.withinScope.bands.BELOW_60).toBe(0);
    });
  });
});
