import { Icon } from '../../components/Icon';
import { Spinner } from '../../components/Loading';
import { Pager } from '../../components/Pager';
import { formatDateTime, ruleTitle } from './labels';
import type { Run } from './types';

export interface UnitFilterOption {
  id: string;
  code: string;
  count: number;
}

interface Props {
  /** Isi halaman aktif dari server (paginasi & filter unit dilakukan API). */
  runs: Run[];
  total: number;
  page: number;
  pageSize: number;
  /** Total seluruh run dalam scope dan jumlah per unit (untuk chip filter). */
  allTotal: number | null;
  units: UnitFilterOption[];
  unitId: string | null;
  loading: boolean;
  selectedId: string | null;
  onUnit(unitId: string | null): void;
  onPage(page: number): void;
  onSelect(run: Run): void;
}

/** Riwayat pencocokan dalam scope (terbaru dulu) dengan filter cabang & paginasi server; yang terpilih ditandai. */
export function RunHistory({ runs, total, page, pageSize, allTotal, units, unitId, loading, selectedId, onUnit, onPage, onSelect }: Props) {
  const pages = Math.max(1, Math.ceil(total / pageSize));

  const chip = (value: string | null, label: string, count: number | null) => {
    const active = unitId === value;
    return (
      <button
        key={value ?? 'all'}
        type="button"
        aria-pressed={active}
        onClick={() => onUnit(value)}
        className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
          active ? 'bg-blue-700 text-white shadow-sm' : 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-blue-50 hover:text-blue-800 hover:ring-blue-300'
        }`}
      >
        {label}
        {count !== null && <span className={`rounded-full px-1.5 text-xs font-semibold tabular-nums ${active ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-600'}`}>{count}</span>}
      </button>
    );
  };

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            Riwayat pencocokan
            {loading && <Spinner className="h-4 w-4" />}
          </h2>
          <p className="text-xs text-slate-500">
            {total} pencocokan{unitId ? ' di cabang terpilih' : ''} · pilih salah satu untuk melihat hasilnya di bawah.
          </p>
        </div>
        {units.length > 1 && (
          <div role="group" aria-label="Filter cabang" className="flex flex-wrap items-center gap-2">
            <span className="mr-1 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <Icon name="org" className="h-4 w-4" />
              Cabang
            </span>
            {chip(null, 'Semua', allTotal)}
            {units.map((u) => chip(u.id, u.code, u.count))}
          </div>
        )}
      </div>
      {runs.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-slate-600">{loading ? 'Memuat…' : 'Belum ada hasil pencocokan dalam akses Anda.'}</p>
      ) : (
        <div className={`relative overflow-x-auto transition-opacity ${loading ? 'opacity-60' : ''}`}>
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Riwayat pencocokan</caption>
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2.5 pl-5 pr-4 font-medium">Cabang · akun</th>
                <th className="px-4 py-2.5 font-medium">Toleransi</th>
                <th className="px-4 py-2.5 font-medium">Waktu</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-5 py-2.5">
                  <span className="sr-only">Aksi</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {runs.map((r) => {
                const active = r.id === selectedId;
                return (
                  <tr key={r.id} onClick={() => !active && onSelect(r)} className={`cursor-pointer transition ${active ? 'bg-blue-50/70' : 'hover:bg-slate-50'}`}>
                    <td className={`border-l-4 py-3 pl-4 pr-4 ${active ? 'border-blue-600' : 'border-transparent'}`}>
                      <span className="inline-flex items-center gap-2">
                        <span className="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-800 ring-1 ring-blue-100">{r.unit?.code ?? '—'}</span>
                        <span className="font-medium text-slate-900">{r.accountId}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-700">{ruleTitle(r.ruleVersion)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-700">{formatDateTime(r.createdAt)}</td>
                    <td className="px-4 py-3">
                      {r.isCanonical ? (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">Terbaru</span>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200">Digantikan</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!active) onSelect(r);
                        }}
                        aria-current={active}
                        aria-label={`Lihat hasil ${r.unit?.code ?? ''} ${r.accountId} ${ruleTitle(r.ruleVersion)}`}
                        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
                          active ? 'cursor-default bg-blue-700 text-white shadow-sm' : 'bg-white text-blue-700 ring-1 ring-blue-300 hover:bg-blue-700 hover:text-white hover:ring-blue-700'
                        }`}
                      >
                        {active ? (
                          <>
                            <Icon name="check" className="h-3.5 w-3.5" />
                            Sedang ditampilkan
                          </>
                        ) : (
                          <>
                            Lihat hasil
                            <Icon name="arrow" className="h-3.5 w-3.5" />
                          </>
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} pages={pages} onChange={onPage} className="border-t border-slate-100 px-5 py-3" />
    </div>
  );
}
