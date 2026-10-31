import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { createApp } from '../../src/app.factory';
import type { AppOptions } from '../../src/app.module';
import { testEnv } from './db';

export const TEST_JWT_EXPIRES_IN = 3600;

export async function createTestApp(
  databaseUrl = testEnv.runtimeUrl,
  overrides: Partial<AppOptions> = {},
): Promise<INestApplication> {
  const app = await createApp(
    {
      databaseUrl,
      jwtSecret: testEnv.jwtSecret,
      jwtExpiresInSeconds: TEST_JWT_EXPIRES_IN,
      cookieSecure: false,
      trustProxy: 'loopback',
      ...overrides,
    },
    // TEST_LOG=1 menampilkan log API (termasuk stack error 5xx) saat debugging test.
    process.env.TEST_LOG === '1',
  );
  await app.init();
  return app;
}

/** Login lewat endpoint nyata dan kembalikan header Authorization. */
export async function loginAs(app: INestApplication, email: string, password = testEnv.demoPassword) {
  const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password }).expect(200);
  return { Authorization: `Bearer ${res.body.accessToken as string}` };
}

/** Token buatan langsung (untuk skenario kedaluwarsa / secret lain). */
export function signToken(payload: object, options: { secret?: string; expiresIn?: number } = {}) {
  const jwt = new JwtService({ secret: options.secret ?? testEnv.jwtSecret });
  return jwt.sign(payload, { algorithm: 'HS256', expiresIn: options.expiresIn ?? 60 });
}

export const USERS = {
  admin: 'admin@example.test',
  hr: 'hr@example.test',
  finance: 'finance@example.test',
  managerA: 'manager-a@example.test',
  managerA2: 'manager-a2@example.test',
  managerB: 'manager-b@example.test',
  employeeA: 'employee-a@example.test',
  outsider: 'outsider@example.test',
  noGrant: 'no-grant@example.test',
} as const;
