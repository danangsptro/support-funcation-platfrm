import { useEffect, useId, useState, type FormEvent } from 'react';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { ApiRequestError, apiFetch } from '../../lib/api';
import { formatRupiah } from '../../lib/format';
import { describeRule, previewPath } from './labels';
import type { Options, RequestDetail } from './types';

/** Draf pengajuan baru. Jalur persetujuan ditampilkan dari konfigurasi workflow aktif (bukan hard-code). */
export function NewRequestDialog({ onClose, onCreated }: { onClose(): void; onCreated(r: RequestDetail): void }) {
  const [options, setOptions] = useState<Options | null>(null);
  const [unitId, setUnitId] = useState('');
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = { unit: useId(), title: useId(), amount: useId(), reason: useId() };

  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);

  // Data form (unit & aturan workflow). Batas 10 dtk + tombol coba lagi agar form tidak menggantung kosong.
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 10_000);
    setLoadState('loading');
    apiFetch<Options>('/approval-requests/options', { signal: controller.signal })
      .then((o) => {
        setOptions(o);
        setUnitId(o.units[0]?.id ?? '');
        setLoadState('ready');
      })
      .catch(() => setLoadState('failed'))
      .finally(() => window.clearTimeout(timer));
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [attempt]);

  const unit = options?.units.find((u) => u.id === unitId);
  const workflow = options?.workflows.find((w) => w.organizationId === unit?.organizationId);
  const cleanAmount = amount.replace(/\./g, '').replace(',', '.').trim();
  const path = previewPath(workflow, cleanAmount);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      onCreated(await apiFetch<RequestDetail>('/approval-requests', { method: 'POST', body: JSON.stringify({ unitId, title: title.trim(), amount: cleanAmount, reason: reason.trim() }) }));
    } catch (err) {
      const d = err instanceof ApiRequestError ? (err.body.details as { field: string; messages: string[] }[] | undefined) : undefined;
      setError(d?.[0] ? `${d[0].messages[0]}` : err instanceof ApiRequestError ? err.body.message : 'Gagal menyimpan. Coba lagi.');
    } finally {
      setBusy(false);
    }
  }

  const field = 'mt-1.5 block w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm shadow-sm outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-100';
  return (
    <Dialog title="Pengajuan anggaran baru" description="Disimpan sebagai draf. Anda bisa memeriksanya dulu sebelum mengajukan." icon={<Icon name="approval" />} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="space-y-4 px-6 pb-6 pt-3">
          {loadState === 'loading' && (
            <p role="status" className="text-sm text-slate-500">
              Memuat data form…
            </p>
          )}
          {loadState === 'failed' && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900 ring-1 ring-amber-200">
              Daftar unit dan aturan persetujuan belum termuat.
              <button type="button" onClick={() => setAttempt((n) => n + 1)} className="rounded-md border border-amber-300 bg-white px-3 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100">
                Coba lagi
              </button>
            </div>
          )}
          <div>
            <label htmlFor={ids.unit} className="text-sm font-medium text-slate-800">Unit</label>
            <select id={ids.unit} value={unitId} onChange={(e) => setUnitId(e.target.value)} className={field}>
              {options?.units.map((u) => (
                <option key={u.id} value={u.id}>{u.name === u.code ? u.code : `${u.name} (${u.code})`}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={ids.title} className="text-sm font-medium text-slate-800">Judul</label>
            <input id={ids.title} autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="mis. Pengadaan laptop tim penjualan" className={field} />
          </div>
          <div>
            <label htmlFor={ids.amount} className="text-sm font-medium text-slate-800">Nominal (Rp)</label>
            <input id={ids.amount} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="mis. 15000000" className={field} />
            {path.length > 0 && (
              <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-600" aria-live="polite">
                {formatRupiah(cleanAmount)} perlu persetujuan:
                {path.map((p, i) => (
                  <span key={i} className="rounded-full bg-blue-50 px-2 py-0.5 font-medium text-blue-800 ring-1 ring-blue-200">
                    {i + 1}. {p}
                  </span>
                ))}
              </p>
            )}
          </div>
          <div>
            <label htmlFor={ids.reason} className="text-sm font-medium text-slate-800">Alasan pengajuan</label>
            <textarea id={ids.reason} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Jelaskan kebutuhan dan manfaatnya" className={field} />
          </div>
          {workflow && <p className="text-xs text-slate-500">Aturan berlaku ({workflow.key} v{workflow.version}): {describeRule(workflow).join(' · ')}.</p>}
          {error && (
            <p role="alert" className="flex items-center gap-1.5 text-sm text-red-700">
              <Icon name="alert" className="h-4 w-4 shrink-0" />
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-100">
            Batal
          </button>
          <button type="submit" disabled={busy || !unitId} className="flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-800 disabled:bg-slate-300">
            <Icon name="check" className="h-4 w-4" />
            {busy ? 'Menyimpan…' : 'Simpan draf'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
