import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFetchMock, jsonResponse } from '../../test/fetch-mock';
import type { Dataset } from './types';
import { UploadCard } from './UploadCard';

const dataset: Dataset = {
  id: 'd1',
  unit: { id: 'u-bra', code: 'BR-A', name: 'BR-A' },
  organization: { id: 'o', code: 'ORG-1', name: 'x' },
  accountId: 'ACC-1',
  side: 'INTERNAL',
  rowCount: 7,
  sourceFilename: 'ORG-1-BR-A-internal.csv',
  createdAt: '2026-10-31T00:00:00Z',
};
const csv = (name = 'ORG-1-BR-A-internal.csv') => new File(['x'], name, { type: 'text/csv' });

function Harness({ existing = [] as Dataset[], onChange = vi.fn() }) {
  const [value, setValue] = useState<Dataset | null>(null);
  return (
    <UploadCard
      side="INTERNAL"
      unitId="u-bra"
      accountId="ACC-1"
      existing={existing}
      value={value}
      onChange={(d) => {
        setValue(d);
        onChange(d);
      }}
    />
  );
}

describe('kartu unggah satu sisi', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('memilih file langsung mengunggah sebagai multipart dengan sisi tetap; sukses → "7 transaksi siap"', async () => {
    const fetchMock = installFetchMock({ 'POST /datasets/import': () => jsonResponse(201, { created: true, dataset }) });
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.setup().upload(screen.getByLabelText('Unggah file Catatan internal'), csv());
    expect(await screen.findByText('7 transaksi siap')).toBeInTheDocument();
    const body = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/datasets/import'))![1]!.body as FormData;
    expect([body.get('unitId'), body.get('accountId'), body.get('side')]).toEqual(['u-bra', 'ACC-1', 'INTERNAL']);
    expect(onChange).toHaveBeenCalledWith(dataset);
  });

  it('file yang sama diunggah ulang → dijelaskan tidak ada data ganda', async () => {
    installFetchMock({ 'POST /datasets/import': () => jsonResponse(200, { created: false, dataset }) });
    render(<Harness />);
    await userEvent.setup().upload(screen.getByLabelText('Unggah file Catatan internal'), csv());
    expect(await screen.findByText(/sudah pernah diunggah — data yang sama dipakai/)).toBeInTheDocument();
  });

  it('baris salah → daftar per baris, tegas tidak ada yang disimpan', async () => {
    installFetchMock({
      'POST /datasets/import': () =>
        jsonResponse(400, {
          code: 'IMPORT_REJECTED',
          message: 'x',
          details: { totalErrors: 1, errors: [{ line: 2, transactionId: 'BAD-3', code: 'INVALID_DATE', message: 'Tanggal harus tanggal kalender valid berformat YYYY-MM-DD' }] },
        }),
    });
    render(<Harness />);
    await userEvent.setup().upload(screen.getByLabelText('Unggah file Catatan internal'), csv());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('File ditolak: 1 baris perlu diperbaiki. Tidak ada data yang disimpan.');
    expect(alert).toHaveTextContent('Baris 2 (BAD-3)');
  });

  it('bukan .csv ditolak di browser tanpa memanggil API; 413 dijelaskan', async () => {
    const fetchMock = installFetchMock({ 'POST /datasets/import': () => jsonResponse(413, { code: 'PAYLOAD_TOO_LARGE', message: 'x' }) });
    render(<Harness />);
    const user = userEvent.setup({ applyAccept: false });
    await user.upload(screen.getByLabelText('Unggah file Catatan internal'), csv('laporan.xlsx'));
    expect(screen.getByRole('alert')).toHaveTextContent('Hanya file .csv');
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/datasets/import'))).toBe(false);
    await user.upload(screen.getByLabelText('Unggah file Catatan internal'), csv());
    expect(await screen.findByRole('alert')).toHaveTextContent('melebihi 1 MB');
  });

  it('bisa memakai data yang sudah diunggah tanpa upload ulang, lalu "Ganti data"', async () => {
    const fetchMock = installFetchMock();
    const user = userEvent.setup();
    render(<Harness existing={[dataset]} />);
    await user.selectOptions(screen.getByLabelText('Atau pakai data yang sudah diunggah'), 'd1');
    expect(screen.getByText('7 transaksi siap')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/datasets/import'))).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Ganti data' }));
    expect(screen.getByText('Tarik file CSV ke sini')).toBeInTheDocument();
  });
});
