import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { request, type FullConfig } from '@playwright/test';

/**
 * Baseline E2E: rekonsiliasi BR-A v1 & BR-B v1 dari fixture, diimpor lewat API sebagai Finance.
 * Hanya jalan di stack terisolasi (scripts/e2e-isolated.sh) — menolak menyentuh database demo.
 */
export default async function globalSetup(config: FullConfig) {
  if (process.env.E2E_ISOLATED !== '1') {
    throw new Error('E2E memfinalisasi review & mengimpor data. Jalankan lewat `pnpm test:e2e` (stack terisolasi), bukan terhadap stack demo.');
  }
  // Tahap persistence sesudah restart: data baseline sudah ada, jangan impor ulang.
  if (process.env.E2E_SKIP_SETUP === '1') return;
  const baseURL = config.projects[0].use.baseURL!;
  const ctx = await request.newContext({ baseURL, extraHTTPHeaders: { 'X-Requested-With': 'sfp-web' } });
  const login = await ctx.post('/api/v1/auth/login', { data: { email: 'finance@example.test', password: process.env.DEMO_PASSWORD } });
  if (!login.ok()) throw new Error(`login Finance gagal: ${login.status()}`);
  const units = (await (await ctx.get('/api/v1/org-units?pageSize=100')).json()).items as { id: string; code: string }[];
  const unitId = (code: string) => units.find((u) => u.code === code)!.id;
  const fixture = (f: string) => readFileSync(resolve(process.cwd(), '../samples/test-data/reconciliation/scoped', f));

  const importFile = async (unit: string, side: 'INTERNAL' | 'EXTERNAL', file: string) => {
    const res = await ctx.post('/api/v1/datasets/import', {
      multipart: { unitId: unitId(unit), accountId: 'ACC-1', side, file: { name: file, mimeType: 'text/csv', buffer: fixture(file) } },
    });
    if (!res.ok()) throw new Error(`import ${file} gagal: ${res.status()} ${await res.text()}`);
    return (await res.json()).dataset.id as string;
  };
  for (const unit of ['BR-A', 'BR-B']) {
    const internalDatasetId = await importFile(unit, 'INTERNAL', `ORG-1-${unit}-internal.csv`);
    const externalDatasetId = await importFile(unit, 'EXTERNAL', `ORG-1-${unit}-external.csv`);
    const run = await ctx.post('/api/v1/reconciliation-runs', { data: { internalDatasetId, externalDatasetId, ruleVersion: 'v1' } });
    if (!run.ok()) throw new Error(`run ${unit} gagal: ${run.status()}`);
  }
  await ctx.dispose();
}
