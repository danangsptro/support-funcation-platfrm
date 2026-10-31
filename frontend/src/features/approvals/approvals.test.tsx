import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFetchMock, jsonResponse } from '../../test/fetch-mock';
import { AuthProvider } from '../auth/AuthContext';
import { ApprovalsPage } from './ApprovalsPage';
import { NewRequestDialog } from './NewRequestDialog';
import { RequestDetailPanel } from './RequestDetailPanel';
import type { RequestDetail } from './types';

const step1 = { id: 's1', order: 1, role: 'MANAGER', status: 'ACTIVE' as const, assignee: null, decidedBy: null, decidedAt: null };
const step2 = { id: 's2', order: 2, role: 'FINANCE', status: 'WAITING' as const, assignee: null, decidedBy: null, decidedAt: null };
const base: RequestDetail = {
  id: 'r1',
  code: 'REQ-HIGH',
  title: 'Pengadaan laptop',
  amount: '15000000',
  currency: 'IDR',
  status: 'PENDING',
  unit: { id: 'u', code: 'BR-A', name: 'BR-A' },
  requester: { id: 'e', email: 'employee-a@example.test' },
  createdAt: '2026-10-31T01:00:00Z',
  submittedAt: '2026-10-31T01:05:00Z',
  decidedAt: null,
  activeStep: { id: 's1', order: 1, role: 'MANAGER', assignee: null },
  reason: 'Laptop lama rusak',
  workflow: null,
  steps: [step1, step2],
  history: [],
  permissions: { canEdit: false, canSubmit: false, canDecide: true, activeStepId: 's1' },
};
const audit = { items: [{ id: '1', eventType: 'SUBMITTED', actor: 'employee-a@example.test', at: '2026-10-31T01:05:00Z', traceId: null, payload: {} }] };
const routes = (extra = {}) => ({ 'GET /approval-requests/r1': () => jsonResponse(200, base), 'GET /approval-requests/r1/audit': () => jsonResponse(200, audit), ...extra });

