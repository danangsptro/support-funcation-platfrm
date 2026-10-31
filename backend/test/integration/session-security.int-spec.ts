import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp, loginAs, USERS } from '../helpers/app';
import { ownerClient, resetDatabase, seedFixtures, testEnv } from '../helpers/db';

const CSRF = { 'X-Requested-With': 'sfp-web' };

describe('Perbaikan risiko — cookie httpOnly, CSRF, logout', () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let brZero: string;

  beforeAll(async () => {
    owner = ownerClient();
    await resetDatabase(owner);
    await seedFixtures(owner);
    brZero = (await owner.orgUnit.findFirstOrThrow({ where: { externalKey: 'BR-ZERO' } })).id;
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  async function browserAgent(email: string) {
    const agent = request.agent(app.getHttpServer());
    const res = await agent.post('/api/v1/auth/login').send({ email, password: testEnv.demoPassword }).expect(200);
    return { agent, res };
  }

  it('login memasang cookie sesi httpOnly, SameSite=Strict, Path=/api, dengan Max-Age', async () => {
    const { res } = await browserAgent(USERS.managerA);
    const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('sfp_session='));
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api/);
    expect(cookie).toMatch(/Max-Age=3[56]\d\d/);
    expect(cookie).not.toMatch(/Secure/); // COOKIE_SECURE=false untuk http://localhost
  });

  it('cookie saja cukup untuk GET; /auth/me memuat sessionExpiresAt', async () => {
    const { agent } = await browserAgent(USERS.managerA);
    const me = await agent.get('/api/v1/auth/me').expect(200);
    expect(me.body.email).toBe(USERS.managerA);
    expect(Date.parse(me.body.sessionExpiresAt)).toBeGreaterThan(Date.now());
    const units = await agent.get('/api/v1/org-units').expect(200);
    expect(units.body.items.map((u: { code: string }) => u.code).sort()).toEqual(['BR-A', 'CC-A']);
  });

  it('mutasi via cookie tanpa header CSRF → 403 CSRF_CHECK_FAILED; dengan header → 200', async () => {
    const { agent } = await browserAgent(USERS.admin);
    const denied = await agent.patch(`/api/v1/org-units/${brZero}`).send({ name: 'Cabang Zero' }).expect(403);
    expect(denied.body.code).toBe('CSRF_CHECK_FAILED');
    expect((await owner.orgUnit.findUniqueOrThrow({ where: { id: brZero } })).name).toBe('BR-ZERO');
    await agent.patch(`/api/v1/org-units/${brZero}`).set(CSRF).send({ name: 'Cabang Zero' }).expect(200);
  });

  it('klien API dengan Bearer tidak memerlukan header CSRF', async () => {
    const headers = await loginAs(app, USERS.admin);
    await request(app.getHttpServer()).patch(`/api/v1/org-units/${brZero}`).set(headers).send({ name: 'BR-ZERO' }).expect(200);
  });

  it('logout menghapus cookie; request berikutnya 401', async () => {
    const { agent } = await browserAgent(USERS.hr);
    const out = await agent.post('/api/v1/auth/logout').expect(204);
    const cleared = ([] as string[]).concat(out.headers['set-cookie'] ?? []).find((c) => c.startsWith('sfp_session='));
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
    await agent.get('/api/v1/auth/me').expect(401);
  });
});

describe('Perbaikan risiko — rate limiting login', () => {
  let app: INestApplication;
  let owner: PrismaClient;
  const login = (email: string, password: string, ip = '203.0.113.10') =>
    request(app.getHttpServer()).post('/api/v1/auth/login').set('X-Forwarded-For', ip).send({ email, password });

  beforeAll(async () => {
    owner = ownerClient();
    await resetDatabase(owner);
    await seedFixtures(owner);
    app = await createTestApp(undefined, { loginThrottle: { maxPerIpEmail: 3, maxPerIp: 6, windowMs: 60_000 } });
  });
  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  it('setelah 3 gagal untuk IP+email yang sama → 429 TOO_MANY_ATTEMPTS + Retry-After, walau sandi benar', async () => {
    for (let i = 0; i < 3; i++) await login(USERS.finance, 'salah').expect(401);
    const res = await login(USERS.finance, testEnv.demoPassword).expect(429);
    expect(res.body).toMatchObject({ code: 'TOO_MANY_ATTEMPTS', details: { retryAfterSeconds: expect.any(Number) } });
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('akun yang sama dari IP lain tetap bisa masuk (penyerang tidak bisa mengunci akun korban)', async () => {
    await login(USERS.finance, testEnv.demoPassword, '198.51.100.7').expect(200);
  });

  it('batas per IP berlaku lintas email', async () => {
    const ip = '192.0.2.55';
    const emails = ['a', 'b', 'c', 'd', 'e', 'f'].map((x) => `${x}-tidak-ada@example.test`);
    for (const e of emails) await login(e, 'salah', ip).expect(401);
    await login(USERS.hr, testEnv.demoPassword, ip).expect(429);
  });

  it('login sukses mereset hitungan IP+email', async () => {
    const ip = '192.0.2.77';
    await login(USERS.managerB, 'salah', ip).expect(401);
    await login(USERS.managerB, 'salah', ip).expect(401);
    await login(USERS.managerB, testEnv.demoPassword, ip).expect(200);
    await login(USERS.managerB, 'salah', ip).expect(401);
    await login(USERS.managerB, 'salah', ip).expect(401);
    await login(USERS.managerB, testEnv.demoPassword, ip).expect(200);
  });
});
