import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { loadTestEnv } from './test-env';

/** Menerapkan migration ke database test (credential owner) sebelum suite integrasi. */
export default function globalSetup(): void {
  const { ownerUrl } = loadTestEnv();
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: resolve(__dirname, '../..'),
    env: { ...process.env, DATABASE_URL: ownerUrl },
    stdio: 'inherit',
  });
}
