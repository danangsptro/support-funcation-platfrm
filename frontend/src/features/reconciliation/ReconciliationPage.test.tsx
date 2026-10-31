import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFetchMock, jsonResponse } from '../../test/fetch-mock';
import { AuthProvider } from '../auth/AuthContext';
import { ReconciliationPage } from './ReconciliationPage';

const me = (permissions: string[]) => () =>
  jsonResponse(200, { id: 'u', email: 'x@example.test', grants: [], permissions, sessionExpiresAt: new Date(Date.now() + 3600_000).toISOString() });
const empty = () => jsonResponse(200, { items: [], page: 1, pageSize: 100, total: 0 });

function renderPage(url = '/reconciliation') {
  render(
    <AuthProvider>
      <MemoryRouter initialEntries={[url]}>
        <ReconciliationPage />
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('halaman rekonsiliasi per peran', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('Finance: tab "Rekonsiliasi baru" terbuka default dengan 3 langkah', async () => {
    installFetchMock({
      'GET /auth/me': me(['dataset.import', 'reconciliation.run', 'reconciliation.read', 'reconciliation.summary.read', 'org.read']),
      'GET /org-units': () => jsonResponse(200, { items: [{ id: 'u', code: 'BR-A', name: 'BR-A', organization: { code: 'ORG-1' } }], total: 1 }),
      'GET /datasets': empty,
      'GET /reconciliation-runs': empty,
    });
    renderPage();
    expect(await screen.findByRole('tab', { name: 'Rekonsiliasi baru' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('heading', { name: /Pilih cabang dan akun/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Siapkan dua data yang akan dicocokkan/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Cocokkan/ })).toBeInTheDocument();
  });

  it('Manager: tidak ada tab rekonsiliasi baru, langsung riwayat & hasil', async () => {
    installFetchMock({
      'GET /auth/me': me(['reconciliation.summary.read', 'org.read']),
      'GET /reconciliation-runs': empty,
    });
    renderPage();
    expect(await screen.findByText('Belum ada hasil pencocokan dalam akses Anda.')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Rekonsiliasi baru' })).not.toBeInTheDocument();
  });

  /** Mock fetch yang membaca query string (paginasi/filter) dan bisa menahan respons tertentu. */
  function serverMock(runsFor: (q: URLSearchParams) => Promise<Response> | Response) {
    const calls: string[] = [];
    const runA = (i: number) => ({ id: `a${i}`, ruleVersion: 'v1', dateToleranceDays: 1, unit: { id: 'u-a', code: 'BR-A', name: 'BR-A' }, accountId: 'ACC-1', internalDatasetId: 'i', externalDatasetId: 'e', groups: 1, isCanonical: true, createdAt: '2026-10-31T05:00:00Z' });
    const runB = { ...runA(0), id: 'old-b', unit: { id: 'u-b', code: 'BR-B', name: 'BR-B' } };
    const summary = { runId: 'x', ruleVersion: 'v1', groups: 1, counts: { MATCHED: 1, MISMATCHED: 0, MISSING_IN_INTERNAL: 0, MISSING_IN_EXTERNAL: 0 }, byReason: {}, matchedRatioPercentDisplay: '100.00', verifiedRevenue: '1', anomalousInternalTotal: '0', anomalousExternalTotal: '0', uniquePairAmountDifferenceTotal: '0', isCanonical: true };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), 'http://x');
        const path = url.pathname.replace(/^\/api\/v1/, '');
        calls.push(path + url.search);
        if (path === '/auth/me') return me(['reconciliation.summary.read', 'org.read'])();
        if (path === '/org-units') return jsonResponse(200, { items: [{ id: 'u-a', code: 'BR-A', name: 'BR-A' }, { id: 'u-b', code: 'BR-B', name: 'BR-B' }], total: 2 });
        if (path === '/reconciliation-runs/old-b') return jsonResponse(200, runB);
        if (path.endsWith('/summary')) return jsonResponse(200, summary);
        if (path === '/reconciliation-runs') {
          const q = url.searchParams;
          if (q.get('pageSize') === '1') return jsonResponse(200, { items: [], total: q.get('unitId') === 'u-b' ? 1 : q.get('unitId') === 'u-a' ? 111 : 112 });
          return runsFor(q);
        }
        return jsonResponse(404, { code: 'NOT_FOUND', message: path });
      }),
    );
    return { calls, runA, runB };
  }

  it('filter cabang dikirim sebagai unitId ke server, halaman kembali ke 1, dan respons lama yang terlambat diabaikan', async () => {
    let releaseOld!: () => void;
    const oldGate = new Promise<void>((r) => (releaseOld = r));
    const m = serverMock(async (q) => {
      if (q.get('unitId') === 'u-b') return jsonResponse(200, { items: [m.runB], page: 1, pageSize: 10, total: 1 });
      if (q.get('page') === '2') {
        await oldGate; // respons halaman 2 (filter lama) datang terlambat
        return jsonResponse(200, { items: [m.runA(20)], page: 2, pageSize: 10, total: 112 });
      }
      return jsonResponse(200, { items: [m.runA(1), m.runA(2)], page: Number(q.get('page')), pageSize: 10, total: 112 });
    });
    const user = userEvent.setup();
    renderPage('/reconciliation?tab=hasil');
    const chips = await screen.findByRole('group', { name: 'Filter cabang' });
    await user.click(await screen.findByRole('button', { name: 'Berikutnya' })); // halaman 2 tertahan
    await user.click(within(chips).getByRole('button', { name: /^BR-B/ }));
    expect(await screen.findByRole('button', { name: /^Lihat hasil BR-B/ })).toBeInTheDocument();
    expect(m.calls).toContain('/reconciliation-runs?page=1&pageSize=10&unitId=u-b');
    releaseOld();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('button', { name: /^Lihat hasil BR-A/ })).not.toBeInTheDocument();
    expect(screen.getByText(/1 pencocokan di cabang terpilih/)).toBeInTheDocument();
  });

  it('tautan langsung ke run lama di luar halaman aktif tetap membuka detailnya', async () => {
    const m = serverMock(() => jsonResponse(200, { items: [m.runA(1)], page: 1, pageSize: 10, total: 112 }));
    renderPage('/reconciliation?tab=hasil&run=old-b');
    expect(await screen.findByRole('heading', { name: 'Hasil pencocokan BR-B · ACC-1' })).toBeInTheDocument();
    expect(screen.getByText(/tidak ada di halaman riwayat yang sedang ditampilkan/)).toBeInTheDocument();
    await waitFor(() => expect(m.calls).toContain('/reconciliation-runs/old-b'));
  });
});
