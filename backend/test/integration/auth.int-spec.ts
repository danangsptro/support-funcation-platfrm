import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp, loginAs, signToken, USERS } from '../helpers/app';
import { ownerClient, resetDatabase, seedFixtures, testEnv } from '../helpers/db';

describe('Phase 02 — autentikasi', () => {
  let app: INestApplication;
  let owner: PrismaClient;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    owner = ownerClient();
    await resetDatabase(owner);
    await seedFixtures(owner);
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  describe('POST /auth/login', () => {
    it('credential benar → token Bearer + profil tanpa field sensitif', async () => {
      const res = await http().post('/api/v1/auth/login').send({ email: USERS.managerA, password: testEnv.demoPassword }).expect(200);
      expect(res.body).toMatchObject({ tokenType: 'Bearer', accessToken: expect.any(String), expiresAt: expect.any(String) });
      expect(res.body.user.email).toBe(USERS.managerA);
      expect(res.body.user.grants).toEqual([
        expect.objectContaining({ role: 'MANAGER', includeDescendants: true, unit: expect.objectContaining({ code: 'BR-A' }) }),
      ]);
      const raw = JSON.stringify(res.body);
      expect(raw).not.toMatch(/passwordHash|password_hash|\$2[aby]\$/);
      expect(raw).not.toContain(testEnv.demoPassword);
    });

    it('token berlaku ±1 jam', async () => {
      const res = await http().post('/api/v1/auth/login').send({ email: USERS.hr, password: testEnv.demoPassword }).expect(200);
      const ttl = new Date(res.body.expiresAt).getTime() - Date.now();
      expect(ttl).toBeGreaterThan(3590_000);
      expect(ttl).toBeLessThanOrEqual(3600_000);
    });

    it('email tidak peka huruf besar/spasi', async () => {
      await http().post('/api/v1/auth/login').send({ email: '  Manager-A@Example.TEST ', password: testEnv.demoPassword }).expect(200);
    });

    it.each([
      ['password salah', USERS.managerA, 'salah'],
      ['email tidak terdaftar', 'tidak-ada@example.test', 'apa-saja'],
    ])('%s → 401 INVALID_CREDENTIALS dengan pesan yang sama', async (_l, email, password) => {
      const res = await http().post('/api/v1/auth/login').send({ email, password }).expect(401);
      expect(res.body).toMatchObject({ code: 'INVALID_CREDENTIALS', message: 'Email atau kata sandi salah' });
    });

    it('user nonaktif → 401 INVALID_CREDENTIALS', async () => {
      await owner.user.update({ where: { email: USERS.managerA2 }, data: { active: false } });
      try {
        await http().post('/api/v1/auth/login').send({ email: USERS.managerA2, password: testEnv.demoPassword }).expect(401);
      } finally {
        await owner.user.update({ where: { email: USERS.managerA2 }, data: { active: true } });
      }
    });

    it('input tidak valid → 400 dengan detail field; field tambahan ditolak', async () => {
      const res = await http().post('/api/v1/auth/login').send({ email: 'bukan-email', password: '' }).expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.details.map((d: { field: string }) => d.field).sort()).toEqual(['email', 'password']);
      await http()
        .post('/api/v1/auth/login')
        .send({ email: USERS.admin, password: testEnv.demoPassword, role: 'ADMIN' })
        .expect(400);
    });
  });

  describe('GET /auth/me dan validasi token', () => {
    it('token valid → profil + permission dari grant di database', async () => {
      const headers = await loginAs(app, USERS.finance);
      const res = await http().get('/api/v1/auth/me').set(headers).expect(200);
      expect(res.body.email).toBe(USERS.finance);
      expect(res.body.permissions).toEqual(expect.arrayContaining(['dataset.import', 'reconciliation.run']));
      expect(res.body.permissions).not.toContain('org.manage');
    });

    it('NO-GRANT tetap bisa login dan melihat bahwa ia tidak punya akses', async () => {
      const headers = await loginAs(app, USERS.noGrant);
      const res = await http().get('/api/v1/auth/me').set(headers).expect(200);
      expect(res.body).toMatchObject({ grants: [], permissions: [] });
    });

    it('T-SEC-06 tanpa token / token invalid → 401', async () => {
      await http().get('/api/v1/auth/me').expect(401);
      const res = await http().get('/api/v1/auth/me').set('Authorization', 'Bearer invalid-token').expect(401);
      expect(res.body.code).toBe('UNAUTHENTICATED');
      await http().get('/api/v1/auth/me').set('Authorization', 'Basic abc').expect(401);
    });

    it('T-SEC-07 token kedaluwarsa → 401', async () => {
      const admin = await owner.user.findUniqueOrThrow({ where: { email: USERS.admin } });
      const expired = signToken({ sub: admin.id, typ: 'access' }, { expiresIn: -10 });
      await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${expired}`).expect(401);
    });

    it('token ditandatangani secret lain → 401', async () => {
      const admin = await owner.user.findUniqueOrThrow({ where: { email: USERS.admin } });
      const forged = signToken({ sub: admin.id, typ: 'access' }, { secret: 'secret-penyerang-'.padEnd(40, 'z') });
      await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${forged}`).expect(401);
    });

    it('role/scope di payload token diabaikan; akses berasal dari grant DB', async () => {
      const noGrant = await owner.user.findUniqueOrThrow({ where: { email: USERS.noGrant } });
      const token = signToken({ sub: noGrant.id, typ: 'access', role: 'ADMIN', grants: [{ role: 'ADMIN' }] });
      await http().get('/api/v1/org-units').set('Authorization', `Bearer ${token}`).expect(403);
    });

    it('user dinonaktifkan setelah login → token lamanya 401', async () => {
      const headers = await loginAs(app, USERS.managerB);
      await owner.user.update({ where: { email: USERS.managerB }, data: { active: false } });
      try {
        await http().get('/api/v1/auth/me').set(headers).expect(401);
      } finally {
        await owner.user.update({ where: { email: USERS.managerB }, data: { active: true } });
      }
    });
  });
});
