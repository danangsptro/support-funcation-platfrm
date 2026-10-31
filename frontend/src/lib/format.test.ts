import { describe, expect, it } from 'vitest';
import { formatPercent, formatRupiah, toDisplayDecimal } from './format';

describe('format tampilan', () => {
  it('HALF_UP 2 desimal tanpa float', () => {
    expect(toDisplayDecimal('28.571428571428571428')).toBe('28.57');
    expect(toDisplayDecimal('0.005')).toBe('0.01');
    expect(toDisplayDecimal('1.005')).toBe('1.01'); // float biasa menghasilkan 1.00
    expect(toDisplayDecimal(null)).toBeNull();
  });

  it('Rupiah dan N/A', () => {
    expect(formatRupiah('7500000')).toBe('Rp7.500.000,00');
    expect(formatRupiah('100000.5')).toBe('Rp100.000,50');
    expect(formatRupiah(null)).toBe('N/A');
  });

  it('persen', () => {
    expect(formatPercent('28.5714')).toBe('28,57%');
  });
});
