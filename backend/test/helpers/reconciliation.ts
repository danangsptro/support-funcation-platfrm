import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { readFixture } from '../fixtures/fixtures';

type Headers = Record<string, string>;

/** Import satu file CSV fixture lewat API (idempoten) dan kembalikan ID dataset. */
export async function importCsv(app: INestApplication, headers: Headers, unitId: string, side: 'INTERNAL' | 'EXTERNAL', content: Buffer | string, accountId = 'ACC-1') {
  const res = await request(app.getHttpServer())
    .post('/api/v1/datasets/import')
    .set(headers)
    .field('unitId', unitId)
    .field('accountId', accountId)
    .field('side', side)
    .attach('file', Buffer.isBuffer(content) ? content : Buffer.from(content), 'data.csv');
  if (res.status !== 201 && res.status !== 200) throw new Error(`import gagal ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.dataset.id as string;
}

export async function runRecon(app: INestApplication, headers: Headers, internalDatasetId: string, externalDatasetId: string, ruleVersion = 'v1') {
  const res = await request(app.getHttpServer()).post('/api/v1/reconciliation-runs').set(headers).send({ internalDatasetId, externalDatasetId, ruleVersion });
  if (res.status !== 201 && res.status !== 200) throw new Error(`run gagal ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.run.id as string;
}

/**
 * Baseline HR yang dipakai test Phase 04, dibangun dari fixture di database test (bukan sisa E2E):
 * BR-A v1 (verified 15 jt) dan BR-B v1 (verified 6 jt).
 */
export async function reconciliationBaseline(app: INestApplication, finance: Headers, unit: Record<string, string>) {
  const scoped = (f: string) => readFixture(`reconciliation/scoped/${f}`);
  const aInt = await importCsv(app, finance, unit['BR-A'], 'INTERNAL', scoped('ORG-1-BR-A-internal.csv'));
  const aExt = await importCsv(app, finance, unit['BR-A'], 'EXTERNAL', scoped('ORG-1-BR-A-external.csv'));
  const bInt = await importCsv(app, finance, unit['BR-B'], 'INTERNAL', scoped('ORG-1-BR-B-internal.csv'));
  const bExt = await importCsv(app, finance, unit['BR-B'], 'EXTERNAL', scoped('ORG-1-BR-B-external.csv'));
  return {
    datasets: { aInt, aExt, bInt, bExt },
    runs: { aV1: await runRecon(app, finance, aInt, aExt), bV1: await runRecon(app, finance, bInt, bExt) },
  };
}
