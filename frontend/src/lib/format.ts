import Decimal from 'decimal.js';

/** Pembulatan tampilan: HALF_UP 2 desimal. Nilai API (string desimal) tidak pernah melewati float. */
export function toDisplayDecimal(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

/** Format Rupiah id-ID, mis. "7500000" → "Rp7.500.000,00"; null → "N/A". */
export function formatRupiah(value: string | null | undefined): string {
  const fixed = toDisplayDecimal(value);
  if (fixed === null) return 'N/A';
  const negative = fixed.startsWith('-');
  const [intPart, frac] = fixed.replace('-', '').split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}Rp${grouped},${frac}`;
}

/** Persentase dengan koma desimal, mis. "28.5714" → "28,57%". */
export function formatPercent(value: string | null | undefined): string {
  const fixed = toDisplayDecimal(value);
  return fixed === null ? 'N/A' : `${fixed.replace('.', ',')}%`;
}
