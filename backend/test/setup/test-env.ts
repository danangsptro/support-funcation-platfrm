import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertTestDatabaseUrl } from '../../src/database/test-db-guard';

export interface TestEnv {
  runtimeUrl: string;
  ownerUrl: string;
  demoPassword: string;
  jwtSecret: string;
}

/** Memuat .env root (bila ada) dan memastikan kedua URL test menunjuk database *_test. */
export function loadTestEnv(): TestEnv {
  const envFile = resolve(__dirname, '../../../.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  process.env.NODE_ENV = 'test';
  const runtimeUrl = process.env.DATABASE_URL_TEST;
  const ownerUrl = process.env.MIGRATION_DATABASE_URL_TEST;
  assertTestDatabaseUrl(runtimeUrl);
  assertTestDatabaseUrl(ownerUrl);
  return {
    runtimeUrl: runtimeUrl as string,
    ownerUrl: ownerUrl as string,
    demoPassword: process.env.DEMO_PASSWORD || 'test-demo-password',
    // Secret khusus test agar token test tidak pernah valid di environment lain.
    jwtSecret: 'integration-test-secret-'.padEnd(48, 'x'),
  };
}
