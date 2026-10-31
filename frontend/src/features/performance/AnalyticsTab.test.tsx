import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFetchMock, jsonResponse } from '../../test/fetch-mock';
import { AnalyticsTab } from './AnalyticsTab';

const m = (verifiedRevenue: string, averageHeadcount: string, rpe: string | null, employeeDays = 0) => ({
  verifiedRevenue,
  recordedRevenue: verifiedRevenue,
  employeeDays,
  averageHeadcount,
  rpe,
  canonicalRunIds: [],
});
const unit = (id: string, type: string, parentId: string | null) => ({ id, code: id, name: id, type, parentId });
const hrResponse = {
  period: { id: 'p', code: 'PERIOD-SEP', startDate: '2026-09-01', endDateExclusive: '2026-10-01', days: 30 },
  units: [
    { unit: unit('DIV-1', 'DIVISION', null), own: m('0', '0', null), hasChildren: true, subtotal: m('21000000', '3.5', '6000000', 105), subtotalUnavailableReason: null, benchmark: null, benchmarkUnavailableReason: 'NO_PARENT' },
    { unit: unit('BR-A', 'BRANCH', 'DIV-1'), own: m('15000000', '2', '7500000', 60), hasChildren: true, subtotal: m('15000000', '2', '7500000', 60), subtotalUnavailableReason: null, benchmark: { parentUnitId: 'DIV-1', parentRpe: '6000000', difference: '1500000', index: '1.25' }, benchmarkUnavailableReason: null },
    { unit: unit('BR-B', 'BRANCH', 'DIV-1'), own: m('6000000', '1.5', '4000000', 45), hasChildren: false, subtotal: m('6000000', '1.5', '4000000', 45), subtotalUnavailableReason: null, benchmark: { parentUnitId: 'DIV-1', parentRpe: '6000000', difference: '-2000000', index: '0.6666666666666666666666666666666666666667' }, benchmarkUnavailableReason: null },
    { unit: unit('BR-ZERO', 'BRANCH', 'DIV-1'), own: m('0', '0', null), hasChildren: false, subtotal: m('0', '0', null), subtotalUnavailableReason: null, benchmark: { parentUnitId: 'DIV-1', parentRpe: '6000000', difference: null, index: null }, benchmarkUnavailableReason: null },
  ],
  organizationTotal: null,
  branchSpread: { highest: { unitId: 'BR-A', rpe: '7500000' }, lowest: { unitId: 'BR-B', rpe: '4000000' }, difference: '3500000', branchesWithoutRpe: ['BR-ZERO'] },
};
const perf = {
  period: hrResponse.period,
  bands: [
    { key: 'BELOW_60', label: '< 60' },
    { key: 'FROM_60', label: '60 – < 80' },
    { key: 'FROM_80', label: '80 – < 100' },
    { key: 'FROM_100', label: '≥ 100' },
  ],
  withinScope: { count: 2, bands: { BELOW_60: 0, FROM_60: 0, FROM_80: 1, FROM_100: 1 }, average: '102.5', median: '102.5' },
  units: [],
};

describe('tab analitik', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('HR: total divisi 21 jt / 3,5 → 6 jt; tabel cabang; BR-ZERO N/A; perbandingan dengan induk; distribusi skor', async () => {
    installFetchMock({
      'GET /analytics/revenue-per-employee': () => jsonResponse(200, hrResponse),
      'GET /analytics/performance': () => jsonResponse(200, perf),
    });
    render(<AnalyticsTab periodId="p" canSeeScores />);
    expect(await screen.findByText('Total DIV-1')).toBeInTheDocument();
    expect(screen.getByText('Rp21.000.000,00')).toBeInTheDocument();
    expect(screen.getByText('3,50')).toBeInTheDocument();
    const rows = screen.getAllByRole('row').slice(1).map((r) => r.textContent);
    expect(rows[0]).toContain('Rp7.500.000,00');
    expect(rows[0]).toContain('125% (+Rp1.500.000,00)');
    expect(rows[1]).toContain('67% (−Rp2.000.000,00)');
    expect(rows[2]).toContain('N/A');
    expect(screen.getByRole('listitem', { name: /BR-ZERO: tidak ada karyawan/ })).toBeInTheDocument();
    expect(screen.getByText('DIV-1 Rp6.000.000,00')).toBeInTheDocument(); // label garis acuan
    expect(screen.getByText(/Selisih RPE tertinggi \(BR-A\) dan terendah \(BR-B\): Rp3.500.000,00/)).toBeInTheDocument();
    expect(await screen.findByText(/Distribusi skor review final \(2 karyawan/)).toBeInTheDocument();
    expect(screen.getByText(/Rata-rata 102,50 · median 102,50/)).toBeInTheDocument();
  });

  it('Manager: tanpa divisi dalam akses → kartu menjelaskan benchmark tidak tersedia; kolom induk "Tidak tersedia"', async () => {
    installFetchMock({
      'GET /analytics/revenue-per-employee': () =>
        jsonResponse(200, {
          ...hrResponse,
          units: [{ ...hrResponse.units[1], unit: unit('BR-A', 'BRANCH', null), benchmark: null, benchmarkUnavailableReason: 'PARENT_OUT_OF_SCOPE' }],
          branchSpread: null,
        }),
      'GET /analytics/performance': () => jsonResponse(200, { ...perf, withinScope: { count: 0, bands: { BELOW_60: 0, FROM_60: 0, FROM_80: 0, FROM_100: 0 }, average: null, median: null } }),
    });
    render(<AnalyticsTab periodId="p" canSeeScores />);
    expect(await screen.findByText(/Benchmark divisi tidak tersedia untuk akses Anda/)).toBeInTheDocument();
    expect(screen.queryByText('Rp21.000.000,00')).not.toBeInTheDocument();
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('Tidak tersedia');
    expect(await screen.findByText('Belum ada review yang difinalisasi pada periode ini.')).toBeInTheDocument();
  });

  it('Finance (tanpa izin skor) tidak memanggil analytics/performance', async () => {
    const fetchMock = installFetchMock({ 'GET /analytics/revenue-per-employee': () => jsonResponse(200, hrResponse) });
    render(<AnalyticsTab periodId="p" canSeeScores={false} />);
    expect(await screen.findByText('Total DIV-1')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/analytics/performance'))).toBe(false);
  });
});
