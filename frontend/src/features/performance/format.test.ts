import { describe, expect, it } from 'vitest';
import { formatNumber, periodLabel } from './format';

describe('format performa', () => {
  it('angka HALF_UP dengan koma desimal dan titik ribuan; null → N/A', () => {
    expect(formatNumber('1.5')).toBe('1,50');
    expect(formatNumber('85')).toBe('85,00');
    expect(formatNumber('6857142.857142857')).toBe('6.857.142,86');
    expect(formatNumber('66.665', 2)).toBe('66,67');
    expect(formatNumber(null)).toBe('N/A');
  });
  it('label periode memakai tanggal terakhir inklusif', () => {
    expect(periodLabel({ code: 'PERIOD-SEP', startDate: '2026-09-01', endDateExclusive: '2026-10-01' })).toBe('PERIOD-SEP · 1 Sep 2026 – 30 Sep 2026');
  });
});
