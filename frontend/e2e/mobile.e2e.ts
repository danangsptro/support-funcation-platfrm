import { resolve } from 'node:path';
import { expect, request as pwRequest, test, type Page } from '@playwright/test';

/**
 * Phase 07 — smoke test HP 390px untuk tiga modul: navigasi lewat drawer, tombol utama, dialog, dan tanpa scroll
 * horizontal di tingkat halaman (tabel lebar boleh digeser di dalam kartunya sendiri).
 * Tidak memfinalisasi atau memutuskan apa pun — dialog dibuka lalu dibatalkan.
 */
const PASSWORD = process.env.DEMO_PASSWORD ?? '';
const SHOTS = 'test-results/screens';
const FIXTURE = (f: string) => resolve(process.cwd(), '../samples/test-data', f);
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:8096';

/** Pengajuan BR-A yang sudah diajukan (lewat API) agar Manager punya sesuatu untuk dibuka, tanpa bergantung urutan test lain. */
async function submittedRequest(title: string) {
  const ctx = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { 'X-Requested-With': 'sfp-web' } });
  expect((await ctx.post('/api/v1/auth/login', { data: { email: 'employee-a@example.test', password: PASSWORD } })).ok()).toBe(true);
  const units = (await (await ctx.get('/api/v1/approval-requests/options')).json()).units as { id: string; code: string }[];
  const created = await (await ctx.post('/api/v1/approval-requests', { data: { unitId: units.find((u) => u.code === 'BR-A')!.id, title, amount: '2500000', reason: 'Uji tampilan HP' } })).json();
  expect((await ctx.post(`/api/v1/approval-requests/${created.id}/submit`)).ok()).toBe(true);
  await ctx.dispose();
}

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Kata sandi').fill(PASSWORD);
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page.getByRole('button', { name: /^Menu akun/ })).toBeVisible();
}

async function openViaDrawer(page: Page, label: string) {
  await page.getByRole('button', { name: 'Buka menu' }).click();
  const drawer = page.getByRole('navigation', { name: 'Navigasi utama (seluler)' });
  await drawer.getByRole('link', { name: label }).click();
  await expect(drawer).toBeHidden();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

async function expectNoPageOverflow(page: Page, where: string) {
  await page.waitForLoadState('networkidle');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `scroll horizontal halaman di ${where}`).toBeLessThanOrEqual(0);
}

