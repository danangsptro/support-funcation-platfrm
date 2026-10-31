import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../helpers/app';

describe('health, request ID, format error', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());

  it('live selalu 200', async () => {
    await request(app.getHttpServer()).get('/api/v1/health/live').expect(200, { status: 'ok' });
  });

  it('ready 200 saat database tersedia dan membawa x-request-id', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
    expect(res.body).toEqual({ status: 'ok', checks: { database: 'up' } });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('x-request-id dari klien diteruskan bila aman, diganti bila tidak', async () => {
    const ok = await request(app.getHttpServer()).get('/api/v1/health/live').set('x-request-id', 'demo-123');
    expect(ok.headers['x-request-id']).toBe('demo-123');
    const bad = await request(app.getHttpServer()).get('/api/v1/health/live').set('x-request-id', 'a b<script>');
    expect(bad.headers['x-request-id']).not.toBe('a b<script>');
  });

  it('rute tak dikenal → 404 dengan format error standar', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/tidak-ada').set('x-request-id', 'req-404').expect(404);
    expect(res.body).toEqual({ code: 'NOT_FOUND', message: expect.any(String), requestId: 'req-404' });
  });

  it('ready 503 NOT_READY ketika database tidak tersedia', async () => {
    const downApp = await createTestApp('postgresql://app_runtime:x@127.0.0.1:1/support_test');
    try {
      const res = await request(downApp.getHttpServer()).get('/api/v1/health/ready').expect(503);
      expect(res.body).toMatchObject({ code: 'NOT_READY', details: { checks: { database: 'down' } } });
      expect(res.body.requestId).toBeDefined();
      await request(downApp.getHttpServer()).get('/api/v1/health/live').expect(200);
    } finally {
      await downApp.close();
    }
  });
});
