import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RunHistory } from './RunHistory';
import type { Run } from './types';

const run = (id: string, code: string): Run => ({
  id,
  ruleVersion: 'v1',
  dateToleranceDays: 1,
  unit: { id: code, code, name: code },
  accountId: 'ACC-1',
  internalDatasetId: 'i',
  externalDatasetId: 'e',
  groups: 7,
  isCanonical: true,
  createdAt: '2026-10-31T05:00:00Z',
});
const runs = [run('b1', 'BR-B'), run('a1', 'BR-A'), run('a2', 'BR-A')];
const units = [
  { id: 'u-a', code: 'BR-A', count: 111 },
  { id: 'u-b', code: 'BR-B', count: 1 },
];
const props = { runs, total: 112, page: 1, pageSize: 10, allTotal: 112, units, unitId: null, loading: false, selectedId: 'b1', onUnit: vi.fn(), onPage: vi.fn(), onSelect: vi.fn() };

describe('riwayat pencocokan', () => {
  it('chip cabang memakai jumlah dari server; memilih chip meminta filter unitId; paginasi meminta halaman', async () => {
    const onUnit = vi.fn();
    const onPage = vi.fn();
    const user = userEvent.setup();
    render(<RunHistory {...props} onUnit={onUnit} onPage={onPage} />);
    const chips = screen.getByRole('group', { name: 'Filter cabang' });
    expect(within(chips).getAllByRole('button').map((b) => b.textContent)).toEqual(['Semua112', 'BR-A111', 'BR-B1']);
    await user.click(within(chips).getByRole('button', { name: /^BR-B/ }));
    expect(onUnit).toHaveBeenCalledWith('u-b');
    expect(screen.getByText('Halaman 1 dari 12')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Berikutnya' }));
    expect(onPage).toHaveBeenCalledWith(2);
  });

  it('run terpilih bertanda "Sedang ditampilkan"; baris lain bisa dipilih lewat tombol atau klik baris', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<RunHistory {...props} onSelect={onSelect} />);
    const current = screen.getByRole('button', { name: /^Lihat hasil BR-B/ });
    expect(current).toHaveTextContent('Sedang ditampilkan');
    expect(current).toHaveAttribute('aria-current', 'true');
    await user.click(current);
    expect(onSelect).not.toHaveBeenCalled();
    const [first] = screen.getAllByRole('button', { name: /^Lihat hasil BR-A/ });
    await user.click(first);
    expect(onSelect).toHaveBeenCalledWith(runs[1]);
    await user.click(screen.getAllByRole('row')[3]);
    expect(onSelect).toHaveBeenLastCalledWith(runs[2]);
  });
});
