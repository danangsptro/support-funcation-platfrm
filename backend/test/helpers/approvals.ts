import { INestApplication } from '@nestjs/common';
import request from 'supertest';

type Headers = Record<string, string>;

export interface StepView {
  id: string;
  order: number;
  role: string;
  status: string;
  assignee: { id: string; email: string } | null;
}

export async function createRequest(app: INestApplication, as: Headers, unitId: string, amount: string, title = 'Pengajuan test') {
  const res = await request(app.getHttpServer())
    .post('/api/v1/approval-requests')
    .set(as)
    .send({ unitId, amount, title, reason: 'Kebutuhan operasional cabang' });
  if (res.status !== 201) throw new Error(`create gagal ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.id as string;
}

export async function submitRequest(app: INestApplication, as: Headers, id: string) {
  const res = await request(app.getHttpServer()).post(`/api/v1/approval-requests/${id}/submit`).set(as);
  if (res.status !== 200) throw new Error(`submit gagal ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as { id: string; status: string; steps: StepView[] };
}

/** Pengajuan baru yang sudah disubmit (fixture fresh per skenario, bukan reset database). */
export async function submittedRequest(app: INestApplication, as: Headers, unitId: string, amount: string) {
  return submitRequest(app, as, await createRequest(app, as, unitId, amount));
}

export const act = (app: INestApplication, as: Headers, id: string, stepId: string, action: 'approve' | 'reject' | 'delegate', body: object = {}) =>
  request(app.getHttpServer())
    .post(`/api/v1/approval-requests/${id}/steps/${stepId}/${action}`)
    .set(as)
    .send(action === 'reject' ? { comment: 'Anggaran tidak sesuai', ...body } : body);
