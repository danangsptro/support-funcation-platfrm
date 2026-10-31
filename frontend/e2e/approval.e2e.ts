import { expect, request as pwRequest, test, type APIRequestContext, type Page } from '@playwright/test';

const PASSWORD = process.env.DEMO_PASSWORD ?? '';
const SHOTS = 'test-results/screens';
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:8096';

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Kata sandi').fill(PASSWORD);
  await page.getByRole('button', { name: 'Masuk' }).click();
  // Setelah logout, login mengantar kembali ke halaman asal (mis. /approvals), jadi cukup pastikan sudah masuk.
  await expect(page).not.toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: /^Menu akun/ })).toBeVisible();
}

/** Keluar dan tunggu sampai server menghapus sesi (halaman login tampil) sebelum login ulang. */
async function logout(page: Page) {
  await page.getByRole('button', { name: /^Menu akun/ }).click();
  await page.getByRole('button', { name: 'Keluar' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Masuk ke akun Anda' })).toBeVisible();
}

/** Klien API ber-cookie untuk menyiapkan/memicu kondisi (mis. approver lain memutuskan lebih dulu). */
async function api(email: string): Promise<APIRequestContext> {
  const ctx = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { 'X-Requested-With': 'sfp-web' } });
  const res = await ctx.post('/api/v1/auth/login', { data: { email, password: PASSWORD } });
  expect(res.ok()).toBe(true);
  return ctx;
}

async function submittedViaApi(title: string, amount: string) {
  const emp = await api('employee-a@example.test');
  const units = (await (await emp.get('/api/v1/approval-requests/options')).json()).units as { id: string; code: string }[];
  const created = await (await emp.post('/api/v1/approval-requests', { data: { unitId: units.find((u) => u.code === 'BR-A')!.id, title, amount, reason: 'Kebutuhan operasional cabang' } })).json();
  const submitted = await (await emp.post(`/api/v1/approval-requests/${created.id}/submit`)).json();
  await emp.dispose();
  return submitted as { id: string; steps: { id: string }[] };
}

async function openRequest(page: Page, title: string) {
  await page.getByRole('link', { name: 'Persetujuan', exact: true }).click();
  await page.getByRole('list', { name: 'Daftar pengajuan' }).getByRole('button', { name: new RegExp(title) }).click();
  return page.getByRole('region', { name: /^Pengajuan / });
}

test.describe.configure({ mode: 'serial' });

test('alur penuh: pengaju membuat & mengajukan Rp15 jt → Manager → Finance → Disetujui; riwayat terlihat pengaju', async ({ page }) => {
  const title = `Laptop tim ${Date.now()}`;
  await login(page, 'employee-a@example.test');
  await page.getByRole('link', { name: 'Persetujuan', exact: true }).click();
  await page.getByRole('button', { name: '+ Pengajuan baru' }).click();
  const form = page.getByRole('dialog', { name: 'Pengajuan anggaran baru' });
  await form.getByLabel('Judul').fill(title);
  await form.getByLabel('Nominal (Rp)').fill('15000000');
  await expect(form.getByText('2. Finance')).toBeVisible();
  await form.getByLabel('Alasan pengajuan').fill('Laptop lama rusak dan menghambat penjualan');
  await page.screenshot({ path: `${SHOTS}/30-pengajuan-baru.png` });
  await form.getByRole('button', { name: 'Simpan draf' }).click();

  const detail = page.getByRole('region', { name: /^Pengajuan / });
  await expect(detail.getByText('Draf', { exact: true })).toBeVisible();
  await detail.getByRole('button', { name: 'Ajukan' }).click();
  await page.getByRole('dialog', { name: 'Ajukan untuk persetujuan?' }).getByRole('button', { name: 'Ya, ajukan' }).click();
  await expect(detail.getByText('Menunggu keputusan dari')).toContainText('Manager BR-A');

  await logout(page);
  await login(page, 'manager-a@example.test');
  const forManager = await openRequest(page, title);
  await expect(forManager.getByText('Rp15.000.000,00')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/31-detail-manager.png`, fullPage: true });
  await forManager.getByRole('button', { name: 'Setujui' }).click();
  await page.getByRole('dialog', { name: 'Setujui langkah ini?' }).getByRole('button', { name: 'Ya, setujui' }).click();
  await expect(forManager.getByText('Langkah disetujui.')).toBeVisible();
  await expect(forManager.getByText('Menunggu keputusan dari')).toContainText('Finance BR-A');

  await logout(page);
  await login(page, 'finance@example.test');
  const forFinance = await openRequest(page, title);
  await forFinance.getByRole('button', { name: 'Setujui' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Ya, setujui' }).click();
  await expect(forFinance.getByText('Disetujui', { exact: true }).first()).toBeVisible();

  await logout(page);
  await login(page, 'employee-a@example.test');
  const mine = await openRequest(page, title);
  const trail = mine.getByRole('list', { name: 'Jejak audit' });
  await expect(trail.getByText('Diajukan')).toBeVisible();
  await expect(trail.getByText('Disetujui')).toHaveCount(2);
  await page.screenshot({ path: `${SHOTS}/32-riwayat-pengaju.png`, fullPage: true });
});

test('409 di UI: Manager lain memutuskan lebih dulu → pesan jelas & status dimuat ulang', async ({ page }) => {
  const title = `Konflik ${Date.now()}`;
  const r = await submittedViaApi(title, '12000000');
  await login(page, 'manager-a@example.test');
  const detail = await openRequest(page, title);
  await expect(detail.getByRole('button', { name: 'Setujui' })).toBeVisible();
  const a2 = await api('manager-a2@example.test');
  expect((await a2.post(`/api/v1/approval-requests/${r.id}/steps/${r.steps[0].id}/approve`, { data: {} })).status()).toBe(200);
  await a2.dispose();
  await detail.getByRole('button', { name: 'Setujui' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Ya, setujui' }).click();
  await expect(detail.getByRole('status')).toContainText('Status terbaru sudah dimuat ulang');
  await expect(detail.getByText(/oleh manager-a2@example.test/)).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Setujui' })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/33-konflik-409.png`, fullPage: true });
});

test('delegasi lewat UI: MANAGER-A → MANAGER-A2; A2 melihatnya di inbox dan bisa menyetujui', async ({ page }) => {
  const title = `Delegasi ${Date.now()}`;
  await submittedViaApi(title, '5000000');
  await login(page, 'manager-a@example.test');
  const detail = await openRequest(page, title);
  await detail.getByRole('button', { name: 'Delegasikan' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delegasikan langkah ini' });
  await expect(dialog.getByRole('combobox')).toHaveValue(/.+/);
  await dialog.getByRole('button', { name: 'Delegasikan' }).click();
  await expect(detail.getByText('Langkah berhasil didelegasikan.')).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Setujui' })).toHaveCount(0);

  await logout(page);
  await login(page, 'manager-a2@example.test');
  await page.goto('/approvals?tab=inbox');
  await page.getByRole('list', { name: 'Daftar pengajuan' }).getByRole('button', { name: new RegExp(title) }).click();
  const forA2 = page.getByRole('region', { name: /^Pengajuan / });
  await forA2.getByRole('button', { name: 'Setujui' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Ya, setujui' }).click();
  await expect(forA2.getByText('Disetujui', { exact: true }).first()).toBeVisible();
  await expect(forA2.getByRole('list', { name: 'Jejak audit' }).getByText('Didelegasikan')).toBeVisible();
});
