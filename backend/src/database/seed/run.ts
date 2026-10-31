import { PrismaClient } from '@prisma/client';
import { loadFixtures } from './fixtures';
import { runSeed, seedCounts } from './seed';

/** CLI seed. Memakai MIGRATION_DATABASE_URL (owner) bila ada, selain itu DATABASE_URL. */
async function main(): Promise<void> {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('MIGRATION_DATABASE_URL atau DATABASE_URL wajib diisi');
  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    await runSeed(prisma, { fixtures: loadFixtures(), demoPassword: process.env.DEMO_PASSWORD ?? '' });
    console.log('Seed selesai:', JSON.stringify(await seedCounts(prisma)));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error('Seed gagal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
