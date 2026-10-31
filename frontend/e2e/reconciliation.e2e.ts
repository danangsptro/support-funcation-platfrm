import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.DEMO_PASSWORD ?? '';
const SHOTS = 'test-results/screens';
const FIXTURE = (f: string) => resolve(process.cwd(), '../samples/test-data', f);

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Kata sandi').fill(PASSWORD);
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^Selamat (pagi|siang|sore|malam)/ })).toBeVisible();
}

test('Finance: beranda → Mulai rekonsiliasi → 3 langkah → hasil dengan panduan tindak lanjut', async ({ page }) => {
  await login(page, 'finance@example.test');
  await page.screenshot({ path: `${SHOTS}/09-beranda-finance.png`, fullPage: true });
  await page.getByRole('link', { name: /Rekonsiliasi baru/ }).click();
  await expect(page.getByRole('tab', { name: 'Rekonsiliasi baru' })).toHaveAttribute('aria-selected', 'true');

  await page.getByLabel('Cabang / unit').selectOption({ label: 'BR-A' });
  await page.getByLabel('Akun / rekening').fill('ACC-1');
  await page.getByLabel('Unggah file Catatan internal').setInputFiles(FIXTURE('reconciliation/scoped/ORG-1-BR-A-internal.csv'));
  await expect(page.getByText('7 transaksi siap')).toBeVisible();
  await page.getByLabel('Unggah file Mutasi bank / pihak ketiga').setInputFiles(FIXTURE('reconciliation/scoped/ORG-1-BR-A-external.csv'));
  await expect(page.getByText('6 transaksi siap')).toBeVisible();
  await expect(page.getByRole('radio', { name: /Standar/ })).toBeChecked();
  await page.screenshot({ path: `${SHOTS}/10-rekonsiliasi-baru.png`, fullPage: true });

  await page.getByRole('button', { name: 'Cocokkan sekarang' }).click();
  await expect(page.getByRole('tab', { name: /Riwayat & hasil/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('status').filter({ hasText: /Pencocokan selesai|sudah pernah dicocokkan/ })).toBeVisible();

  const detail = page.getByRole('region', { name: 'Detail run' });
  await expect(detail.getByText('28,57%')).toBeVisible();
  await expect(detail.getByText('2 dari 7 grup referensi cocok')).toBeVisible();
  await expect(detail.getByRole('heading', { name: 'Yang perlu ditindaklanjuti' })).toBeVisible();
  for (const v of ['Rp7.900.000,00', 'Rp6.400.000,00']) await expect(detail.getByText(v)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/11-hasil-rekonsiliasi.png`, fullPage: true });

  // Panduan → filter tabel ke referensi ganda
  await detail.getByRole('listitem').filter({ hasText: 'Nomor referensi ganda' }).getByRole('button', { name: /^Tampilkan \d+ transaksi/ }).click();
  await expect(detail.getByRole('group', { name: 'Filter status' })).toBeInViewport();
  await expect(detail.locator('tbody tr')).toHaveCount(1);
  await expect(detail.getByRole('cell', { name: 'REF-007' })).toBeVisible();
});

test('Unggah file salah → daftar baris bermasalah, tidak ada yang disimpan', async ({ page }) => {
  await login(page, 'finance@example.test');
  await page.goto('/reconciliation');
  await page.getByLabel('Cabang / unit').selectOption({ label: 'BR-A' });
  await page.getByLabel('Unggah file Catatan internal').setInputFiles(FIXTURE('invalid/BAD-3.csv'));
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Tidak ada data yang disimpan');
  await expect(alert).toContainText('Baris 2 (BAD-3)');
  await page.screenshot({ path: `${SHOTS}/12-unggah-gagal.png` });
});

test('Manager BR-A: hanya riwayat & ringkasan cabangnya, tanpa tab rekonsiliasi baru', async ({ page }) => {
  await login(page, 'manager-a@example.test');
  await page.getByRole('link', { name: 'Rekonsiliasi', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Rekonsiliasi baru' })).toHaveCount(0);
  const detail = page.getByRole('region', { name: 'Detail run' });
  await expect(detail.getByText(/hanya tersedia untuk tim Finance dan Admin/)).toBeVisible();
  await expect(page.getByText(/BR-B/)).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/13-rekonsiliasi-manager.png`, fullPage: true });
});