describe('detail pengajuan', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('menampilkan nominal, alasan, status, siapa yang perlu bertindak, langkah, dan riwayat', async () => {
    installFetchMock(routes());
    render(<RequestDetailPanel id="r1" onChanged={vi.fn()} />);
    expect(await screen.findByText('Rp15.000.000,00')).toBeInTheDocument();
    expect(screen.getByText('Laptop lama rusak')).toBeInTheDocument();
    expect(screen.getByText('Menunggu persetujuan')).toBeInTheDocument();
    expect(screen.getByText(/Menunggu keputusan dari/)).toHaveTextContent('Manager BR-A — yaitu Anda.');
    const steps = within(screen.getByRole('list', { name: 'Langkah persetujuan' })).getAllByRole('listitem');
    expect(steps.map((s) => s.textContent)).toEqual([expect.stringContaining('Langkah 1: Manager'), expect.stringContaining('Langkah 2: Finance')]);
    expect(within(screen.getByRole('list', { name: 'Jejak audit' })).getByText('Diajukan')).toBeInTheDocument();
  });

  it('Setujui lewat Dialog konfirmasi → POST ke langkah aktif dengan header CSRF', async () => {
    const approved = { ...base, steps: [{ ...step1, status: 'APPROVED' as const }, { ...step2, status: 'ACTIVE' as const }], activeStep: { id: 's2', order: 2, role: 'FINANCE', assignee: null }, permissions: { ...base.permissions, canDecide: false } };
    const fetchMock = installFetchMock(routes({ 'POST /approval-requests/r1/steps/s1/approve': () => jsonResponse(200, approved) }));
    const user = userEvent.setup();
    render(<RequestDetailPanel id="r1" onChanged={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Setujui' }));
    const dialog = screen.getByRole('dialog', { name: 'Setujui langkah ini?' });
    await user.click(within(dialog).getByRole('button', { name: 'Ya, setujui' }));
    expect(await screen.findByText('Langkah disetujui.')).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/steps/s1/approve'))!;
    expect(call[1]!.headers).toMatchObject({ 'X-Requested-With': 'sfp-web' });
  });

  it('409 (sudah diputuskan orang lain) → dialog tertutup, pesan jelas, status dimuat ulang', async () => {
    let calls = 0;
    const later = { ...base, status: 'PENDING' as const, steps: [{ ...step1, status: 'APPROVED' as const, decidedBy: { id: 'm2', email: 'manager-a2@example.test' }, decidedAt: '2026-10-31T02:00:00Z' }, { ...step2, status: 'ACTIVE' as const }], activeStep: { id: 's2', order: 2, role: 'FINANCE', assignee: null }, permissions: { ...base.permissions, canDecide: false, activeStepId: 's2' } };
    installFetchMock({
      'GET /approval-requests/r1': () => jsonResponse(200, calls++ === 0 ? base : later),
      'GET /approval-requests/r1/audit': () => jsonResponse(200, audit),
      'POST /approval-requests/r1/steps/s1/approve': () => jsonResponse(409, { code: 'STEP_NOT_ACTIVE', message: 'Langkah ini sudah diputuskan' }),
    });
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<RequestDetailPanel id="r1" onChanged={onChanged} />);
    await user.click(await screen.findByRole('button', { name: 'Setujui' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Ya, setujui' }));
    expect(await screen.findByText('Langkah ini sudah diputuskan. Status terbaru sudah dimuat ulang.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByText(/oleh manager-a2@example.test/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Setujui' })).not.toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it('Tolak mewajibkan alasan; Delegasikan memuat calon dari server', async () => {
    const fetchMock = installFetchMock(
      routes({
        'GET /approval-requests/r1/steps/s1/delegates': () => jsonResponse(200, { items: [{ id: 'm2', email: 'manager-a2@example.test' }] }),
        'POST /approval-requests/r1/steps/s1/delegate': () => jsonResponse(200, { ...base, permissions: { ...base.permissions, canDecide: false } }),
      }),
    );
    const user = userEvent.setup();
    render(<RequestDetailPanel id="r1" onChanged={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Tolak' }));
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Ya, tolak' })).toBeDisabled();
    await user.type(screen.getByLabelText('Alasan penolakan'), 'Di luar anggaran');
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Ya, tolak' })).toBeEnabled();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Batal' }));

    await user.click(screen.getByRole('button', { name: 'Delegasikan' }));
    const dialog = screen.getByRole('dialog', { name: 'Delegasikan langkah ini' });
    expect(await within(dialog).findByRole('option', { name: 'manager-a2@example.test' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Delegasikan' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/steps/s1/delegate'))).toBe(true));
    const body = JSON.parse(fetchMock.mock.calls.find(([u]) => String(u).endsWith('/steps/s1/delegate'))![1]!.body as string);
    expect(body).toEqual({ toUserId: 'm2' });
  });
});

describe('form pengajuan baru', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('jalur persetujuan mengikuti konfigurasi: ≤ 10 jt Manager; > 10 jt Manager → Finance; POST body desimal', async () => {
    const fetchMock = installFetchMock({
      'GET /approval-requests/options': () =>
        jsonResponse(200, {
          units: [{ id: 'u', code: 'BR-A', name: 'BR-A', type: 'BRANCH', organizationId: 'o' }],
          workflows: [{ organizationId: 'o', key: 'WF-BUDGET', version: 1, steps: [{ order: 1, role: 'MANAGER', conditionType: 'ALWAYS', conditionAmount: null }, { order: 2, role: 'FINANCE', conditionType: 'AMOUNT_GT', conditionAmount: '10000000' }] }],
        }),
      'POST /approval-requests': () => jsonResponse(201, base),
    });
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<NewRequestDialog onClose={vi.fn()} onCreated={onCreated} />);
    const amount = await screen.findByLabelText('Nominal (Rp)');
    await user.type(amount, '10000000');
    expect(screen.getByText(/perlu persetujuan/)).toHaveTextContent('1. Manager');
    expect(screen.queryByText('2. Finance')).not.toBeInTheDocument();
    await user.type(amount, '1');
    expect(screen.getByText('2. Finance')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Judul'), 'Laptop');
    await user.type(screen.getByLabelText('Alasan pengajuan'), 'Laptop lama rusak');
    await user.click(screen.getByRole('button', { name: 'Simpan draf' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls.find(([u, i]) => String(u).endsWith('/approval-requests') && i?.method === 'POST')![1]!.body as string);
    expect(body).toEqual({ unitId: 'u', title: 'Laptop', amount: '100000001', reason: 'Laptop lama rusak' });
  });
  it('data form gagal dimuat → pesan jelas + "Coba lagi" memuat ulang', async () => {
    let calls = 0;
    installFetchMock({
      'GET /approval-requests/options': () =>
        calls++ === 0
          ? jsonResponse(503, { code: 'NOT_READY', message: 'x' })
          : jsonResponse(200, { units: [{ id: 'u', code: 'BR-A', name: 'BR-A', type: 'BRANCH', organizationId: 'o' }], workflows: [] }),
    });
    const user = userEvent.setup();
    render(<NewRequestDialog onClose={vi.fn()} onCreated={vi.fn()} />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('belum termuat');
    await user.click(within(alert).getByRole('button', { name: 'Coba lagi' }));
    expect(await screen.findByRole('option', { name: 'BR-A' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('request data form menggantung → dibatalkan tepat setelah 10 dtk, pesan + "Coba lagi" berhasil memuat', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let calls = 0;
      const signals: AbortSignal[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn((_: RequestInfo | URL, init?: RequestInit) => {
          signals.push(init!.signal!);
          if (calls++ === 0) {
            // Tidak pernah dijawab server; hanya berakhir bila dibatalkan klien.
            return new Promise<Response>((_, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
          }
          return Promise.resolve(jsonResponse(200, { units: [{ id: 'u', code: 'BR-A', name: 'BR-A', type: 'BRANCH', organizationId: 'o' }], workflows: [] }));
        }),
      );
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<NewRequestDialog onClose={vi.fn()} onCreated={vi.fn()} />);
      expect(screen.getByRole('status')).toHaveTextContent('Memuat data form');
      await vi.advanceTimersByTimeAsync(9_900);
      expect(signals[0].aborted).toBe(false);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      await vi.advanceTimersByTimeAsync(200);
      expect(signals[0].aborted).toBe(true);
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('belum termuat');
      await user.click(within(alert).getByRole('button', { name: 'Coba lagi' }));
      expect(await screen.findByRole('option', { name: 'BR-A' })).toBeInTheDocument();
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('halaman persetujuan per peran', () => {
  afterEach(() => vi.unstubAllGlobals());
  const me = (permissions: string[]) => () => jsonResponse(200, { id: 'u', email: 'x@example.test', grants: [], permissions, sessionExpiresAt: new Date(Date.now() + 3600_000).toISOString() });
  const renderPage = () =>
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/approvals']}>
          <ApprovalsPage />
        </MemoryRouter>
      </AuthProvider>,
    );

  it('Manager: tab default "Perlu tindakan saya", tanpa tombol pengajuan baru', async () => {
    const fetchMock = installFetchMock({ 'GET /auth/me': me(['approval.decide']), 'GET /approval-requests': () => jsonResponse(200, { items: [], total: 0 }) });
    renderPage();
    expect(await screen.findByRole('tab', { name: /Perlu tindakan saya/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('button', { name: '+ Pengajuan baru' })).not.toBeInTheDocument();
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes('view=inbox'))).toBe(true));
  });

  it('Pengaju: hanya "Pengajuan saya" dan tombol pengajuan baru; Admin oversight: "Semua pengajuan" tanpa tombol baru', async () => {
    installFetchMock({ 'GET /auth/me': me(['approval.request.create']), 'GET /approval-requests': () => jsonResponse(200, { items: [], total: 0 }) });
    renderPage();
    expect(await screen.findByRole('button', { name: '+ Pengajuan baru' })).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  it('daftar gagal dimuat → pesan + Coba lagi (bukan daftar kosong); filter status & halaman dikirim ke server', async () => {
    const summary = { ...base, steps: undefined, history: undefined, permissions: undefined };
    let fail = true;
    const fetchMock = installFetchMock({
      'GET /auth/me': me(['approval.oversight']),
      'GET /approval-requests': () => (fail ? jsonResponse(500, { code: 'INTERNAL', message: 'x' }) : jsonResponse(200, { items: [summary], total: 45 })),
    });
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText('Daftar pengajuan gagal dimuat.')).toBeInTheDocument();
    expect(screen.queryByText('Belum ada pengajuan.')).not.toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Coba lagi' }));
    expect(await screen.findByText('Halaman 1 dari 3')).toBeInTheDocument();
    const filters = screen.getByRole('group', { name: 'Filter status' });
    // Kartu filter menampilkan jumlah dari server; tab "Semua" tanpa Draf (draf hanya milik pengaju).
    expect(within(filters).getAllByRole('button').map((b) => b.textContent)).toEqual(['45Semua', '45Menunggu persetujuan', '45Disetujui', '45Ditolak']);
    await user.click(within(filters).getByRole('button', { name: /Disetujui/ }));
    expect(within(filters).getByRole('button', { name: /Disetujui/ })).toHaveAttribute('aria-pressed', 'true');
    await user.click(await screen.findByRole('button', { name: 'Berikutnya' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => /view=all&page=2&pageSize=20&status=APPROVED/.test(String(u)))).toBe(true));
  });
});
