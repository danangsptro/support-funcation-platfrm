import { toDisplayDecimal } from '../../lib/format';

/** Angka biasa dengan koma desimal, mis. "1.5" → "1,50"; null → "N/A". */
export function formatNumber(value: string | null | undefined, decimals = 2): string {
  const fixed = toDisplayDecimal(value);
  if (fixed === null) return 'N/A';
  const [i, f] = new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: false })
    .format(Number(fixed))
    .split('.');
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${f ? `,${f}` : ''}`;
}

export function periodLabel(p: { code: string; startDate: string; endDateExclusive: string }): string {
  const fmt = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const last = new Date(Date.parse(`${p.endDateExclusive}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return `${p.code} · ${fmt(p.startDate)} – ${fmt(last)}`;
}

export const PROBLEM_TEXT: Record<string, (weightTotal: string) => string> = {
  NO_KPI: () => 'Tambahkan minimal satu KPI.',
  WEIGHT_TOTAL_NOT_100: (w) => `Total bobot harus tepat 100% (sekarang ${formatNumber(w)}%).`,
  MISSING_ACTUAL: () => 'Isi nilai actual untuk semua KPI manual.',
};

export const STATUS_TEXT = {
  NOT_STARTED: { label: 'Belum dimulai', style: 'bg-slate-100 text-slate-700 ring-slate-200' },
  DRAFT: { label: 'Draf', style: 'bg-amber-50 text-amber-900 ring-amber-200' },
  FINALIZED: { label: 'Final', style: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
} as const;
