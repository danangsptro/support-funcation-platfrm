import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

// DEMO_PASSWORD dibaca dari .env root (tidak pernah ditulis di kode test).
const envFile = resolve(dirname(fileURLToPath(import.meta.url)), '../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

/**
 * E2E di browser sungguhan terhadap stack Docker TERISOLASI (scripts/e2e-isolated.sh, port 8096, volume
 * sendiri yang dihapus setelah selesai) — database demo tidak pernah disentuh.
 * Memakai Google Chrome terpasang (channel "chrome"), bukan unduhan browser Playwright.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  globalSetup: './e2e/global-setup.ts',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8096',
    channel: 'chrome',
    headless: true,
    locale: 'id-ID',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
