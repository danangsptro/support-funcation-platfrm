import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFetchMock, jsonResponse } from '../../test/fetch-mock';
import { RunDetail } from './RunDetail';
import type { Run } from './types';

const run: Run = {
  id: 'r1',
  ruleVersion: 'v1',
  dateToleranceDays: 1,
  unit: { id: 'u', code: 'BR-A', name: 'BR-A' },
  accountId: 'ACC-1',
  internalDatasetId: 'i',
  externalDatasetId: 'e',
  groups: 7,
  isCanonical: true,
  createdAt: '2026-10-31T00:00:00Z',
};
const summary = {
  runId: 'r1',
  ruleVersion: 'v1',
  groups: 7,
  counts: { MATCHED: 2, MISMATCHED: 3, MISSING_IN_INTERNAL: 1, MISSING_IN_EXTERNAL: 1 },
  byReason: { AMOUNT_DIFFERENCE: 1, DATE_OUTSIDE_TOLERANCE: 1, DUPLICATE_REFERENCE: 1, NO_INTERNAL: 1, NO_EXTERNAL: 1 },
  matchedRatioPercentDisplay: '28.57',
  verifiedRevenue: '15000000',
  anomalousInternalTotal: '7900000',
  anomalousExternalTotal: '6400000',
  uniquePairAmountDifferenceTotal: '100000',
  isCanonical: true,
};
const dup = {
  id: 'g7',
  reference: 'REF-007',
  status: 'MISMATCHED',
  statusLabel: 'Mismatched',
  reason: 'DUPLICATE_REFERENCE',
  internal: [
    { id: 'a', transactionId: 'I6', transactionDate: '2026-09-10', amount: '700000' },
    { id: 'b', transactionId: 'I7', transactionDate: '2026-09-10', amount: '700000' },
  ],
  external: [{ id: 'c', transactionId: 'E6', transactionDate: '2026-09-10', amount: '700000' }],
  amountDifference: null,
};
const routes = (extra = {}) => ({
  'GET /reconciliation-runs/r1/summary': () => jsonResponse(200, summary),
  'GET /reconciliation-runs/r1/results': () => jsonResponse(200, { items: [dup], page: 1, pageSize: 20, total: 1 }),
  ...extra,
});

describe('hasil pencocokan', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('angka utama dalam Rupiah & persen; anomali terpisah dengan catatan tidak dijumlahkan', async () => {
    installFetchMock(routes());
    render(<RunDetail run={run} canReadResults />);
    expect(await screen.findByText('28,57%')).toBeInTheDocument();
    expect(screen.getByText('2 dari 7 grup referensi cocok')).toBeInTheDocument();
    expect(screen.getByText('Rp15.000.000,00')).toBeInTheDocument();
    expect(screen.getByText('5 grup')).toBeInTheDocument();
    for (const v of ['Rp7.900.000,00', 'Rp6.400.000,00', 'Rp100.000,00']) expect(screen.getByText(v)).toBeInTheDocument();
    expect(screen.getByText(/tidak dijumlahkan sebagai kerugian/)).toBeInTheDocument();
    expect(screen.getByText('Dipakai untuk laporan revenue')).toBeInTheDocument();
    expect(screen.getByText(/Toleransi Standar \(±1 hari\)/)).toBeInTheDocument();
  });

  it('daftar tindak lanjut: tiap jenis anomali punya penjelasan dan saran tindakan', async () => {
    installFetchMock(routes());
    render(<RunDetail run={run} canReadResults />);
    expect(await screen.findByRole('heading', { name: 'Yang perlu ditindaklanjuti' })).toBeInTheDocument();
    expect(screen.getByText('Ada di catatan internal, tidak ada di mutasi')).toBeInTheDocument();
    expect(screen.getByText(/Pastikan dana benar-benar diterima/)).toBeInTheDocument();
    expect(screen.getByText('Nomor referensi ganda')).toBeInTheDocument();
    expect(screen.getByText(/Sistem tidak menebak pasangannya/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Tampilkan \d+ transaksi/ })).toHaveLength(5);
  });

  it('"Tampilkan N transaksi" memfilter tabel berdasarkan alasan, menggulir ke tabel; chip filter bisa dihapus', async () => {
    const fetchMock = installFetchMock(routes());
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const user = userEvent.setup();
    render(<RunDetail run={run} canReadResults />);
    const [, , , , duplicateButton] = await screen.findAllByRole('button', { name: /^Tampilkan \d+ transaksi/ });
    await user.click(duplicateButton);
    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes('reason=DUPLICATE_REFERENCE'))).toBe(true));
    expect(screen.getByRole('button', { name: /Ditampilkan di tabel/ })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: /Referensi ganda — tinjau manual ✕/ }));
    expect(screen.getByRole('button', { name: 'Semua (7)' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('filter status meminta parameter status', async () => {
    const fetchMock = installFetchMock(routes());
    const user = userEvent.setup();
    render(<RunDetail run={run} canReadResults />);
    await user.click(await screen.findByRole('button', { name: 'Mismatched (3)' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes('&status=MISMATCHED'))).toBe(true));
  });

  it('Manager (tanpa reconciliation.read): ringkasan & panduan tanpa tombol rincian, tidak memanggil /results', async () => {
    const fetchMock = installFetchMock({ 'GET /reconciliation-runs/r1/summary': () => jsonResponse(200, { ...summary, isCanonical: false }) });
    render(<RunDetail run={run} canReadResults={false} />);
    expect(await screen.findByText('Digantikan pencocokan yang lebih baru')).toBeInTheDocument();
    expect(screen.getByText('Yang perlu ditindaklanjuti')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Tampilkan \d+ transaksi/ })).not.toBeInTheDocument();
    expect(screen.getByText(/hanya tersedia untuk tim Finance dan Admin/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/results'))).toBe(false);
  });
});
