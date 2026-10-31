import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { LoadingBlock } from '../../components/Loading';
import { useSearchParams } from 'react-router-dom';
import { LoadError } from '../../components/Pager';
import { ApiRequestError, apiFetch } from '../../lib/api';
import { useAuth } from '../auth/AuthContext';
import { AnalyticsTab } from './AnalyticsTab';
import { formatNumber, periodLabel, STATUS_TEXT } from './format';
import { ReviewPanel } from './ReviewPanel';
import type { Period, ReviewListItem } from './types';

type Tab = 'analitik' | 'review';

/** Performa & RPE. Tab, periode, dan karyawan terpilih ada di URL agar bisa dibagikan. */
export function PerformancePage() {
  const { can } = useAuth();
  const canManage = can('review.manage');
  const canSeeReviews = can('analytics.performance.read');
  const [params, setParams] = useSearchParams();
  const [periods, setPeriods] = useState<Period[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadPeriods = useCallback(() => {
    apiFetch<{ items: Period[] }>('/review-periods')
      .then((r) => setPeriods(r.items))
      .catch(() => setError('Periode gagal dimuat.'));
  }, []);
  useEffect(loadPeriods, [loadPeriods]);

  // Default: periode terbaru yang sudah dimulai (daftar terurut dari yang terbaru).
  const today = new Date().toISOString().slice(0, 10);
  const periodId = params.get('period') ?? periods?.find((p) => p.startDate <= today)?.id ?? periods?.[0]?.id ?? null;
  const tab: Tab = canSeeReviews && params.get('tab') === 'review' ? 'review' : 'analitik';
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next);
  };

  if (error) return <p className="rounded-lg bg-red-50 p-4 text-sm text-red-800">{error}</p>;
  if (!periods) return <LoadingBlock variant="page" label="Memuat periode review…" />;

  const tabClass = (t: Tab) =>
    `-mb-px border-b-2 px-4 py-2.5 text-sm font-medium ${tab === t ? 'border-blue-700 text-blue-800' : 'border-transparent text-slate-600 hover:text-slate-900'}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Performa & revenue per karyawan</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Skor KPI karyawan dan produktivitas cabang berdasarkan revenue terverifikasi. Hanya unit dan karyawan dalam akses Anda yang ditampilkan.
          </p>
        </div>
        <PeriodPicker periods={periods} value={periodId} onChange={(id) => set({ period: id, employee: null })} />
      </div>

      {canManage && <NewPeriodForm onCreated={(p) => { loadPeriods(); set({ period: p.id }); }} />}

      {canSeeReviews && (
        <div role="tablist" aria-label="Performa" className="flex border-b border-slate-200">
          <button type="button" role="tab" aria-selected={tab === 'analitik'} className={tabClass('analitik')} onClick={() => set({ tab: null })}>
            Analitik
          </button>
          <button type="button" role="tab" aria-selected={tab === 'review'} className={tabClass('review')} onClick={() => set({ tab: 'review' })}>
            Review karyawan
          </button>
        </div>
      )}

      {!periodId ? (
        <p className="text-sm text-slate-600">Belum ada periode review.</p>
      ) : tab === 'analitik' ? (
        <AnalyticsTab periodId={periodId} canSeeScores={canSeeReviews} />
      ) : (
        <ReviewsTab periodId={periodId} canManage={canManage} selected={params.get('employee')} onSelect={(e) => set({ employee: e })} />
      )}
    </div>
  );
}

function PeriodPicker({ periods, value, onChange }: { periods: Period[]; value: string | null; onChange(id: string): void }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-slate-600">
        Periode
      </label>
      <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)} className="mt-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
        {periods.map((p) => (
          <option key={p.id} value={p.id}>
            {periodLabel(p)}
          </option>
        ))}
      </select>
    </div>
  );
}

function NewPeriodForm({ onCreated }: { onCreated(p: Period): void }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ids = { code: useId(), start: useId(), end: useId() };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const p = await apiFetch<Period>('/review-periods', { method: 'POST', body: JSON.stringify({ code: code.trim().toUpperCase(), startDate: start, endDateExclusive: end }) });
      setOpen(false);
      onCreated(p);
    } catch (err) {
      const d = err instanceof ApiRequestError ? (err.body.details as { messages: string[] }[] | undefined) : undefined;
      setError(d?.[0]?.messages[0] ?? (err instanceof ApiRequestError ? err.body.message : 'Gagal menyimpan'));
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm font-medium text-blue-700 hover:underline">
        + Periode baru
      </button>
    );
  }
  const field = 'mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm';
  return (
    <form onSubmit={submit} className="grid gap-3 rounded-2xl bg-white p-5 ring-1 ring-slate-200 sm:grid-cols-4" aria-label="Periode baru">
      <div>
        <label htmlFor={ids.code} className="text-xs font-medium text-slate-700">Kode</label>
        <input id={ids.code} value={code} onChange={(e) => setCode(e.target.value)} placeholder="PERIOD-OKT" className={field} />
      </div>
      <div>
        <label htmlFor={ids.start} className="text-xs font-medium text-slate-700">Tanggal mulai</label>
        <input id={ids.start} type="date" value={start} onChange={(e) => setStart(e.target.value)} className={field} />
      </div>
      <div>
        <label htmlFor={ids.end} className="text-xs font-medium text-slate-700">Sampai sebelum tanggal</label>
        <input id={ids.end} type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={field} />
      </div>
      <div className="flex items-end gap-2">
        <button type="submit" className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800">Simpan</button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Batal</button>
      </div>
      <p className="text-xs text-slate-500 sm:col-span-4">Contoh September: mulai 1 Sep, sampai sebelum 1 Okt (tanggal akhir tidak termasuk).</p>
      {error && <p role="alert" className="text-sm text-red-700 sm:col-span-4">{error}</p>}
    </form>
  );
}

function ReviewsTab({ periodId, canManage, selected, onSelect }: { periodId: string; canManage: boolean; selected: string | null; onSelect(id: string): void }) {
  const [items, setItems] = useState<ReviewListItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const load = useCallback(() => {
    setLoadError(false);
    apiFetch<{ items: ReviewListItem[] }>(`/reviews?periodId=${periodId}`)
      .then((r) => setItems(r.items))
      .catch(() => setLoadError(true));
  }, [periodId]);
  useEffect(load, [load]);

  if (loadError) return <LoadError message="Daftar karyawan gagal dimuat." onRetry={load} />;

  if (!items) return <LoadingBlock label="Memuat karyawan…" />;
  if (items.length === 0) return <p className="rounded-2xl bg-white p-6 text-sm text-slate-600 ring-1 ring-slate-200">Tidak ada karyawan dalam cakupan Anda pada periode ini.</p>;
  const current = items.find((i) => i.employee.id === selected);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      {/* relative: elemen sr-only (absolute) di dalam tabel ikut terpotong wadah gulir, tidak melebarkan halaman. */}
      <div className="relative overflow-x-auto rounded-2xl bg-white ring-1 ring-slate-200">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Karyawan pada periode</caption>
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2.5 font-medium">Karyawan</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 text-right font-medium">Skor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((i) => {
              const s = STATUS_TEXT[i.status];
              const active = i.employee.id === selected;
              return (
                <tr key={i.employee.id} className={active ? 'bg-blue-50' : 'hover:bg-slate-50'}>
                  <td className="px-4 py-2.5">
                    <button type="button" onClick={() => onSelect(i.employee.id)} aria-current={active} className="text-left">
                      <span className="font-medium text-slate-900 hover:underline">{i.employee.name}</span>
                      <span className="block text-xs text-slate-500">
                        {i.employee.code} · {i.unit.code} · {i.kpiCount} KPI
                      </span>
                    </button>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${s.style}`}>{s.label}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{i.totalScore === null ? '—' : formatNumber(i.totalScore)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {current ? (
        <ReviewPanel key={current.employee.id} periodId={periodId} employeeId={current.employee.id} reviewId={current.reviewId} canManage={canManage} onChanged={load} />
      ) : (
        <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">Pilih karyawan untuk melihat KPI dan skornya.</p>
      )}
    </div>
  );
}
