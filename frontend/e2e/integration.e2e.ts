import { createHmac } from 'node:crypto';
import { expect, request as pwRequest, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Phase 06 — integrasi lintas modul: isolasi Manager B (UI + manipulasi URL/request), refresh deep link,
 * token kedaluwarsa sungguhan, error API, dan overflow tabel di desktop.
 */
const PASSWORD = process.env.DEMO_PASSWORD ?? '';
const SHOTS = 'test-results/screens';
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:8096';

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Kata sandi').fill(PASSWORD);
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page.getByRole('button', { name: /^Menu akun/ })).toBeVisible();
}

async function api(email: string): Promise<APIRequestContext> {
  const ctx = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { 'X-Requested-With': 'sfp-web' } });
  expect((await ctx.post('/api/v1/auth/login', { data: { email, password: PASSWORD } })).ok()).toBe(true);
  return ctx;
}

/** JWT HS256 bertanda tangan sah (JWT_SECRET dari .env yang sama dengan stack E2E) tetapi exp di masa lalu. */
function expiredToken(sub: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET tidak ada di .env');
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, typ: 'access', iat: now - 7200, exp: now - 3600 })}`;
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}

async function setSessionCookie(page: Page, value: string) {
  const url = new URL(BASE);
  await page.context().addCookies([{ name: 'sfp_session', value, domain: url.hostname, path: '/api', httpOnly: true, sameSite: 'Strict' }]);
}

test.describe('isolasi Manager B', () => {
  let brARunId: string;
  let brARequest: { id: string; steps: { id: string }[] };

  test.beforeAll(async () => {
    const fin = await api('finance@example.test');
    const runs = (await (await fin.get('/api/v1/reconciliation-runs?pageSize=100')).json()).items as { id: string; unit: { code: string } }[];
    brARunId = runs.find((r) => r.unit.code === 'BR-A')!.id;
    await fin.dispose();

    const emp = await api('employee-a@example.test');
    const units = (await (await emp.get('/api/v1/approval-requests/options')).json()).units as { id: string; code: string }[];
    const created = await (
      await emp.post('/api/v1/approval-requests', { data: { unitId: units.find((u) => u.code === 'BR-A')!.id, title: `Isolasi ${Date.now()}`, amount: '3000000', reason: 'Uji isolasi' } })
    ).json();
    brARequest = await (await emp.post(`/api/v1/approval-requests/${created.id}/submit`)).json();
    await emp.dispose();
  });

  test('UI: rekonsiliasi, performa, organisasi, dan persetujuan Manager B tanpa data BR-A', async ({ page }) => {
    await login(page, 'manager-b@example.test');

    await page.goto('/reconciliation');
    await expect(page.getByRole('region', { name: 'Detail run' })).toBeVisible();
    await expect(page.getByRole('cell', { name: /BR-B/ }).first()).toBeVisible();
    await expect(page.getByText(/BR-A/)).toHaveCount(0);

    await page.goto('/organization');
    await expect(page.getByRole('cell', { name: 'BR-B', exact: true }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: 'BR-A', exact: true })).toHaveCount(0);

    await page.goto('/performance');
    await expect(page.getByText(/BR-B/).first()).toBeVisible();
    await expect(page.getByText(/BR-A\b/)).toHaveCount(0);

    await page.goto('/approvals?tab=all');
    await expect(page.getByRole('heading', { name: 'Persetujuan anggaran' })).toBeVisible();
    await expect(page.getByText(/· BR-A ·/)).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/40-manager-b-persetujuan.png`, fullPage: true });
  });

  test('manipulasi URL: deep link ke run & pengajuan BR-A tidak membocorkan data', async ({ page }) => {
    await login(page, 'manager-b@example.test');
    await page.goto(`/reconciliation?tab=hasil&run=${brARunId}`);
    await expect(page.getByText('Hasil pencocokan dari tautan tidak ditemukan dalam akses Anda.')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Detail run' })).toHaveCount(0);
    await expect(page.getByText(/BR-A/)).toHaveCount(0);

    await page.goto(`/approvals?tab=all&id=${brARequest.id}`);
    await expect(page.getByText('Pengajuan tidak ditemukan dalam akses Anda.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Setujui', exact: true })).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/41-manager-b-deeplink-ditolak.png` });
  });

  test('manipulasi request: API menolak baca & keputusan Manager B atas data BR-A', async () => {
    const mb = await api('manager-b@example.test');
    expect((await mb.get(`/api/v1/reconciliation-runs/${brARunId}`)).status()).toBe(404);
    // Rincian per transaksi butuh izin reconciliation.read (Manager tidak punya) → 403 sebelum cek scope.
    expect((await mb.get(`/api/v1/reconciliation-runs/${brARunId}/results`)).status()).toBe(403);
    expect((await mb.get(`/api/v1/approval-requests/${brARequest.id}`)).status()).toBe(404);
    const decide = await mb.post(`/api/v1/approval-requests/${brARequest.id}/steps/${brARequest.steps[0].id}/approve`, { data: {} });
    expect([403, 404]).toContain(decide.status());
    // Pengajuan tetap menunggu Manager BR-A.
    const ma = await api('manager-a@example.test');
    expect((await (await ma.get(`/api/v1/approval-requests/${brARequest.id}`)).json()).status).toBe('PENDING');
    await Promise.all([mb.dispose(), ma.dispose()]);
  });
});

test('refresh deep link: setiap rute & query bertahan setelah reload', async ({ page }) => {
  await login(page, 'hr@example.test');
  const cases: [string, RegExp][] = [
    ['/organization', /Struktur organisasi|Organisasi/],
    ['/performance?tab=review', /Performa/],
    ['/approvals?tab=all&status=APPROVED', /Persetujuan anggaran/],
  ];
  for (const [path, heading] of cases) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`${path.replace(/[?]/g, '\\?')}$`));
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  }
  await expect(page.getByRole('group', { name: 'Filter status' }).getByRole('button', { name: /Disetujui/ })).toHaveAttribute('aria-pressed', 'true');

  await page.goto('/halaman-tidak-ada');
  await expect(page.getByText(/tidak ditemukan/i).first()).toBeVisible();
});

test('token kedaluwarsa (JWT sah, exp lewat) saat membuka halaman → login dengan pesan jelas', async ({ page }) => {
  await login(page, 'finance@example.test');
  const me = await (await page.request.get('/api/v1/auth/me')).json();
  await setSessionCookie(page, expiredToken(me.id));
  expect((await page.request.get('/api/v1/auth/me')).status()).toBe(401);
  await page.goto('/reconciliation?tab=hasil');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('status')).toContainText('Sesi Anda telah berakhir');
  await page.screenshot({ path: `${SHOTS}/42-token-kedaluwarsa.png` });

  // Login ulang mengantar kembali ke halaman yang tadi dibuka.
  await page.getByLabel('Email').fill('finance@example.test');
  await page.getByLabel('Kata sandi').fill(PASSWORD);
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page).toHaveURL(/\/reconciliation\?tab=hasil$/);
});

test('token kedaluwarsa di tengah pemakaian (navigasi tanpa reload) → login dengan pesan jelas', async ({ page }) => {
  await login(page, 'manager-a@example.test');
  const me = await (await page.request.get('/api/v1/auth/me')).json();
  await setSessionCookie(page, expiredToken(me.id));
  await page.getByRole('link', { name: 'Persetujuan', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('status')).toContainText('Sesi Anda telah berakhir');
});

test('error API: daftar gagal dimuat → pesan + Coba lagi memulihkan tanpa reload', async ({ page }) => {
  await login(page, 'admin@example.test');
  await page.route('**/api/v1/approval-requests?*', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"code":"INTERNAL","message":"x"}' }));
  await page.goto('/approvals');
  await expect(page.getByRole('alert')).toContainText('Daftar pengajuan gagal dimuat.');
  await page.screenshot({ path: `${SHOTS}/43-error-api.png` });
  await page.unroute('**/api/v1/approval-requests?*');
  await page.getByRole('button', { name: 'Coba lagi' }).click();
  await expect(page.getByRole('list', { name: 'Daftar pengajuan' })).toBeVisible();
});

test('desktop 1280px: halaman utama tanpa scroll horizontal (tabel tidak meluap)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page, 'finance@example.test');
  for (const path of ['/', '/organization', '/performance', '/performance?tab=review', '/reconciliation?tab=hasil', '/approvals?tab=all']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `scroll horizontal di ${path}`).toBeLessThanOrEqual(0);
  }
  await page.goto('/reconciliation?tab=hasil');
  await page.screenshot({ path: `${SHOTS}/44-rekonsiliasi-desktop.png`, fullPage: true });
});

test('options menggantung (tidak dijawab) → setelah 10 dtk pesan + Coba lagi memuat form tanpa reload', async ({ page }) => {
  test.setTimeout(45_000);
  await login(page, 'employee-a@example.test');
  await page.goto('/approvals');
  // Request pertama ditahan tanpa jawaban; tidak memanggil continue/fulfill.
  let held = 0;
  await page.route('**/api/v1/approval-requests/options', (route) => {
    if (held++ === 0) return;
    return route.continue();
  });
  await page.getByRole('button', { name: '+ Pengajuan baru' }).click();
  const form = page.getByRole('dialog', { name: 'Pengajuan anggaran baru' });
  await expect(form.getByRole('status')).toContainText('Memuat data form');
  const alert = form.getByRole('alert');
  await expect(alert).toContainText('belum termuat', { timeout: 15_000 });
  await page.screenshot({ path: `${SHOTS}/45-options-timeout.png` });
  await alert.getByRole('button', { name: 'Coba lagi' }).click();
  await expect(form.getByLabel(/Unit/)).toContainText('BR-A');
  await expect(alert).toBeHidden();
  expect(held).toBe(2);
});