test('HP — Rekonsiliasi (Finance): drawer, 3 langkah unggah, riwayat & hasil', async ({ page }) => {
  await login(page, 'finance@example.test');
  await openViaDrawer(page, 'Rekonsiliasi');
  await expectNoPageOverflow(page, 'rekonsiliasi baru');
  await page.getByLabel('Cabang / unit').selectOption({ label: 'BR-A' });
  await page.getByLabel('Akun / rekening').fill('ACC-1');
  await page.getByLabel('Unggah file Catatan internal').setInputFiles(FIXTURE('reconciliation/scoped/ORG-1-BR-A-internal.csv'));
  await expect(page.getByText('7 transaksi siap')).toBeVisible();
  await page.getByLabel('Unggah file Mutasi bank / pihak ketiga').setInputFiles(FIXTURE('reconciliation/scoped/ORG-1-BR-A-external.csv'));
  const match = page.getByRole('button', { name: 'Cocokkan sekarang' });
  await match.scrollIntoViewIfNeeded();
  await expect(match).toBeInViewport();
  await page.screenshot({ path: `${SHOTS}/60-hp-rekonsiliasi-baru.png`, fullPage: true });
  await match.click();
  const detail = page.getByRole('region', { name: 'Detail run' });
  await expect(detail.getByText('28,57%')).toBeVisible();
  await expectNoPageOverflow(page, 'hasil rekonsiliasi');
  await detail.getByRole('listitem').filter({ hasText: 'Nomor referensi ganda' }).getByRole('button', { name: /^Tampilkan \d+ transaksi/ }).click();
  await expect(detail.getByRole('cell', { name: 'REF-007' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/61-hp-rekonsiliasi-hasil.png`, fullPage: true });
});

test('HP — Performa (HR): analitik, tab review, panel KPI, dialog finalisasi dibatalkan', async ({ page }) => {
  await login(page, 'hr@example.test');
  await openViaDrawer(page, 'Performa');
  await page.getByLabel('Periode', { exact: true }).selectOption({ label: 'PERIOD-SEP · 1 Sep 2026 – 30 Sep 2026' });
  await expect(page.getByText(/BR-A/).first()).toBeVisible();
  await expectNoPageOverflow(page, 'analitik');
  await page.screenshot({ path: `${SHOTS}/62-hp-performa-analitik.png`, fullPage: true });
  await page.getByRole('tab', { name: 'Review karyawan' }).click();
  await page.getByRole('button', { name: /Karyawan Demo 1/ }).click();
  const panel = page.getByRole('region', { name: 'Review Karyawan Demo 1' });
  await expect(panel.getByText('Skor sementara')).toBeVisible();
  await expectNoPageOverflow(page, 'review karyawan');
  const finalize = panel.getByRole('button', { name: 'Finalisasi review' });
  await finalize.scrollIntoViewIfNeeded();
  await finalize.click();
  const confirm = panel.getByRole('alertdialog', { name: 'Konfirmasi finalisasi' });
  await expect(confirm).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/63-hp-performa-konfirmasi.png`, fullPage: true });
  await confirm.getByRole('button', { name: 'Batal' }).click();
  await expect(confirm).toBeHidden();
  await expect(panel.getByText('Skor sementara')).toBeVisible();
});

test('HP — Persetujuan: pengaju membuka form baru; Manager membuka dialog Setujui lalu membatalkan', async ({ page }) => {
  await login(page, 'employee-a@example.test');
  await openViaDrawer(page, 'Persetujuan');
  await expectNoPageOverflow(page, 'persetujuan pengaju');
  await page.getByRole('button', { name: '+ Pengajuan baru' }).click();
  const form = page.getByRole('dialog', { name: 'Pengajuan anggaran baru' });
  await form.getByLabel('Nominal (Rp)').fill('15000000');
  await expect(form.getByText('2. Finance')).toBeVisible();
  const save = form.getByRole('button', { name: 'Simpan draf' });
  await save.scrollIntoViewIfNeeded();
  await expect(save).toBeInViewport();
  await page.screenshot({ path: `${SHOTS}/64-hp-pengajuan-baru.png` });
  await form.getByRole('button', { name: 'Batal' }).click();
  await expect(form).toBeHidden();

  await page.getByRole('button', { name: /^Menu akun/ }).click();
  await page.getByRole('button', { name: 'Keluar' }).click();
  await expect(page).toHaveURL(/\/login/);
  const title = `HP ${Date.now()}`;
  await submittedRequest(title);
  await login(page, 'manager-a@example.test');
  await page.goto('/approvals?tab=inbox');
  await expect(page.getByRole('heading', { level: 1, name: 'Persetujuan anggaran' })).toBeVisible();
  await expectNoPageOverflow(page, 'persetujuan manager');
  await page.getByRole('list', { name: 'Daftar pengajuan' }).getByRole('button', { name: new RegExp(title) }).click();
  const detail = page.getByRole('region', { name: /^Pengajuan / });
  await detail.scrollIntoViewIfNeeded();
  await expect(detail).toBeVisible();
  await expectNoPageOverflow(page, 'detail pengajuan');
  await page.screenshot({ path: `${SHOTS}/65-hp-detail-pengajuan.png`, fullPage: true });
  await detail.getByRole('button', { name: 'Setujui', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Setujui langkah ini?' });
  await expect(dialog.getByRole('button', { name: 'Ya, setujui' })).toBeInViewport();
  await page.screenshot({ path: `${SHOTS}/67-hp-dialog-setujui.png` });
  await dialog.getByRole('button', { name: 'Batal' }).click();
  await expect(dialog).toBeHidden();
  await expect(detail.getByText('Menunggu keputusan dari')).toBeVisible();
});

test('HP — Beranda & Organisasi (Admin): tanpa scroll horizontal halaman, tabel bergulir di dalam kartu', async ({ page }) => {
  await login(page, 'admin@example.test');
  await expectNoPageOverflow(page, 'beranda');
  await openViaDrawer(page, 'Organisasi');
  await expect(page.getByRole('heading', { name: /Unit kerja/ })).toBeVisible();
  await expectNoPageOverflow(page, 'organisasi');
  await page.screenshot({ path: `${SHOTS}/66-hp-organisasi.png`, fullPage: true });
});
