import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../features/auth/AuthContext';
import { installFetchMock, jsonResponse } from '../test/fetch-mock';
import { HomePage } from './HomePage';

const grant = { role: 'FINANCE', includeDescendants: true, organization: { id: 'o', code: 'ORG-1', name: 'Demo Nusantara' }, unit: { id: 'u', code: 'DIV-1', name: 'DIV-1', type: 'DIVISION' } };
const me = (permissions: string[], grants: unknown[] = [grant]) => () => jsonResponse(200, { id: 'u', email: 'finance@example.test', grants, permissions });
const run = { id: 'r1', ruleVersion: 'v1', unit: { id: 'u', code: 'BR-A', name: 'BR-A' }, accountId: 'ACC-1', isCanonical: true, groups: 7, createdAt: '2026-10-31T05:10:00Z' };
const summary = { groups: 7, counts: { MATCHED: 2, MISMATCHED: 3, MISSING_IN_INTERNAL: 1, MISSING_IN_EXTERNAL: 1 }, matchedRatioPercentDisplay: '28.57', verifiedRevenue: '15000000' };

function renderHome() {
  render(
    <AuthProvider>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('beranda', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('Finance: sapaan dengan nama, peran, rekonsiliasi terakhir dengan angka nyata, kartu tindakan sesuai izin', async () => {
    installFetchMock({
      'GET /auth/me': me(['dataset.import', 'reconciliation.summary.read', 'analytics.rpe.read', 'approval.decide', 'org.read']),
      'GET /reconciliation-runs': () => jsonResponse(200, { items: [run], total: 1 }),
      'GET /reconciliation-runs/r1/summary': () => jsonResponse(200, summary),
    });
    renderHome();
    expect(await screen.findByRole('heading', { level: 1, name: /^Selamat (pagi|siang|sore|malam), Finance$/ })).toBeInTheDocument();
    expect(await screen.findByText('28,57%')).toBeInTheDocument();
    expect(screen.getByText('Rp15.000.000,00')).toBeInTheDocument();
    expect(screen.getByText('5 grup')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Lihat detail/ })).toHaveAttribute('href', '/reconciliation?tab=hasil&run=r1');
    const actions = screen.getByRole('region', { name: 'Apa yang bisa Anda lakukan' });
    const cards = within(actions).getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(cards).toEqual(['/reconciliation', '/reconciliation?tab=hasil', '/performance', '/organization', '/approvals?tab=inbox']);
    expect(screen.queryAllByText('Segera')).toHaveLength(0);
    expect(screen.getByText('Divisi DIV-1 dan unit di bawahnya · Demo Nusantara')).toBeInTheDocument();
  });

  it('belum ada hasil rekonsiliasi → keadaan kosong yang jelas', async () => {
    installFetchMock({
      'GET /auth/me': me(['reconciliation.summary.read']),
      'GET /reconciliation-runs': () => jsonResponse(200, { items: [], total: 0 }),
    });
    renderHome();
    expect(await screen.findByText('Belum ada hasil pencocokan dalam cakupan Anda.')).toBeInTheDocument();
  });

  it('akun tanpa izin: tanpa kartu tindakan dan tanpa ringkasan, ada penjelasan cara meminta akses', async () => {
    const fetchMock = installFetchMock({ 'GET /auth/me': me([], []) });
    renderHome();
    expect(await screen.findByText(/belum memiliki peran/)).toBeInTheDocument();
    expect(screen.queryByText('Apa yang bisa Anda lakukan')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/reconciliation-runs'))).toBe(false);
  });
});
