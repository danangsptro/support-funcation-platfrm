import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFetchMock, jsonResponse } from '../../test/fetch-mock';
import { ReviewPanel } from './ReviewPanel';
import type { Review } from './types';

const base: Review = {
  id: 'r1',
  status: 'DRAFT',
  employee: { id: 'e1', code: 'EMP-1', name: 'Karyawan Demo 1' },
  unit: { id: 'u', code: 'BR-A', name: 'BR-A' },
  period: { id: 'p', code: 'PERIOD-SEP', startDate: '2026-09-01', endDateExclusive: '2026-10-01', days: 30 },
  formulaVersion: 'kpi-v1',
  isSnapshot: false,
  items: [
    { kpiId: 'k1', name: 'Revenue cabang', source: 'VERIFIED_UNIT_REVENUE', unit: { id: 'u', code: 'BR-A', name: 'BR-A' }, weight: '60', target: '20000000', actual: '15000000', achievement: '75', cappedAchievement: '75', weightedScore: '45' },
    { kpiId: 'k2', name: 'Pekerjaan selesai', source: 'MANUAL', unit: null, weight: '40', target: '10', actual: '10', achievement: '100', cappedAchievement: '100', weightedScore: '40' },
  ],
  weightTotal: '100',
  totalScore: '85',
  problems: [],
  canFinalize: true,
  finalizedAt: null,
  provenance: null,
};

describe('panel review', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('HR draf: skor sementara 85, KPI revenue tidak bisa diisi manual, finalisasi butuh konfirmasi', async () => {
    const final: Review = { ...base, status: 'FINALIZED', isSnapshot: true, canFinalize: false, finalizedAt: '2026-10-31T05:00:00Z', provenance: { revenueSources: [{ kpiId: 'k1', unitCode: 'BR-A', verifiedRevenue: '15000000', ruleVersions: ['v1'] }] } };
    const fetchMock = installFetchMock({
      'POST /reviews/calculate': () => jsonResponse(200, base),
      'POST /reviews/r1/finalize': () => jsonResponse(200, final),
    });
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<ReviewPanel periodId="p" employeeId="e1" reviewId={null} canManage onChanged={onChanged} />);
    expect(await screen.findByText('Skor sementara')).toBeInTheDocument();
    expect(screen.getByText('85,00')).toBeInTheDocument();
    expect(screen.queryByLabelText('Actual Revenue cabang')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Actual Pekerjaan selesai')).toHaveValue('10');
    expect(screen.getByText('Otomatis: revenue terverifikasi BR-A')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Finalisasi review' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Konfirmasi finalisasi' });
    expect(dialog).toHaveTextContent('Finalisasi bersifat permanen');
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/finalize'))).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'Ya, finalisasi' }));
    expect(await screen.findByText('Skor final')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('snapshot');
    expect(screen.getByText(/Revenue BR-A: Rp15.000.000,00 dari pencocokan v1/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Finalisasi review' })).not.toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it('bobot belum 100% → masalah dijelaskan, tombol finalisasi nonaktif; ubah bobot mengirim PATCH', async () => {
    const draft: Review = { ...base, weightTotal: '90', canFinalize: false, problems: ['WEIGHT_TOTAL_NOT_100'], items: [base.items[0], { ...base.items[1], weight: '30', weightedScore: '30' }] };
    const fetchMock = installFetchMock({
      'POST /reviews/calculate': () => jsonResponse(200, draft),
      'PATCH /kpi-assignments/k2': () => jsonResponse(200, { kpiId: 'k2', review: base }),
    });
    const user = userEvent.setup();
    render(<ReviewPanel periodId="p" employeeId="e1" reviewId={null} canManage onChanged={vi.fn()} />);
    expect(await screen.findByText('Total bobot harus tepat 100% (sekarang 90,00%).')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finalisasi review' })).toBeDisabled();
    const weight = screen.getByLabelText('Bobot Pekerjaan selesai');
    await user.clear(weight);
    await user.type(weight, '40');
    await user.click(screen.getAllByRole('button', { name: 'Simpan' })[1]);
    const body = JSON.parse(fetchMock.mock.calls.find(([u]) => String(u).endsWith('/kpi-assignments/k2'))![1]!.body as string);
    expect(body).toEqual({ weight: '40', target: '10', actual: '10' });
    expect(await screen.findByRole('button', { name: 'Finalisasi review' })).toBeEnabled();
  });

  it('pembaca tanpa review.manage: hanya baca (GET /reviews/:id), tanpa input', async () => {
    const fetchMock = installFetchMock({ 'GET /reviews/r1': () => jsonResponse(200, base) });
    render(<ReviewPanel periodId="p" employeeId="e1" reviewId="r1" canManage={false} onChanged={vi.fn()} />);
    expect(await screen.findByText('85,00')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Finalisasi review' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/reviews/calculate'))).toBe(false);
  });
});
