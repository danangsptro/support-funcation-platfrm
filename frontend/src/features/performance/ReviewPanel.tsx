import { useEffect, useId, useState, type FormEvent } from 'react';
import { LoadingBlock } from '../../components/Loading';
import { ApiRequestError, apiFetch } from '../../lib/api';
import { formatRupiah } from '../../lib/format';
import { formatNumber, PROBLEM_TEXT } from './format';
import type { Review, ReviewItem } from './types';

interface Props {
  periodId: string;
  employeeId: string;
  reviewId: string | null;
  canManage: boolean;
  onChanged(): void;
}

const value = (i: ReviewItem, v: string | null) => (v === null ? '—' : i.source === 'VERIFIED_UNIT_REVENUE' ? formatRupiah(v) : formatNumber(v));

/** Review satu karyawan: preview langsung (draf) atau snapshot (final). HR dapat mengelola KPI & finalisasi. */
export function ReviewPanel({ periodId, employeeId, reviewId, canManage, onChanged }: Props) {
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setReview(null);
    setError(null);
    setConfirming(false);
    const load = canManage
      ? apiFetch<Review>('/reviews/calculate', { method: 'POST', body: JSON.stringify({ employeeId, periodId }) })
      : reviewId
        ? apiFetch<Review>(`/reviews/${reviewId}`)
        : Promise.resolve(null);
    load.then((r) => (r ? setReview(r) : setError('Belum ada KPI untuk karyawan ini.'))).catch(() => setError('Review gagal dimuat.'));
  }, [employeeId, periodId, reviewId, canManage]);

  async function finalize() {
    if (!review) return;
    setBusy(true);
    try {
      setReview(await apiFetch<Review>(`/reviews/${review.id}/finalize`, { method: 'POST' }));
      setConfirming(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : 'Finalisasi gagal. Coba lagi.');
    } finally {
      setBusy(false);
    }
  }

  if (error && !review) return <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">{error}</p>;
  if (!review) return <LoadingBlock label="Memuat review…" />;

  const final = review.status === 'FINALIZED';
  const editable = canManage && !final;
  const weightOk = Number(review.weightTotal) === 100;

  return (
    <section aria-label={`Review ${review.employee.name}`} className="space-y-5 rounded-2xl bg-white p-5 ring-1 ring-slate-200">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{review.employee.name}</h2>
          <p className="text-sm text-slate-600">
            {review.employee.code} · {review.unit?.code} · periode {review.period.code}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-500">{final ? 'Skor final' : 'Skor sementara'}</p>
          <p className="text-3xl font-semibold tabular-nums text-slate-900">{review.totalScore === null ? '—' : formatNumber(review.totalScore)}</p>
        </div>
      </header>

      {final && (
        <p role="status" className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-900 ring-1 ring-emerald-200">
          Final sejak {new Date(review.finalizedAt!).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })} · rumus {review.formulaVersion}. Nilai di bawah adalah
          snapshot dan tidak berubah walau revenue bertambah.
          {review.provenance?.revenueSources.map((s) => (
            <span key={s.kpiId} className="block text-xs text-emerald-800">
              Revenue {s.unitCode}: {formatRupiah(s.verifiedRevenue)} dari pencocokan {s.ruleVersions.join(', ') || '—'}.
            </span>
          ))}
        </p>
      )}

      <div className="relative overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">KPI dan perhitungan skor</caption>
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="min-w-[14rem] px-3 py-2 font-medium">KPI</th>
              <th className="px-3 py-2 text-right font-medium">Bobot</th>
              <th className="px-3 py-2 text-right font-medium">Target</th>
              <th className="px-3 py-2 text-right font-medium">Actual</th>
              <th className="px-3 py-2 text-right font-medium">Capaian</th>
              <th className="px-3 py-2 text-right font-medium">Skor</th>
              {editable && <th className="px-3 py-2"><span className="sr-only">Aksi</span></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {review.items.map((i) =>
              editable ? (
                <EditableRow key={i.kpiId} item={i} onSaved={setReview} />
              ) : (
                <tr key={i.kpiId}>
                  <td className="px-3 py-2.5">
                    <span className="font-medium text-slate-900">{i.name}</span>
                    <span className="block text-xs text-slate-500">{i.source === 'MANUAL' ? 'Diisi manual' : `Otomatis: revenue terverifikasi ${i.unit?.code}`}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(i.weight)}%</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{value(i, i.target)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{value(i, i.actual)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {i.achievement === null ? '—' : `${formatNumber(i.achievement)}%`}
                    {i.achievement !== null && Number(i.achievement) > 120 && <span className="block text-xs text-slate-500">dihitung 120%</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right font-medium tabular-nums">{i.weightedScore === null ? '—' : formatNumber(i.weightedScore)}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
        {review.items.length === 0 && <p className="px-3 py-4 text-sm text-slate-500">Belum ada KPI.</p>}
      </div>

      <p className={`text-sm ${weightOk ? 'text-slate-600' : 'text-amber-800'}`}>
        Total bobot: <span className="font-semibold tabular-nums">{formatNumber(review.weightTotal)}%</span> {weightOk ? '✓' : '(harus 100%)'}
      </p>

      {editable && <AddKpiForm periodId={periodId} employeeId={employeeId} unit={review.unit} onSaved={setReview} />}

      {editable && (
        <div className="border-t border-slate-100 pt-4">
          {review.problems.length > 0 && (
            <ul className="mb-3 list-disc pl-5 text-sm text-amber-800">
              {review.problems.map((p) => (
                <li key={p}>{PROBLEM_TEXT[p](review.weightTotal)}</li>
              ))}
            </ul>
          )}
          {confirming ? (
            <div role="alertdialog" aria-label="Konfirmasi finalisasi" className="rounded-lg bg-amber-50 p-4 ring-1 ring-amber-200">
              <p className="text-sm text-amber-900">
                Finalisasi bersifat permanen: skor {formatNumber(review.totalScore)} disimpan sebagai snapshot dan KPI periode ini tidak bisa diubah lagi.
              </p>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => void finalize()} disabled={busy} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-70">
                  {busy ? 'Menyimpan…' : 'Ya, finalisasi'}
                </button>
                <button type="button" onClick={() => setConfirming(false)} className="rounded-lg px-4 py-2 text-sm text-slate-700 hover:bg-white">
                  Batal
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={!review.canFinalize}
              onClick={() => setConfirming(true)}
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              Finalisasi review
            </button>
          )}
          {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        </div>
      )}
    </section>
  );
}

function EditableRow({ item, onSaved }: { item: ReviewItem; onSaved(r: Review): void }) {
  const manual = item.source === 'MANUAL';
  const [weight, setWeight] = useState(item.weight);
  const [target, setTarget] = useState(item.target);
  const [actual, setActual] = useState(item.actual ?? '');
  const [error, setError] = useState<string | null>(null);
  const dirty = weight !== item.weight || target !== item.target || (manual && actual !== (item.actual ?? ''));

  async function save() {
    setError(null);
    try {
      const body: Record<string, string | null> = { weight: weight.trim(), target: target.trim() };
      if (manual) body.actual = actual.trim() === '' ? null : actual.trim();
      const res = await apiFetch<{ review: Review }>(`/kpi-assignments/${item.kpiId}`, { method: 'PATCH', body: JSON.stringify(body) });
      onSaved(res.review);
    } catch (err) {
      const d = err instanceof ApiRequestError ? (err.body.details as { messages: string[] }[] | undefined) : undefined;
      setError(d?.[0]?.messages[0] ?? (err instanceof ApiRequestError ? err.body.message : 'Gagal menyimpan'));
    }
  }

  const input = 'w-24 rounded-md border border-slate-300 px-2 py-1 text-right text-sm tabular-nums';
  return (
    <tr className="align-top">
      <td className="px-3 py-2.5">
        <span className="font-medium text-slate-900">{item.name}</span>
        <span className="block text-xs text-slate-500">{manual ? 'Diisi manual' : `Otomatis: revenue terverifikasi ${item.unit?.code}`}</span>
        {error && <span role="alert" className="block text-xs text-red-700">{error}</span>}
      </td>
      <td className="px-3 py-2.5 text-right">
        <input aria-label={`Bobot ${item.name}`} value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="decimal" className={input} />
      </td>
      <td className="px-3 py-2.5 text-right">
        <input aria-label={`Target ${item.name}`} value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" className={input} />
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">
        {manual ? (
          <input aria-label={`Actual ${item.name}`} value={actual} onChange={(e) => setActual(e.target.value)} inputMode="decimal" placeholder="isi" className={input} />
        ) : (
          value(item, item.actual)
        )}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">
        {item.achievement === null ? '—' : `${formatNumber(item.achievement)}%`}
        {item.achievement !== null && Number(item.achievement) > 120 && <span className="block text-xs text-slate-500">dihitung 120%</span>}
      </td>
      <td className="px-3 py-2.5 text-right font-medium tabular-nums">{item.weightedScore === null ? '—' : formatNumber(item.weightedScore)}</td>
      <td className="px-3 py-2.5 text-right">
        <button type="button" disabled={!dirty} onClick={() => void save()} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium disabled:opacity-40">
          Simpan
        </button>
      </td>
    </tr>
  );
}

function AddKpiForm({ periodId, employeeId, unit, onSaved }: { periodId: string; employeeId: string; unit: Review['unit']; onSaved(r: Review): void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [source, setSource] = useState<'MANUAL' | 'VERIFIED_UNIT_REVENUE'>('MANUAL');
  const [weight, setWeight] = useState('');
  const [target, setTarget] = useState('');
  const [actual, setActual] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ids = { name: useId(), weight: useId(), target: useId(), actual: useId() };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const body: Record<string, string> = { employeeId, periodId, name: name.trim(), source, weight: weight.trim(), target: target.trim() };
      if (source === 'VERIFIED_UNIT_REVENUE' && unit) body.unitId = unit.id;
      if (source === 'MANUAL' && actual.trim()) body.actual = actual.trim();
      const res = await apiFetch<{ review: Review }>('/kpi-assignments', { method: 'POST', body: JSON.stringify(body) });
      onSaved(res.review);
      setOpen(false);
      setName('');
      setWeight('');
      setTarget('');
      setActual('');
    } catch (err) {
      const d = err instanceof ApiRequestError ? (err.body.details as { messages: string[] }[] | undefined) : undefined;
      setError(d?.[0]?.messages[0] ?? (err instanceof ApiRequestError ? err.body.message : 'Gagal menyimpan'));
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm font-medium text-blue-700 hover:underline">
        + Tambah KPI
      </button>
    );
  }
  const field = 'mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm';
  return (
    <form onSubmit={submit} className="grid gap-3 rounded-lg bg-slate-50 p-4 sm:grid-cols-2" aria-label="Tambah KPI">
      <div className="sm:col-span-2">
        <label htmlFor={ids.name} className="text-xs font-medium text-slate-700">Nama KPI</label>
        <input id={ids.name} value={name} onChange={(e) => setName(e.target.value)} className={field} required />
      </div>
      <fieldset className="sm:col-span-2">
        <legend className="text-xs font-medium text-slate-700">Sumber nilai actual</legend>
        <div className="mt-1 flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="radio" checked={source === 'MANUAL'} onChange={() => setSource('MANUAL')} /> Diisi manual</label>
          <label className="flex items-center gap-2"><input type="radio" checked={source === 'VERIFIED_UNIT_REVENUE'} onChange={() => setSource('VERIFIED_UNIT_REVENUE')} /> Revenue terverifikasi {unit?.code}</label>
        </div>
      </fieldset>
      <div>
        <label htmlFor={ids.weight} className="text-xs font-medium text-slate-700">Bobot (%)</label>
        <input id={ids.weight} value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="decimal" placeholder="mis. 40" className={field} />
      </div>
      <div>
        <label htmlFor={ids.target} className="text-xs font-medium text-slate-700">Target</label>
        <input id={ids.target} value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" placeholder="lebih dari 0" className={field} />
      </div>
      {source === 'MANUAL' && (
        <div>
          <label htmlFor={ids.actual} className="text-xs font-medium text-slate-700">Actual (boleh diisi nanti)</label>
          <input id={ids.actual} value={actual} onChange={(e) => setActual(e.target.value)} inputMode="decimal" className={field} />
        </div>
      )}
      <div className="flex items-end gap-2 sm:col-span-2">
        <button type="submit" className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800">Simpan KPI</button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-4 py-2 text-sm text-slate-700 hover:bg-white">Batal</button>
      </div>
      {error && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{error}</p>}
    </form>
  );
}
