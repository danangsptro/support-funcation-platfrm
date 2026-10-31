import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFetchMock, jsonResponse } from '../../test/fetch-mock';
import { AuthProvider } from '../auth/AuthContext';
import { OrganizationPage } from './OrganizationPage';

const units = {
  items: [
    { id: 'u-bra', code: 'BR-A', name: 'BR-A', type: 'BRANCH', organization: { name: 'Demo Nusantara' } },
    { id: 'u-cca', code: 'CC-A', name: 'CC-A', type: 'COST_CENTER', organization: { name: 'Demo Nusantara' } },
  ],
  total: 2,
};
const routes = (permissions: string[], patch?: (init?: RequestInit) => Response) => ({
  'GET /auth/me': () =>
    jsonResponse(200, { id: 'u', email: 'x@example.test', grants: [], permissions, sessionExpiresAt: new Date(Date.now() + 3600_000).toISOString() }),
  'GET /org-units': () => jsonResponse(200, units),
  'GET /employees': () => jsonResponse(200, { items: [], total: 0 }),
  'GET /employees/summary': () => jsonResponse(200, { asOf: '2026-10-31', total: 0, byUnit: [] }),
  ...(patch ? { 'PATCH /org-units/u-bra': patch } : {}),
});

function renderPage() {
  render(
    <AuthProvider>
      <MemoryRouter>
        <OrganizationPage />
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('halaman Organisasi — ubah nama unit', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('pengguna tanpa org.manage tidak melihat tombol Ubah nama', async () => {
    installFetchMock(routes(['org.read', 'employee.read']));
    renderPage();
    expect(await screen.findByText('Unit kerja (2)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ubah nama/ })).not.toBeInTheDocument();
  });

  it('admin: dialog menampilkan konteks unit & nama saat ini; simpan mengirim PATCH ber-CSRF; tabel & notifikasi diperbarui', async () => {
    const patch = vi.fn((init?: RequestInit) => jsonResponse(200, { name: JSON.parse(init!.body as string).name }));
    installFetchMock(routes(['org.read', 'employee.read', 'org.manage'], patch));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Ubah nama unit BR-A' }));
    const dialog = screen.getByRole('dialog', { name: 'Ubah nama unit' });
    expect(dialog).toHaveAccessibleDescription('BR-A · Cabang · Demo Nusantara');
    expect(within(dialog).getByText('Nama saat ini').nextSibling).toHaveTextContent('BR-A');
    const input = within(dialog).getByLabelText('Nama baru');
    expect(input).toHaveFocus();
    await user.clear(input);
    await user.type(input, 'Cabang Jakarta');
    expect(within(dialog).getByText('14/120')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Simpan perubahan' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Nama unit BR-A diubah menjadi “Cabang Jakarta”');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Cabang Jakarta/ })).toBeInTheDocument();
    expect(patch.mock.calls[0][0]!.headers).toMatchObject({ 'X-Requested-With': 'sfp-web' });
    await user.click(screen.getByRole('button', { name: 'Tutup pemberitahuan' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('tombol Simpan nonaktif selama nama belum berubah/kosong; Esc menutup dan fokus kembali ke tombol pemicu', async () => {
    const patch = vi.fn(() => jsonResponse(200, { name: 'x' }));
    installFetchMock(routes(['org.read', 'employee.read', 'org.manage'], patch));
    const user = userEvent.setup();
    renderPage();
    const trigger = await screen.findByRole('button', { name: 'Ubah nama unit BR-A' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Simpan perubahan' })).toBeDisabled();
    await user.clear(within(dialog).getByLabelText('Nama baru'));
    expect(within(dialog).getByRole('button', { name: 'Simpan perubahan' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(patch).not.toHaveBeenCalled();
  });

  it('403 dari server dijelaskan di dalam dialog; dialog tetap terbuka dengan isian pengguna; Batal menutup', async () => {
    installFetchMock(routes(['org.read', 'employee.read', 'org.manage'], () => jsonResponse(403, { code: 'FORBIDDEN', message: 'x' })));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Ubah nama unit BR-A' }));
    const dialog = screen.getByRole('dialog');
    const input = within(dialog).getByLabelText('Nama baru');
    await user.clear(input);
    await user.type(input, 'Baru');
    await user.click(within(dialog).getByRole('button', { name: 'Simpan perubahan' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('tidak memiliki izin');
    expect(input).toHaveValue('Baru');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText(/diubah menjadi/)).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Batal' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('unit disusun sebagai pohon (induk di luar cakupan = akar); penempatan aktif ditandai', async () => {
    installFetchMock({
      ...routes(['org.read', 'employee.read']),
      'GET /org-units': () =>
        jsonResponse(200, {
          items: [
            { id: 'u-cca', code: 'CC-A', name: 'CC-A', type: 'COST_CENTER', parentId: 'u-bra', organization: { name: 'Demo Nusantara' } },
            { id: 'u-brb', code: 'BR-B', name: 'BR-B', type: 'BRANCH', parentId: 'u-div', organization: { name: 'Demo Nusantara' } },
            { id: 'u-bra', code: 'BR-A', name: 'BR-A', type: 'BRANCH', parentId: 'u-div', organization: { name: 'Demo Nusantara' } },
          ],
          total: 3,
        }),
      'GET /employees': () =>
        jsonResponse(200, {
          items: [{ id: 'e3', code: 'EMP-3', name: 'Karyawan Demo 3', assignments: [{ unitCode: 'BR-A', startDate: '2026-09-01', endDateExclusive: '2026-09-16' }, { unitCode: 'BR-B', startDate: '2026-09-16', endDateExclusive: null }] }],
          total: 1,
        }),
      'GET /employees/summary': () => jsonResponse(200, { asOf: '2026-10-31', total: 1, byUnit: [{ unitId: 'u-brb', count: 1 }] }),
    });
    renderPage();
    expect(await screen.findByText('Unit kerja (3)')).toBeInTheDocument();
    const codes = screen.getAllByRole('row').slice(1, 4).map((r) => within(r).getAllByRole('cell')[0].textContent);
    expect(codes).toEqual(['BR-A', '└CC-A', 'BR-B']);
    const history = screen.getByRole('list', { name: 'Riwayat penempatan Karyawan Demo 3' });
    const [past, current] = within(history).getAllByRole('listitem');
    expect(past).not.toHaveTextContent('Aktif');
    expect(current).toHaveTextContent(/BR-B.*sekarang.*Aktif/);
  });
});
