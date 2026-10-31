import { useId } from 'react';

export interface Bar {
  key: string;
  label: string;
  /** null = tidak ada nilai (mis. RPE N/A); tampil sebagai teks, tanpa batang. */
  value: number | null;
  display: string;
  tooltip: string;
}

interface Props {
  title: string;
  bars: Bar[];
  /** Garis acuan (mis. RPE divisi) — garis putus-putus tinta gelap dengan label teks, bukan seri data. */
  reference?: { value: number; label: string } | null;
  emptyText?: string;
}

const MARK = '#2563eb'; // satu seri → satu warna; lolos validator dataviz (lightness, kroma, kontras ≥ 3:1)

/** Bar horizontal satu seri: batang tipis, ujung 4px, nilai langsung, tooltip saat hover/fokus. */
export function BarList({ title, bars, reference, emptyText = 'Belum ada data.' }: Props) {
  const titleId = useId();
  const max = Math.max(1, ...bars.map((b) => b.value ?? 0), reference?.value ?? 0);
  const pct = (v: number) => `${(v / max) * 100}%`;
  return (
    <figure aria-labelledby={titleId} className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
      <figcaption id={titleId} className="text-sm font-semibold text-slate-900">
        {title}
      </figcaption>
      {bars.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">{emptyText}</p>
      ) : (
        <div className="relative mt-4">
          {reference && (
            <div className="pointer-events-none absolute inset-y-0 left-[6.75rem] right-[6.75rem]" aria-hidden="true">
              <div className="absolute inset-y-0 border-l-2 border-dashed border-slate-700" style={{ left: pct(reference.value) }}>
                <span className="absolute -top-5 -translate-x-1/2 whitespace-nowrap text-[11px] font-medium text-slate-700">{reference.label}</span>
              </div>
            </div>
          )}
          <ul className="space-y-3 pt-2">
            {bars.map((b) => (
              <li key={b.key} className="group relative flex items-center gap-3" tabIndex={0} aria-label={b.tooltip}>
                <span className="w-24 shrink-0 truncate text-sm text-slate-700">{b.label}</span>
                <span className="relative h-3 flex-1 rounded-r bg-slate-100">
                  {b.value !== null && <span className="absolute inset-y-0 left-0 rounded-r-[4px]" style={{ width: pct(b.value), background: MARK }} />}
                </span>
                <span className="w-24 shrink-0 text-right text-sm tabular-nums text-slate-900">{b.display}</span>
                <span
                  role="tooltip"
                  className="pointer-events-none absolute -top-9 left-[6.75rem] z-10 hidden whitespace-nowrap rounded-md bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow group-hover:block group-focus:block"
                >
                  {b.tooltip}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </figure>
  );
}
