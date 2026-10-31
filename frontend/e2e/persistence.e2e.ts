import { expect, test, type Page } from '@playwright/test';

/**
 * @setelah-restart — dijalankan scripts/e2e-isolated.sh SETELAH seluruh suite lain selesai dan container
 * api + web di-restart (database tetap). Memastikan hasil yang dibuat lewat UI (review final, approval
 * bertingkat, run rekonsiliasi) dibaca ulang dari PostgreSQL, bukan dari memori aplikasi.
 */
const PASSWORD = process.env.DEMO_PASSWORD ?? '';
const SHOTS = 'test-results/screens';

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Kata sandi').fill(PASSWORD);
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page.getByRole('button', { name: /^Menu akun/ })).toBeVisible();
}

test('@setelah-restart HR: review EMP-1 tetap Final dengan skor 85,00', async ({ page }) => {
  await login(page, 'hr@example.test');
  await page.goto('/performance?tab=review');
  await page.getByLabel('Periode', { exact: true }).selectOption({ label: 'PERIOD-SEP · 1 Sep 2026 – 30 Sep 2026' });
  await expect(page.getByRole('row', { name: /Karyawan Demo 1/ })).toContainText('Final');
  await page.getByRole('button', { name: /Karyawan Demo 1/ }).click();
  const panel = page.getByRole('region', { name: 'Review Karyawan Demo 1' });
  await expect(panel.getByText('Skor final')).toBeVisible();
  await expect(panel.getByText('85,00', { exact: true })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/50-restart-review-final.png`, fullPage: true });
});

test('@setelah-restart Pengaju: pengajuan Rp15 jt tetap Disetujui dengan jejak audit lengkap', async ({ page }) => {
  await login(page, 'employee-a@example.test');
  await page.goto('/approvals?tab=mine&status=APPROVED');
  await page.getByRole('list', { name: 'Daftar pengajuan' }).getByRole('button', { name: /Laptop tim/ }).first().click();
  const detail = page.getByRole('region', { name: /^Pengajuan / });
  await expect(detail.getByText('Rp15.000.000,00')).toBeVisible();
  const trail = detail.getByRole('list', { name: 'Jejak audit' });
  await expect(trail.getByText('Diajukan')).toBeVisible();
  await expect(trail.getByText('Disetujui')).toHaveCount(2);
  await page.screenshot({ path: `${SHOTS}/51-restart-approval.png`, fullPage: true });
});

test('@setelah-restart Finance: hasil rekonsiliasi BR-A tetap 28,57%', async ({ page }) => {
  await login(page, 'finance@example.test');
  await page.goto('/reconciliation?tab=hasil');
  await page.getByRole('group', { name: 'Filter cabang' }).getByRole('button', { name: /^BR-A/ }).click();
  await page.getByRole('button', { name: /^Lihat hasil BR-A/ }).first().click();
  const detail = page.getByRole('region', { name: 'Detail run' });
  await expect(detail.getByText('28,57%')).toBeVisible();
  await expect(detail.getByText('2 dari 7 grup referensi cocok')).toBeVisible();
});
