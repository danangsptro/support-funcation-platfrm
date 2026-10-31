import { useId, useState, type FormEvent } from 'react';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { ApiRequestError, apiFetch } from '../../lib/api';
import { unitTypeLabel } from '../auth/access-labels';

const MAX = 120;

export interface RenameTarget {
  id: string;
  code: string;
  name: string;
  type: string;
  organization: { name: string };
}

interface Props {
  unit: RenameTarget;
  onSaved(name: string): void;
  onClose(): void;
}

/** Dialog ubah nama unit (Admin). Kode unit tetap; backend memeriksa izin, cakupan, dan mencatat audit. */
export function RenameUnitDialog({ unit, onSaved, onClose }: Props) {
  const [name, setName] = useState(unit.name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ids = { input: useId(), help: useId(), error: useId() };
  const trimmed = name.trim();
  const unchanged = trimmed === unit.name;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!trimmed) return setError('Nama unit wajib diisi.');
    if (trimmed.length > MAX) return setError(`Nama unit maksimal ${MAX} karakter.`);
    if (unchanged) return onClose();
    setSaving(true);
    setError(null);
    try {
      const updated = await apiFetch<{ name: string }>(`/org-units/${unit.id}`, { method: 'PATCH', body: JSON.stringify({ name: trimmed }) });
      onSaved(updated.name);
    } catch (err) {
      setError(
        err instanceof ApiRequestError && err.status === 403
          ? 'Anda tidak memiliki izin mengubah unit ini.'
          : err instanceof ApiRequestError && err.status === 404
            ? 'Unit tidak ditemukan dalam akses Anda.'
            : 'Perubahan gagal disimpan. Coba lagi.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      title="Ubah nama unit"
      description={`${unit.code} · ${unitTypeLabel(unit.type)} · ${unit.organization.name}`}
      icon={<Icon name="pencil" />}
      onClose={onClose}
    >
      <form onSubmit={onSubmit} noValidate>
        <div className="space-y-4 px-6 pb-6 pt-3">
          <div className="rounded-lg bg-slate-50 px-3.5 py-2.5 ring-1 ring-slate-200">
            <p className="text-xs font-medium text-slate-500">Nama saat ini</p>
            <p className="mt-0.5 text-sm font-medium text-slate-900">{unit.name}</p>
          </div>
          <div>
            <div className="flex items-baseline justify-between">
              <label htmlFor={ids.input} className="text-sm font-medium text-slate-800">
                Nama baru
              </label>
              <span className={`text-xs tabular-nums ${trimmed.length > MAX ? 'text-red-700' : 'text-slate-500'}`} aria-live="polite">
                {trimmed.length}/{MAX}
              </span>
            </div>
            <input
              id={ids.input}
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              aria-invalid={Boolean(error)}
              aria-describedby={[ids.help, error ? ids.error : ''].join(' ').trim()}
              className={`mt-1.5 block w-full rounded-lg border bg-white px-3.5 py-2.5 text-base text-slate-900 shadow-sm outline-none transition focus:ring-4 ${
                error ? 'border-red-400 focus:border-red-500 focus:ring-red-100' : 'border-slate-300 focus:border-blue-600 focus:ring-blue-100'
              }`}
            />
            <p id={ids.help} className="mt-1.5 text-xs text-slate-500">
              Hanya nama tampilan yang berubah. Kode {unit.code}, data, dan hak akses tetap sama.
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
              <Icon name="shield" className="h-3.5 w-3.5 shrink-0" />
              Perubahan dicatat di jejak audit.
            </p>
            {error && (
              <p id={ids.error} role="alert" className="mt-2 flex items-center gap-1.5 text-sm text-red-700">
                <Icon name="alert" className="h-4 w-4 shrink-0" />
                {error}
              </p>
            )}
          </div>
        </div>
        <div className="border-t border-slate-200 bg-slate-50 px-6 py-4">
          <div className="flex gap-2 sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100 focus:outline-none focus-visible:ring-4 focus-visible:ring-slate-200 sm:flex-none"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving || unchanged || !trimmed}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-200 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none sm:flex-none"
            >
              {saving ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />
              ) : (
                <Icon name="check" className="h-4 w-4" />
              )}
              {saving ? 'Menyimpan…' : 'Simpan perubahan'}
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
