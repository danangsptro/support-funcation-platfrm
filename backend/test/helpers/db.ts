import { PrismaClient } from '@prisma/client';
import { assertConnectedTestDatabase } from '../../src/database/test-db-guard';
import { loadFixtures } from '../../src/database/seed/fixtures';
import { runSeed } from '../../src/database/seed/seed';
import { loadTestEnv } from '../setup/test-env';

export const testEnv = loadTestEnv();

export const ownerClient = () => new PrismaClient({ datasourceUrl: testEnv.ownerUrl });
export const runtimeClient = () => new PrismaClient({ datasourceUrl: testEnv.runtimeUrl });

/** Kosongkan semua tabel aplikasi. Hanya untuk database *_test (dicek di URL dan di server). */
export async function resetDatabase(owner: PrismaClient): Promise<void> {
  const [{ current_database }] = await owner.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  assertConnectedTestDatabase(current_database);
  const tables = await owner.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename.replace(/"/g, '""')}"`).join(', ');
  await owner.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

export async function seedFixtures(owner: PrismaClient, demoPassword = testEnv.demoPassword): Promise<void> {
  await runSeed(owner, { fixtures: loadFixtures(), demoPassword });
}
