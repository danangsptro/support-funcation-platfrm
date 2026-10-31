import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFetchMock, jsonResponse } from '../../test/fetch-mock';
import { NewReconciliation } from './NewReconciliation';
import type { Dataset } from './types';

const units = [
  { id: 'u-bra', code: 'BR-A', name: 'BR-A', organization: { code: 'ORG-1' } },
  { id: 'u-brb', code: 'BR-B', name: 'BR-B', organization: { code: 'ORG-1' } },
];
const ds = (id: string, side: Dataset['side'], unit = units[0]): Dataset => ({
  id,
  unit: { id: unit.id, code: unit.code, name: unit.name },
  organization: { id: 'o', code: 'ORG-1', name: 'x' },
  accountId: 'ACC-1',
  side,
  rowCount: side === 'INTERNAL' ? 7 : 6,
  sourceFilename: `${id}.csv`,
  createdAt: '2026-10-31T00:00:00Z',
});
const datasets = [ds('int-a', 'INTERNAL'), ds('ext-a', 'EXTERNAL'), ds('int-b', 'INTERNAL', units[1])];

describe('rekonsiliasi baru (3 langkah)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('tombol Cocokkan nonaktif sampai kedua data siap; hanya data milik cabang & akun terpilih yang ditawarkan', async () => {
    installFetchMock();
    const user = userEvent.setup();
    render(<NewReconciliation units={units} datasets={datasets} onDatasetsChanged={vi.fn()} onRunReady={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Cocokkan sekarang' })).toBeDisabled();
    expect(screen.getByText('Siapkan kedua data di langkah 2 terlebih dulu.')).toBeInTheDocument();
    const [internalSelect] = screen.getAllByLabelText('Atau pakai data yang sudah diunggah');
    expect([...internalSelect.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Pilih data…', expect.stringContaining('int-a.csv')]);
    await user.selectOptions(internalSelect, 'int-a');
    expect(screen.getByRole('button', { name: 'Cocokkan sekarang' })).toBeDisabled();
  });

  it('toleransi Standar disarankan; memilih Longgar mengirim v2; hasil diteruskan ke halaman', async () => {
    const run = { id: 'r1' };
    const fetchMock = installFetchMock({ 'POST /reconciliation-runs': () => jsonResponse(201, { created: true, run }) });
    const onRunReady = vi.fn();
    const user = userEvent.setup();
    render(<NewReconciliation units={units} datasets={datasets} onDatasetsChanged={vi.fn()} onRunReady={onRunReady} />);
    const [internalSelect, externalSelect] = screen.getAllByLabelText('Atau pakai data yang sudah diunggah');
    await user.selectOptions(internalSelect, 'int-a');
    await user.selectOptions(externalSelect, 'ext-a');
    expect(screen.getByRole('radio', { name: /Standar/ })).toBeChecked();
    expect(screen.getByText('Disarankan')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Longgar/ }));
    await user.click(screen.getByRole('button', { name: 'Cocokkan sekarang' }));
    const init = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/reconciliation-runs'))![1]!;
    expect(JSON.parse(init.body as string)).toEqual({ internalDatasetId: 'int-a', externalDatasetId: 'ext-a', ruleVersion: 'v2' });
    expect(onRunReady).toHaveBeenCalledWith(run, true);
  });

  it('ganti cabang → pilihan data direset; overlap 409 dijelaskan tanpa istilah teknis', async () => {
    installFetchMock({ 'POST /reconciliation-runs': () => jsonResponse(409, { code: 'CANONICAL_OVERLAP', message: 'x' }) });
    const user = userEvent.setup();
    render(<NewReconciliation units={units} datasets={datasets} onDatasetsChanged={vi.fn()} onRunReady={vi.fn()} />);
    const [i1, e1] = screen.getAllByLabelText('Atau pakai data yang sudah diunggah');
    await user.selectOptions(i1, 'int-a');
    await user.selectOptions(e1, 'ext-a');
    await user.click(screen.getByRole('button', { name: 'Cocokkan sekarang' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('agar revenue tidak terhitung dua kali');
    await user.selectOptions(screen.getByLabelText('Cabang / unit'), 'u-brb');
    expect(screen.queryByText('7 transaksi siap')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cocokkan sekarang' })).toBeDisabled();
  });
});
