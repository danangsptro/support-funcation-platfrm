import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.DEMO_PASSWORD ?? '';
const SHOTS = 'test-results/screens';

test.beforeAll(() => {
  if (!PASSWORD) throw new Error('DEMO_PASSWORD tidak ada; jalankan dari repo dengan .env terisi');
});

const DEMO: Record<string, string> = {
  'Admin organisasi': 'admin@example.test',
  HR: 'hr@example.test',
  Finance: 'finance@example.test',
  'Manager Cabang A': 'manager-a@example.test',
  'Tanpa akses': 'no-grant@example.test',
};

async function loginWithDemo(page: Page, label: keyof typeof DEMO) {
  await page.getByText('Akun demo untuk presentasi').click();
  await page.getByRole('button', { name: `Pakai akun ${label} (${DEMO[label]})`, exact: true }).click();
  await expect(page.getByLabel('Kata sandi')).toBeFocused();
  await page.getByLabel('Kata sandi').fill(PASSWORD);
  await page.getByRole('button', { name: 'Masuk' }).click();
}

test('tautan langsung → login → kembali ke Organisasi; MANAGER-A hanya melihat cakupannya', async ({ page }) => {
  await page.goto('/organization');
  await expect(page).toHaveURL(/\/login$/);
  await page.screenshot({ path: `${SHOTS}/01-login-desktop.png` });

  await loginWithDemo(page, 'Manager Cabang A');
  await expect(page).toHaveURL(/\/organization$/);
  const unitTable = page.getByRole('table').first();
  await expect(unitTable.getByRole('cell', { name: 'BR-A', exact: true }).first()).toBeVisible();
  await expect(unitTable.getByRole('cell', { name: 'CC-A', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: 'BR-B', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Ubah nama/ })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/02-organisasi-manager-a.png`, fullPage: true });
});

test('sesi memakai cookie httpOnly: token tidak terbaca JavaScript', async ({ page, context }) => {
  await page.goto('/login');
  await loginWithDemo(page, 'HR');
  await expect(page.getByRole('heading', { level: 1, name: /^Selamat (pagi|siang|sore|malam)/ })).toBeVisible();

  const cookie = (await context.cookies()).find((c) => c.name === 'sfp_session');
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/api' });
  const visibleToJs = await page.evaluate(() => ({
    cookie: document.cookie,
    session: JSON.stringify({ ...sessionStorage }),
    local: JSON.stringify({ ...localStorage }),
  }));
  expect(visibleToJs.cookie).not.toContain('sfp_session');
  expect(visibleToJs.session + visibleToJs.local).not.toContain(cookie!.value);
});

test('beranda menjelaskan akses dalam bahasa sehari-hari; logout mengakhiri sesi', async ({ page }) => {
  await page.goto('/login');
  await loginWithDemo(page, 'Manager Cabang A');
  await expect(page.getByText('Cabang BR-A dan unit di bawahnya · Demo Nusantara')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/03-beranda-manager-a.png` });

  await page.getByRole('button', { name: /^Menu akun/ }).click();
  await page.getByRole('button', { name: 'Keluar' }).click();
  await expect(page).toHaveURL(/\/login$/);
  const me = await page.request.get('/api/v1/auth/me');
  expect(me.status()).toBe(401);
});

test('sesi dicabut (cookie hilang) → kembali ke login dengan pesan sesi berakhir', async ({ page, context }) => {
  await page.goto('/login');
  await loginWithDemo(page, 'Finance');
  await expect(page.getByRole('heading', { level: 1, name: /^Selamat (pagi|siang|sore|malam)/ })).toBeVisible();
  await context.clearCookies();
  await page.reload();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('status')).toContainText('Sesi Anda telah berakhir');
  await page.screenshot({ path: `${SHOTS}/04-sesi-berakhir.png` });
});

test('ADMIN melihat tombol Ubah nama pada setiap unit (tanpa menyimpan perubahan)', async ({ page }) => {
  await page.goto('/login');
  await loginWithDemo(page, 'Admin organisasi');
  await page.getByRole('link', { name: 'Organisasi', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Ubah nama unit BR-A' })).toBeVisible();
  await page.getByRole('button', { name: 'Ubah nama unit BR-A' }).click();
  const dialog = page.getByRole('dialog', { name: 'Ubah nama unit' });
  await expect(dialog.getByLabel('Nama baru')).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Simpan perubahan' })).toBeDisabled();
  await page.screenshot({ path: `${SHOTS}/05-admin-ubah-nama.png` });
  await dialog.getByRole('button', { name: 'Batal' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ubah nama unit BR-A' })).toBeFocused();
});

test('akun tanpa akses: beranda menjelaskan, menu Organisasi tidak ada, akses langsung ditolak backend', async ({ page }) => {
  await page.goto('/login');
  await loginWithDemo(page, 'Tanpa akses');
  await expect(page.getByText('Akun ini belum memiliki peran atau cakupan data.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Organisasi', exact: true })).toHaveCount(0);
  await page.goto('/organization');
  await expect(page.getByText('Akun Anda tidak memiliki izin melihat data organisasi.')).toBeVisible();
});

test('kata sandi salah → pesan jelas dan fokus ke peringatan', async ({ page }) => {
  await page.goto('/login');
  // Email acak agar test berulang tidak memicu batas percobaan untuk akun demo.
  await page.getByLabel('Email').fill(`e2e-${Date.now()}@example.test`);
  await page.getByLabel('Kata sandi').fill('salah');
  await page.getByRole('button', { name: 'Masuk' }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Email atau kata sandi salah');
  await expect(alert).toBeFocused();
  await expect(page.getByLabel('Kata sandi')).toHaveValue('');
  await page.screenshot({ path: `${SHOTS}/06-login-gagal.png` });
});

test('tampilan HP 390px: formulir utuh tanpa scroll horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Masuk' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
  await page.screenshot({ path: `${SHOTS}/07-login-hp.png`, fullPage: true });
});

test('beranda di HP 390px: sidebar jadi drawer lewat tombol menu, tanpa scroll horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login');
  await loginWithDemo(page, 'Finance');
  await expect(page.getByRole('heading', { level: 1, name: /^Selamat (pagi|siang|sore|malam)/ })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Navigasi utama', exact: true })).toBeHidden();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
  await page.screenshot({ path: `${SHOTS}/08-beranda-hp.png`, fullPage: true });
  await page.getByRole('button', { name: 'Buka menu' }).click();
  const drawer = page.getByRole('navigation', { name: 'Navigasi utama (seluler)' });
  await expect(drawer).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/08b-menu-hp.png` });
  await drawer.getByRole('link', { name: 'Rekonsiliasi' }).click();
  await expect(page).toHaveURL(/\/reconciliation/);
  await expect(drawer).toBeHidden();
});

test('menu akun: nama, peran, status sistem, dan Keluar', async ({ page }) => {
  await page.goto('/login');
  await loginWithDemo(page, 'Manager Cabang A');
  await page.getByRole('button', { name: /^Menu akun manager-a@example.test/ }).click();
  await expect(page.getByText('Sistem siap').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Keluar' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/14-menu-akun.png` });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Keluar' })).toHaveCount(0);
});
