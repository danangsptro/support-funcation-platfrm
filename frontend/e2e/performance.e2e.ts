import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.DEMO_PASSWORD ?? '';
const SHOTS = 'test-results/screens';

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Kata sandi').fill(PASSWORD);
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^Selamat (pagi|siang|sore|malam)/ })).toBeVisible();
}

async function openSeptember(page: Page) {
  await page.getByRole('link', { name: 'Performa', exact: true }).click();
  await page.getByLabel('Periode', { exact: true }).selectOption({ label: 'PERIOD-SEP · 1 Sep 2026 – 30 Sep 2026' });
}

test.describe.configure({ mode: 'serial' });

test('HR: analitik September sesuai fixture (BR-A 7,5 jt · BR-B 4 jt · BR-ZERO N/A · DIV-1 6 jt)', async ({ page }) => {
  await login(page, 'hr@example.test');
  await openSeptember(page);
  const totalDiv = page.locator('div.rounded-2xl', { hasText: 'Total DIV-1' });
  await expect(totalDiv).toContainText('Rp21.000.000,00');
  await expect(totalDiv).toContainText('3,50');
  await expect(totalDiv).toContainText('Rp6.000.000,00');
  const table = page.getByRole('region', { name: 'Tabel revenue per karyawan' });
  await expect(table.getByRole('row', { name: /^BR-A/ })).toContainText('Rp7.500.000,00');
  await expect(table.getByRole('row', { name: /^BR-B/ })).toContainText('Rp4.000.000,00');
  await expect(table.getByRole('row', { name: /^BR-ZERO/ })).toContainText('N/A');
  await page.screenshot({ path: `${SHOTS}/20-performa-analitik-hr.png`, fullPage: true });
});

test('HR: review EMP-1 = 85 (45 + 40) → finalisasi dengan konfirmasi → snapshot final', async ({ page }) => {
  await login(page, 'hr@example.test');
  await openSeptember(page);
  await page.getByRole('tab', { name: 'Review karyawan' }).click();
  await page.getByRole('button', { name: /Karyawan Demo 1/ }).click();
  const panel = page.getByRole('region', { name: 'Review Karyawan Demo 1' });
  await expect(panel.getByText('Skor sementara')).toBeVisible();
  await expect(panel.getByRole('row', { name: /Revenue cabang/ })).toContainText('75,00%');
  await expect(panel.getByRole('row', { name: /Revenue cabang/ })).toContainText('45,00');
  await expect(panel.getByText('85,00', { exact: true })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/21-review-draf.png`, fullPage: true });

  await panel.getByRole('button', { name: 'Finalisasi review' }).click();
  await panel.getByRole('alertdialog').getByRole('button', { name: 'Ya, finalisasi' }).click();
  await expect(panel.getByText('Skor final')).toBeVisible();
  await expect(panel.getByRole('status')).toContainText('Revenue BR-A: Rp15.000.000,00 dari pencocokan v1');
  await expect(page.getByRole('row', { name: /Karyawan Demo 1/ })).toContainText('Final');
  await page.screenshot({ path: `${SHOTS}/22-review-final.png`, fullPage: true });
});

test('MANAGER-A: benchmark divisi tidak tersedia; review hanya EMP-1 & EMP-2 (EMP-3 pindah ke BR-B tidak tampil)', async ({ page }) => {
  await login(page, 'manager-a@example.test');
  await openSeptember(page);
  await expect(page.getByText(/Benchmark divisi tidak tersedia untuk akses Anda/)).toBeVisible();
  await expect(page.getByText('Rp21.000.000,00')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Tabel revenue per karyawan' }).getByRole('row', { name: /^BR-B/ })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/23-performa-manager-a.png`, fullPage: true });

  await page.getByRole('tab', { name: 'Review karyawan' }).click();
  await expect(page.getByRole('button', { name: /Karyawan Demo 1/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Karyawan Demo 2/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Karyawan Demo 3/ })).toHaveCount(0);
  await page.getByRole('button', { name: /Karyawan Demo 1/ }).click();
  await expect(page.getByText('Skor final')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Finalisasi review' })).toHaveCount(0);
  await expect(page.getByRole('textbox')).toHaveCount(0);
});
