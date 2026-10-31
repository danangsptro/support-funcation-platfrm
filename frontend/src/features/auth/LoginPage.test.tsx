import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFetchMock, jsonResponse } from '../../test/fetch-mock';
import { AuthProvider } from './AuthContext';
import { LoginPage } from './LoginPage';

const profile = { id: 'u1', email: 'manager-a@example.test', grants: [], permissions: [] };

function renderLogin(initialState?: unknown) {
  const router = createMemoryRouter(
    [
      { path: '/login', element: <LoginPage /> },
      { path: '/', element: <p>Halaman beranda</p> },
      { path: '/organization', element: <p>Halaman organisasi</p> },
    ],
    { initialEntries: [{ pathname: '/login', state: initialState }] },
  );
  render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
  return router;
}

async function fillAndSubmit(email: string, password: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Kata sandi'), password);
  await user.click(screen.getByRole('button', { name: 'Masuk' }));
  return user;
}

describe('halaman login', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('label jelas dan fokus awal di email', () => {
    installFetchMock();
    renderLogin();
    expect(screen.getByRole('heading', { name: 'Masuk ke akun Anda' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveFocus();
    expect(screen.getByLabelText('Kata sandi')).toHaveAttribute('autocomplete', 'current-password');
  });

  it('kirim kosong → pesan per field, tidak memanggil login; error hilang saat diperbaiki', async () => {
    const fetchMock = installFetchMock();
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole('button', { name: 'Masuk' }));
    expect(screen.getByText('Email wajib diisi.')).toBeInTheDocument();
    expect(screen.getByText('Kata sandi wajib diisi.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/auth/login'))).toBe(false);
    await user.type(screen.getByLabelText('Email'), 'manager-a@example.test');
    expect(screen.queryByText('Email wajib diisi.')).not.toBeInTheDocument();
  });

  it('tombol Tampilkan/Sembunyikan kata sandi', async () => {
    installFetchMock();
    const user = userEvent.setup();
    renderLogin();
    const input = screen.getByLabelText('Kata sandi');
    expect(input).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: /Tampilkan/ }));
    expect(input).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: /Sembunyikan/ }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('akun demo mengisi email dan memindahkan fokus ke kata sandi', async () => {
    installFetchMock();
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByText('Akun demo untuk presentasi'));
    await user.click(screen.getByRole('button', { name: /Pakai akun Manager Cabang A \(manager-a@example.test\)/ }));
    expect(screen.getByLabelText('Email')).toHaveValue('manager-a@example.test');
    expect(screen.getByLabelText('Kata sandi')).toHaveFocus();
  });

  it('kredensial salah → pesan jelas, kata sandi dikosongkan, fokus ke peringatan', async () => {
    installFetchMock({ 'POST /auth/login': () => jsonResponse(401, { code: 'INVALID_CREDENTIALS', message: 'x' }) });
    renderLogin();
    await fillAndSubmit('manager-a@example.test', 'salah');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Email atau kata sandi salah');
    expect(alert).toHaveFocus();
    expect(screen.getByLabelText('Kata sandi')).toHaveValue('');
  });

  it('terlalu banyak percobaan (429) → pesan dengan lama tunggu', async () => {
    installFetchMock({
      'POST /auth/login': () =>
        jsonResponse(429, { code: 'TOO_MANY_ATTEMPTS', message: 'x', details: { retryAfterSeconds: 600 } }),
    });
    renderLogin();
    await fillAndSubmit('manager-a@example.test', 'apa');
    expect(await screen.findByRole('alert')).toHaveTextContent('coba lagi dalam 10 menit');
  });

  it('server tidak terjangkau → pesan koneksi', async () => {
    installFetchMock({
      'POST /auth/login': () => {
        throw new TypeError('Failed to fetch');
      },
    });
    renderLogin();
    await fillAndSubmit('manager-a@example.test', 'apa');
    expect(await screen.findByRole('alert')).toHaveTextContent('Tidak dapat terhubung ke server');
  });

  it('berhasil → status memproses, header CSRF dikirim, token TIDAK disimpan di JS, kembali ke halaman asal', async () => {
    let resolve!: (r: Response) => void;
    const fetchMock = installFetchMock({ 'POST /auth/login': () => new Promise<Response>((r) => (resolve = r)) });
    const router = renderLogin({ from: '/organization' });
    await fillAndSubmit('manager-a@example.test', 'benar');
    expect(screen.getByRole('button', { name: 'Sedang masuk…' })).toBeDisabled();
    resolve(
      jsonResponse(200, {
        accessToken: 'token-rahasia',
        tokenType: 'Bearer',
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        user: profile,
      }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/organization'));
    const [, init] = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/auth/login'))!;
    expect(JSON.parse(init!.body as string)).toEqual({ email: 'manager-a@example.test', password: 'benar' });
    expect(init!.headers).toMatchObject({ 'X-Requested-With': 'sfp-web' });
    expect(init!.credentials).toBe('same-origin');
    const stored = JSON.stringify({ ...sessionStorage }) + JSON.stringify({ ...localStorage });
    expect(stored).not.toContain('token-rahasia');
  });

  it('pernah login di tab ini tetapi cookie sudah tidak sah → pesan sesi berakhir', async () => {
    sessionStorage.setItem('sfp.hadSession', '1');
    installFetchMock();
    renderLogin();
    expect(await screen.findByRole('status')).toHaveTextContent('Sesi Anda telah berakhir');
  });
});
