import { useId, useRef, useState, type DragEvent } from 'react';
import { ApiRequestError, apiFetch } from '../../lib/api';
import { describeImportError, SIDE_TEXT } from './labels';
import type { Dataset, ImportRowError, Side } from './types';

interface Props {
  side: Side;
  unitId: string;
  accountId: string;
  /** Data yang sudah pernah diunggah untuk unit + akun + sisi ini. */
  existing: Dataset[];
  value: Dataset | null;
  onChange(dataset: Dataset | null): void;
}

type Problem = { message: string; rows: ImportRowError[]; total: number; conflicts?: string[] };

/** Satu sisi rekonsiliasi: unggah CSV (seret-lepas atau pilih) atau pakai data yang sudah ada. */
export function UploadCard({ side, unitId, accountId, existing, value, onChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const ids = { input: useId(), existing: useId(), title: useId() };
  const text = SIDE_TEXT[side];

  async function upload(file: File) {
    setProblem(null);
    setNotice(null);
    if (!/\.csv$/i.test(file.name)) {
      setProblem({ message: describeImportError('UNSUPPORTED_FILE_TYPE', ''), rows: [], total: 0 });
      return;
    }
    const form = new FormData();
    form.set('unitId', unitId);
    form.set('accountId', accountId);
    form.set('side', side);
    form.set('file', file);
    setBusy(true);
    try {
      const res = await apiFetch<{ created: boolean; dataset: Dataset }>('/datasets/import', { method: 'POST', body: form });
      onChange(res.dataset);
      if (!res.created) setNotice('File ini sudah pernah diunggah — data yang sama dipakai, tidak ada data ganda.');
    } catch (err) {
      if (err instanceof ApiRequestError) {
        const d = err.body.details as { errors?: ImportRowError[]; totalErrors?: number; transactionIds?: string[] } | undefined;
        setProblem({
          message: err.status === 413 ? describeImportError('PAYLOAD_TOO_LARGE', '') : describeImportError(err.body.code, err.body.message),
          rows: d?.errors ?? [],
          total: d?.totalErrors ?? 0,
          conflicts: d?.transactionIds,
        });
      } else {
        setProblem({ message: 'Tidak dapat terhubung ke server. Coba lagi.', rows: [], total: 0 });
      }
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void upload(file);
  }

  return (
    <section aria-labelledby={ids.title} className="flex flex-col rounded-xl border border-slate-200 bg-white p-4">
      <h3 id={ids.title} className="text-sm font-semibold text-slate-900">
        {text.title}
      </h3>
      <p className="mt-0.5 text-xs text-slate-600">{text.hint}</p>

      {value ? (
        <div className="mt-3 flex flex-1 flex-col justify-between rounded-lg bg-emerald-50 p-3 ring-1 ring-emerald-200">
          <p role="status" className="flex items-start gap-2 text-sm text-emerald-900">
            <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs text-white">
              ✓
            </span>
            <span>
              <span className="font-semibold">{value.rowCount} transaksi siap</span>
              <span className="block text-xs text-emerald-800">{value.sourceFilename ?? 'Data tersimpan'}</span>
            </span>
          </p>
          {notice && <p className="mt-2 text-xs text-emerald-800">{notice}</p>}
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setNotice(null);
            }}
            className="mt-3 self-start text-xs font-medium text-emerald-900 underline underline-offset-2 hover:text-emerald-700"
          >
            Ganti data
          </button>
        </div>
      ) : (
        <>
          <label
            htmlFor={ids.input}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`mt-3 flex flex-1 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 text-center transition ${
              dragging ? 'border-blue-500 bg-blue-50' : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50'
            } ${busy ? 'pointer-events-none opacity-60' : ''}`}
          >
            <svg viewBox="0 0 24 24" className="h-7 w-7 text-slate-400" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
            </svg>
            <span className="mt-2 text-sm font-medium text-slate-800">{busy ? 'Memeriksa file…' : 'Tarik file CSV ke sini'}</span>
            <span className="text-xs text-slate-500">atau klik untuk memilih file (maks. 1 MB)</span>
            <input
              ref={inputRef}
              id={ids.input}
              type="file"
              accept=".csv,text/csv"
              aria-label={`Unggah file ${text.title}`}
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
              }}
            />
          </label>
          {existing.length > 0 && (
            <div className="mt-3">
              <label htmlFor={ids.existing} className="block text-xs font-medium text-slate-700">
                Atau pakai data yang sudah diunggah
              </label>
              <select
                id={ids.existing}
                value=""
                onChange={(e) => onChange(existing.find((d) => d.id === e.target.value) ?? null)}
                className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
              >
                <option value="">Pilih data…</option>
                {existing.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.sourceFilename ?? 'Tanpa nama'} · {d.rowCount} transaksi · {new Date(d.createdAt).toLocaleDateString('id-ID')}
                  </option>
                ))}
              </select>
            </div>
          )}
        </>
      )}

      {problem && (
        <div role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200">
          <p className="font-medium">
            {problem.rows.length > 0 ? `File ditolak: ${problem.total} baris perlu diperbaiki. Tidak ada data yang disimpan.` : problem.message}
          </p>
          {problem.conflicts && <p className="mt-1 text-xs">ID bermasalah: {problem.conflicts.join(', ')}</p>}
          {problem.rows.length > 0 && (
            <ul className="mt-2 max-h-40 list-disc space-y-0.5 overflow-y-auto pl-5 text-xs">
              {problem.rows.map((r) => (
                <li key={`${r.line}-${r.code}`}>
                  Baris {r.line}
                  {r.transactionId ? ` (${r.transactionId})` : ''}: {r.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
