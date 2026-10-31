import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { RevenueService } from '../../src/modules/reconciliation/revenue.service';
import { readFixture, readFixtureJson, type ExpectedRecon } from '../fixtures/fixtures';
import { createTestApp, loginAs, USERS } from '../helpers/app';
import { ownerClient, resetDatabase, seedFixtures } from '../helpers/db';

type Headers = Record<string, string>;
const SEP = { from: '2026-09-01', to: '2026-10-01' };

describe('Phase 03 — rekonsiliasi & idempotensi (PostgreSQL nyata)', () => {
  let app: INestApplication;
  let owner: PrismaClient;
  const id: Record<string, string> = {};
  const as: Record<string, Headers> = {};
  const ds: Record<string, string> = {};
  const runs: Record<string, string> = {};
  const http = () => request(app.getHttpServer());

  const upload = (who: string, unit: string, side: 'INTERNAL' | 'EXTERNAL', content: Buffer | string, name = 'data.csv', account = 'ACC-1') =>
    http()
      .post('/api/v1/datasets/import')
      .set(as[who])
      .field('unitId', id[unit])
      .field('accountId', account)
      .field('side', side)
      .attach('file', Buffer.isBuffer(content) ? content : Buffer.from(content), name);

  const counts = async () => ({
    tx: await owner.financialTransaction.count(),
    datasets: await owner.transactionDataset.count(),
    members: await owner.datasetTransaction.count(),
    runs: await owner.reconciliationRun.count(),
    results: await owner.reconciliationResult.count(),
    canonical: await owner.canonicalReconciliation.count(),
  });

  const verified = async (unit: string) =>
    (await app.get(RevenueService).verifiedByUnit([id[unit]], SEP.from, SEP.to)).find((r) => r.unitId === id[unit])?.amount ?? '0';

  beforeAll(async () => {
    owner = ownerClient();
    await resetDatabase(owner);
    await seedFixtures(owner);
    for (const u of await owner.orgUnit.findMany()) id[u.externalKey] = u.id;
    app = await createTestApp();
    for (const [k, email] of Object.entries(USERS)) as[k] = await loginAs(app, email);
  });
  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  describe('import dataset', () => {
    it('FINANCE mengimpor file per scope BR-A → 201, 7 & 6 baris', async () => {
      const i = await upload('finance', 'BR-A', 'INTERNAL', readFixture('reconciliation/scoped/ORG-1-BR-A-internal.csv'), 'ORG-1-BR-A-internal.csv').expect(201);
      const e = await upload('finance', 'BR-A', 'EXTERNAL', readFixture('reconciliation/scoped/ORG-1-BR-A-external.csv')).expect(201);
      expect(i.body).toMatchObject({ created: true, dataset: { side: 'INTERNAL', rowCount: 7, accountId: 'ACC-1', unit: { code: 'BR-A' } } });
      expect(e.body.dataset.rowCount).toBe(6);
      ds.aInt = i.body.dataset.id;
      ds.aExt = e.body.dataset.id;
      expect(await counts()).toMatchObject({ tx: 13, datasets: 2, members: 13 });
    });

    it('IMPORT-TWICE: file sama → 200, dataset sama, jumlah transaksi tidak berubah', async () => {
      const before = await counts();
      const res = await upload('finance', 'BR-A', 'INTERNAL', readFixture('reconciliation/scoped/ORG-1-BR-A-internal.csv')).expect(200);
      expect(res.body).toMatchObject({ created: false, dataset: { id: ds.aInt } });
      expect(await counts()).toEqual(before);
    });

    it('REORDER: urutan baris dibalik (+ CRLF→LF) → identitas dataset sama', async () => {
      const [header, ...rows] = readFixture('reconciliation/scoped/ORG-1-BR-A-internal.csv').toString('utf8').trim().split(/\r?\n/);
      const res = await upload('finance', 'BR-A', 'INTERNAL', [header, ...rows.reverse()].join('\n')).expect(200);
      expect(res.body.dataset.id).toBe(ds.aInt);
    });

    it.each(readFixtureJson<{ cases: { file: string; reason: string }[] }>('invalid/expected.json').cases.map((c) => [c.file, c.reason]))(
      '%s → 400 dengan reason %s, nol baris tersimpan',
      async (file, reason) => {
        const before = await counts();
        const res = await upload('finance', 'BR-A', 'INTERNAL', readFixture(`invalid/${file}`), file).expect(400);
        expect(res.body.code).toBe('IMPORT_REJECTED');
        expect(res.body.details.errors.map((e: { code: string }) => e.code)).toEqual([reason]);
        expect(await counts()).toEqual(before);
      },
    );

    it('file gabungan multi-scope ditolak seluruhnya (ROW_SCOPE_MISMATCH)', async () => {
      const before = await counts();
      const res = await upload('finance', 'BR-A', 'INTERNAL', readFixture('reconciliation/internal-transactions.csv')).expect(400);
      expect(new Set(res.body.details.errors.map((e: { code: string }) => e.code))).toEqual(new Set(['ROW_SCOPE_MISMATCH']));
      expect(await counts()).toEqual(before);
    });

    it('ID sama dengan isi berbeda → 409 TRANSACTION_CONFLICT, tidak ada yang tersimpan', async () => {
      const before = await counts();
      const csv = readFixture('reconciliation/scoped/ORG-1-BR-A-internal.csv').toString('utf8').replace('I1,ORG-1,BR-A,ACC-1,REF-001,2026-09-10,10000000', 'I1,ORG-1,BR-A,ACC-1,REF-001,2026-09-10,10000001');
      const res = await upload('finance', 'BR-A', 'INTERNAL', csv).expect(409);
      expect(res.body).toMatchObject({ code: 'TRANSACTION_CONFLICT', details: { transactionIds: ['I1'] } });
      expect(await counts()).toEqual(before);
    });

    it('header salah, file bukan .csv, tanpa file, >5000 baris, >1 MiB', async () => {
      await upload('finance', 'BR-A', 'INTERNAL', 'a,b\n1,2').expect(400).expect((r) => expect(r.body.code).toBe('INVALID_HEADER'));
      await upload('finance', 'BR-A', 'INTERNAL', 'x', 'data.xlsx').expect(400).expect((r) => expect(r.body.code).toBe('UNSUPPORTED_FILE_TYPE'));
      await http().post('/api/v1/datasets/import').set(as.finance).field('unitId', id['BR-A']).field('accountId', 'ACC-1').field('side', 'INTERNAL').expect(400);
      const header = 'transaction_id,organization_id,unit_id,account_id,reference,transaction_date,amount,currency,transaction_type';
      const many = [header, ...Array.from({ length: 5001 }, (_, i) => `T${i},ORG-1,BR-A,ACC-1,R${i},2026-09-10,1,IDR,REVENUE`)].join('\n');
      await upload('finance', 'BR-A', 'INTERNAL', many).expect(400).expect((r) => expect(r.body.code).toBe('TOO_MANY_ROWS'));
      await upload('finance', 'BR-A', 'INTERNAL', Buffer.alloc(1024 * 1024 + 10, 'a')).expect(413);
    });

    it('T-SEC-05 MANAGER-A import → 403; FINANCE ke BR-X (ORG-2) → 404; ADMIN ORG-2 → 403', async () => {
      const file = readFixture('reconciliation/scoped/ORG-1-BR-A-internal.csv');
      await upload('managerA', 'BR-A', 'INTERNAL', file).expect(403);
      await upload('finance', 'BR-X', 'INTERNAL', readFixture('reconciliation/scoped/ORG-2-BR-X-internal.csv'), 'x.csv', 'ACC-2').expect(404);
      await upload('outsider', 'BR-X', 'INTERNAL', readFixture('reconciliation/scoped/ORG-2-BR-X-internal.csv'), 'x.csv', 'ACC-2').expect(403);
    });

    it('BR-B diimpor untuk test berikutnya', async () => {
      ds.bInt = (await upload('finance', 'BR-B', 'INTERNAL', readFixture('reconciliation/scoped/ORG-1-BR-B-internal.csv')).expect(201)).body.dataset.id;
      ds.bExt = (await upload('finance', 'BR-B', 'EXTERNAL', readFixture('reconciliation/scoped/ORG-1-BR-B-external.csv')).expect(201)).body.dataset.id;
    });
  });

  describe('run rekonsiliasi', () => {
    const expected = readFixtureJson<ExpectedRecon>('reconciliation/expected-results.json');
    const run = (who: string, internalDatasetId: string, externalDatasetId: string, ruleVersion = 'v1') =>
      http().post('/api/v1/reconciliation-runs').set(as[who]).send({ internalDatasetId, externalDatasetId, ruleVersion });

    it('BR-A v1 → 201; hasil identik dengan expected-results.json', async () => {
      const res = await run('finance', ds.aInt, ds.aExt).expect(201);
      expect(res.body).toMatchObject({ created: true, run: { ruleVersion: 'v1', dateToleranceDays: 1, groups: 7, isCanonical: true } });
      runs.aV1 = res.body.run.id;
      const results = await http().get(`/api/v1/reconciliation-runs/${runs.aV1}/results?pageSize=100`).set(as.finance).expect(200);
      const actual = results.body.items.map((r: { reference: string; statusLabel: string; reason: string | null; internal: { transactionId: string }[]; external: { transactionId: string }[] }) => ({
        reference: r.reference,
        status: r.statusLabel,
        reason: r.reason,
        internal_ids: r.internal.map((t) => t.transactionId),
        external_ids: r.external.map((t) => t.transactionId),
      }));
      expect(actual).toEqual(expected.results);
    });

    it('ringkasan BR-A: 2/3/1/1, rasio 28.57, anomali 7.900.000 & 6.400.000 (terpisah), selisih 100.000, verified 15.000.000', async () => {
      const s = (await http().get(`/api/v1/reconciliation-runs/${runs.aV1}/summary`).set(as.finance).expect(200)).body;
      expect(s).toMatchObject({
        groups: 7,
        counts: { MATCHED: 2, MISMATCHED: 3, MISSING_IN_INTERNAL: 1, MISSING_IN_EXTERNAL: 1 },
        byReason: { AMOUNT_DIFFERENCE: 1, DATE_OUTSIDE_TOLERANCE: 1, DUPLICATE_REFERENCE: 1, NO_INTERNAL: 1, NO_EXTERNAL: 1 },
        matchedRatioPercentDisplay: '28.57',
        verifiedRevenue: '15000000',
        anomalousInternalTotal: '7900000',
        anomalousExternalTotal: '6400000',
        uniquePairAmountDifferenceTotal: '100000',
      });
      expect(await verified('BR-A')).toBe('15000000');
    });

    it('duplikat REF-007: satu grup, seluruh ID, tanpa pasangan acak', async () => {
      const res = await http().get(`/api/v1/reconciliation-runs/${runs.aV1}/results?reason=DUPLICATE_REFERENCE`).set(as.finance).expect(200);
      expect(res.body.total).toBe(1);
      expect(res.body.items[0]).toMatchObject({
        reference: 'REF-007',
        status: 'MISMATCHED',
        amountDifference: null,
        internal: [{ transactionId: 'I6' }, { transactionId: 'I7' }],
        external: [{ transactionId: 'E6' }],
      });
    });

    it('filter & pagination hasil', async () => {
      const mm = await http().get(`/api/v1/reconciliation-runs/${runs.aV1}/results?status=MISMATCHED`).set(as.finance).expect(200);
      expect(mm.body.total).toBe(3);
      const p2 = await http().get(`/api/v1/reconciliation-runs/${runs.aV1}/results?page=2&pageSize=5`).set(as.finance).expect(200);
      expect([p2.body.total, p2.body.items.length]).toEqual([7, 2]);
      await http().get(`/api/v1/reconciliation-runs/${runs.aV1}/results?status=OK`).set(as.finance).expect(400);
    });

    it('RUN-TWICE: run identik → 200, run sama, tetap 7 grup', async () => {
      const before = await counts();
      const res = await run('finance', ds.aInt, ds.aExt).expect(200);
      expect(res.body).toMatchObject({ created: false, run: { id: runs.aV1 } });
      expect(await counts()).toEqual(before);
    });

    it('validasi pasangan dataset', async () => {
      await run('finance', ds.aExt, ds.aInt).expect(400).expect((r) => expect(r.body.code).toBe('DATASET_SIDE_MISMATCH'));
      await run('finance', ds.aInt, ds.bExt).expect(400).expect((r) => expect(r.body.code).toBe('DATASET_SCOPE_MISMATCH'));
      await run('finance', ds.aInt, ds.aExt, 'v9').expect(400);
      await run('finance', ds.aInt, '00000000-0000-4000-8000-000000000000').expect(404);
      await run('managerA', ds.aInt, ds.aExt).expect(403);
    });

    it('PARALLEL: 6 request serentak dari dua instance API (dua pool koneksi) → satu run, tanpa hasil ganda', async () => {
      const second = await createTestApp();
      try {
        const body = { internalDatasetId: ds.bInt, externalDatasetId: ds.bExt, ruleVersion: 'v1' };
        const send = (a: INestApplication) => request(a.getHttpServer()).post('/api/v1/reconciliation-runs').set(as.finance).send(body);
        const responses = await Promise.all([send(app), send(second), send(app), send(second), send(app), send(second)]);
        expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 200, 201]);
        expect(new Set(responses.map((r) => r.body.run.id)).size).toBe(1);
        runs.bV1 = responses[0].body.run.id;
        expect(await owner.reconciliationRun.count({ where: { internalDatasetId: ds.bInt, externalDatasetId: ds.bExt } })).toBe(1);
        expect(await owner.reconciliationResult.count({ where: { runId: runs.bV1 } })).toBe(1);
        expect(await verified('BR-B')).toBe('6000000');
      } finally {
        await second.close();
      }
    });

    it('ROLLBACK: kegagalan sebelum commit → tidak ada run/hasil/canonical parsial; retry sukses', async () => {
      let fail = true;
      const faulty = await createTestApp(undefined, {
        reconciliationHooks: {
          beforeCommit: () => {
            if (fail) throw new Error('injeksi kegagalan');
          },
        },
      });
      try {
        const before = await counts();
        const send = () =>
          request(faulty.getHttpServer())
            .post('/api/v1/reconciliation-runs')
            .set(as.finance)
            .send({ internalDatasetId: ds.bInt, externalDatasetId: ds.bExt, ruleVersion: 'v2' });
        const res = await send().expect(500);
        expect(res.body).toMatchObject({ code: 'INTERNAL_ERROR' });
        expect(JSON.stringify(res.body)).not.toContain('injeksi');
        expect(await counts()).toEqual(before);
        fail = false;
        const retry = await send().expect(201);
        expect(retry.body.run.ruleVersion).toBe('v2');
      } finally {
        await faulty.close();
      }
    });

    it('RULE-V2: run baru, REF-004 Matched, verified BR-A 17.000.000 (bukan 32.000.000); run v1 tidak lagi canonical', async () => {
      const res = await run('finance', ds.aInt, ds.aExt, 'v2').expect(201);
      runs.aV2 = res.body.run.id;
      const s = (await http().get(`/api/v1/reconciliation-runs/${runs.aV2}/summary`).set(as.finance).expect(200)).body;
      expect(s).toMatchObject({ verifiedRevenue: '17000000', counts: { MATCHED: 3 }, isCanonical: true });
      expect(await verified('BR-A')).toBe('17000000');
      const v1 = (await http().get(`/api/v1/reconciliation-runs/${runs.aV1}/summary`).set(as.finance).expect(200)).body;
      expect(v1).toMatchObject({ verifiedRevenue: '15000000', isCanonical: false });
      expect(await owner.canonicalReconciliation.count({ where: { transaction: { unitId: id['BR-A'] } } })).toBe(7);
    });

    it('overlap: transaksi berulang lintas dataset tidak menggandakan data/revenue; run overlap → 409', async () => {
      const before = await counts();
      const csv = [
        'transaction_id,organization_id,unit_id,account_id,reference,transaction_date,amount,currency,transaction_type',
        'I1,ORG-1,BR-A,ACC-1,REF-001,2026-09-10,10000000,IDR,REVENUE',
        'I10,ORG-1,BR-A,ACC-1,REF-010,2026-09-15,4000000,IDR,REVENUE',
      ].join('\n');
      const imp = await upload('finance', 'BR-A', 'INTERNAL', csv, 'overlap.csv').expect(201);
      const after = await counts();
      expect(after.tx).toBe(before.tx + 1); // I1 dipakai ulang, hanya I10 yang baru
      expect(after.members).toBe(before.members + 2);
      const recorded = (await app.get(RevenueService).recordedByUnit([id['BR-A']], SEP.from, SEP.to))[0].amount;
      expect(recorded).toBe('26900000'); // 22.900.000 + I10, I1 tidak terhitung dua kali

      const res = await run('finance', imp.body.dataset.id, ds.aExt).expect(409);
      expect(res.body).toMatchObject({ code: 'CANONICAL_OVERLAP', details: { conflictingRunIds: [runs.aV2] } });
      expect(await owner.reconciliationRun.count()).toBe(after.runs);
      expect(await verified('BR-A')).toBe('17000000');
    });
  });

  describe('scope pada run, hasil, dan ringkasan', () => {
    it('MANAGER-A: daftar run hanya BR-A; ringkasan BR-B 404; detail hasil 403 (tanpa reconciliation.read)', async () => {
      const list = await http().get('/api/v1/reconciliation-runs').set(as.managerA).expect(200);
      expect(new Set(list.body.items.map((r: { unit: { code: string } }) => r.unit.code))).toEqual(new Set(['BR-A']));
      await http().get(`/api/v1/reconciliation-runs/${runs.aV1}/summary`).set(as.managerA).expect(200);
      await http().get(`/api/v1/reconciliation-runs/${runs.bV1}/summary`).set(as.managerA).expect(404);
      await http().get(`/api/v1/reconciliation-runs/${runs.aV1}/results`).set(as.managerA).expect(403);
    });

    it('T-SEC-04 (sebagian): revenue ber-scope MANAGER-A hanya BR-A; 6.000.000 dan 9.000.000 tidak ikut', async () => {
      const list = await http().get('/api/v1/reconciliation-runs?pageSize=100').set(as.managerA).expect(200);
      const raw = JSON.stringify(list.body);
      expect(raw).not.toContain(runs.bV1);
      expect(raw).not.toContain('6000000');
      expect(raw).not.toContain('9000000');
    });

    it('ADMIN ORG-1 membaca hasil; OUTSIDER (ORG-2) tidak melihat apa pun', async () => {
      await http().get(`/api/v1/reconciliation-runs/${runs.aV1}/results`).set(as.admin).expect(200);
      const out = await http().get('/api/v1/reconciliation-runs').set(as.outsider).expect(200);
      expect(out.body.total).toBe(0);
      await http().get(`/api/v1/reconciliation-runs/${runs.aV1}/summary`).set(as.outsider).expect(404);
      const dsl = await http().get('/api/v1/datasets').set(as.outsider).expect(200);
      expect(dsl.body.total).toBe(0);
    });

    it('audit import & run tercatat', async () => {
      expect(await owner.auditEvent.count({ where: { eventType: 'DATASET_IMPORTED' } })).toBeGreaterThanOrEqual(5);
      expect(await owner.auditEvent.count({ where: { eventType: 'RECONCILIATION_RUN_COMPLETED' } })).toBe(await owner.reconciliationRun.count());
    });
  });
});
