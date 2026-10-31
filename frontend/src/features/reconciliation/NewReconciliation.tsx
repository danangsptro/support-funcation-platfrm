import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { ApiRequestError, apiFetch } from '../../lib/api';
import { CsvFormatHelp } from './CsvFormatHelp';
import { RULE_OPTIONS } from './labels';
import type { Dataset, Run } from './types';
import { UploadCard } from './UploadCard';

export interface UnitOption {
  id: string;
  code: string;
  name: string;
  organization: { code: string };
}

interface Props {
  units: UnitOption[];
  datasets: Dataset[];
  onDatasetsChanged(): void;
  onRunReady(run: Run, created: boolean): void;
}

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: ReactNode }) {
  return (
    <li className="relative pl-12">
      <span
        aria-hidden="true"
        className={`absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
          done ? 'bg-emerald-600 text-white' : 'bg-slate-900 text-white'
        }`}
      >
        {done ? '✓' : n}
      </span>
      <h3 className="pt-1 text-base font-semibold text-slate-900">
        <span className="sr-only">Langkah {n}: </span>
        {title}
      </h3>
      <div className="mt-3">{children}</div>
    </li>
  );
}

/** Alur terpandu: pilih cabang & akun → siapkan dua data → cocokkan. */
export function NewReconciliation({ units, datasets, onDatasetsChanged, onRunReady }: Props) {
  const [unitId, setUnitId] = useState(units[0]?.id ?? '');
  const [accountId, setAccountId] = useState('ACC-1');
  const [internal, setInternal] = useState<Dataset | null>(null);
  const [external, setExternal] = useState<Dataset | null>(null);
  const [ruleVersion, setRuleVersion] = useState('v1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { unit: useId(), account: useId(), accounts: useId() };

  const unit = units.find((u) => u.id === unitId);
  const account = accountId.trim();
  // Ganti cabang/akun → data yang dipilih sebelumnya tidak berlaku lagi.
  useEffect(() => {
    setInternal(null);
    setExternal(null);
    setError(null);
  }, [unitId, account]);

  const forScope = (side: Dataset['side']) => datasets.filter((d) => d.unit.id === unitId && d.accountId === account && d.side === side);
  const knownAccounts = useMemo(() => [...new Set(datasets.filter((d) => d.unit.id === unitId).map((d) => d.accountId))], [datasets, unitId]);
  const accountValid = /^[A-Za-z0-9._-]{1,64}$/.test(account);

  async function run() {
    if (!internal || !external) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ created: boolean; run: Run }>('/reconciliation-runs', {
        method: 'POST',
        body: JSON.stringify({ internalDatasetId: internal.id, externalDatasetId: external.id, ruleVersion }),
      });
      onRunReady(res.run, res.created);
    } catch (err) {
      setError(
        err instanceof ApiRequestError && err.body.code === 'CANONICAL_OVERLAP'
          ? 'Sebagian transaksi ini sudah dicocokkan memakai data lain. Pencocokan dibatalkan agar revenue tidak terhitung dua kali. Gunakan data yang sama dengan pencocokan sebelumnya.'
          : err instanceof ApiRequestError
            ? err.body.message
            : 'Tidak dapat terhubung ke server. Coba lagi.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <ol className="space-y-8 rounded-xl border border-slate-200 bg-white p-6">
        <Step n={1} title="Pilih cabang dan akun" done={Boolean(unit && accountValid)}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={ids.unit} className="block text-sm font-medium text-slate-800">
                Cabang / unit
              </label>
              <select id={ids.unit} value={unitId} onChange={(e) => setUnitId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name === u.code ? u.code : `${u.name} (${u.code})`}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={ids.account} className="block text-sm font-medium text-slate-800">
                Akun / rekening
              </label>
              <input
                id={ids.account}
                list={ids.accounts}
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                aria-invalid={!accountValid}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <datalist id={ids.accounts}>
                {knownAccounts.map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
              <p className={`mt-1 text-xs ${accountValid ? 'text-slate-500' : 'text-red-700'}`}>
                {accountValid ? 'Kode akun sesuai kolom account_id di file, mis. ACC-1.' : 'Gunakan huruf, angka, titik, garis bawah, atau strip.'}
              </p>
            </div>
          </div>
        </Step>

        <Step n={2} title="Siapkan dua data yang akan dicocokkan" done={Boolean(internal && external)}>
          {accountValid && unit ? (
            <div className="space-y-3">
              <div className="grid gap-4 md:grid-cols-2">
                <UploadCard side="INTERNAL" unitId={unitId} accountId={account} existing={forScope('INTERNAL')} value={internal} onChange={(d) => { setInternal(d); if (d) onDatasetsChanged(); }} />
                <UploadCard side="EXTERNAL" unitId={unitId} accountId={account} existing={forScope('EXTERNAL')} value={external} onChange={(d) => { setExternal(d); if (d) onDatasetsChanged(); }} />
              </div>
              <CsvFormatHelp orgCode={unit.organization.code} unitCode={unit.code} accountId={account} />
            </div>
          ) : (
            <p className="text-sm text-slate-600">Lengkapi langkah 1 terlebih dulu.</p>
          )}
        </Step>

        <Step n={3} title="Cocokkan">
          <fieldset>
            <legend className="text-sm font-medium text-slate-800">Toleransi perbedaan tanggal</legend>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {RULE_OPTIONS.map((o) => (
                <label
                  key={o.version}
                  className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${ruleVersion === o.version ? 'border-blue-600 bg-blue-50 ring-1 ring-blue-600' : 'border-slate-200 hover:bg-slate-50'}`}
                >
                  <input type="radio" name="rule" value={o.version} checked={ruleVersion === o.version} onChange={() => setRuleVersion(o.version)} className="mt-1" />
                  <span>
                    <span className="text-sm font-medium text-slate-900">
                      {o.title}
                      {o.recommended && <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">Disarankan</span>}
                    </span>
                    <span className="block text-xs text-slate-600">{o.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void run()}
              disabled={busy || !internal || !external}
              className="rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {busy ? 'Mencocokkan…' : 'Cocokkan sekarang'}
            </button>
            {(!internal || !external) && <span className="text-sm text-slate-500">Siapkan kedua data di langkah 2 terlebih dulu.</span>}
          </div>
          {error && (
            <p role="alert" className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-200">
              {error}
            </p>
          )}
        </Step>
      </ol>
    </div>
  );
}
