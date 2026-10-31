import { useEffect, useRef, useState } from 'react';
import { LoadingBlock } from '../../components/Loading';
import { ApiRequestError, apiFetch } from '../../lib/api';
import { formatPercent, formatRupiah } from '../../lib/format';
import { Pager } from '../../components/Pager';
import { formatDateTime, REASON_GUIDE, REASON_LABEL, ruleTitle, STATUS_LABEL, STATUS_STYLE } from './labels';
import type { MatchStatus, Page, ResultGroup, Run, RunSummary } from './types';

type Filter = { kind: 'all' } | { kind: 'status'; status: MatchStatus } | { kind: 'reason'; reason: string };
const STATUSES: MatchStatus[] = ['MATCHED', 'MISMATCHED', 'MISSING_IN_INTERNAL', 'MISSING_IN_EXTERNAL'];
const PAGE_SIZE = 20;

function Stat({ label, value, hint, tone = 'default' }: { label: string; value: string; hint?: string; tone?: 'default' | 'good' | 'warn' }) {
  const ring = { default: 'ring-slate-200', good: 'ring-emerald-200 bg-emerald-50/40', warn: 'ring-amber-200 bg-amber-50/40' }[tone];
  return (
    <div className={`rounded-xl bg-white p-4 ring-1 ${ring}`}>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/** Ringkasan, daftar tindak lanjut, dan rincian per grup. Rincian hanya untuk pengguna dengan reconciliation.read. */
export function RunDetail({ run, canReadResults }: { run: Run; canReadResults: boolean }) {
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
  const [page, setPage] = useState(1);
  const [results, setResults] = useState<Page<ResultGroup> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const [highlight, setHighlight] = useState(false);

  useEffect(() => {
    apiFetch<RunSummary>(`/reconciliation-runs/${run.id}/summary`)
      .then(setSummary)
      .catch(() => setError('Ringkasan gagal dimuat.'));
  }, [run.id]);

  useEffect(() => {
    if (!canReadResults) return;
    const q = filter.kind === 'status' ? `&status=${filter.status}` : filter.kind === 'reason' ? `&reason=${filter.reason}` : '';
    apiFetch<Page<ResultGroup>>(`/reconciliation-runs/${run.id}/results?page=${page}&pageSize=${PAGE_SIZE}${q}`)
      .then(setResults)
      .catch((err) => setError(err instanceof ApiRequestError && err.status === 403 ? null : 'Rincian gagal dimuat.'));
  }, [run.id, filter, page, canReadResults]);

  if (error) return <p className="rounded-lg bg-red-50 p-4 text-sm text-red-800">{error}</p>;
  if (!summary) return <LoadingBlock label="Memuat hasil…" />;

  const toReview = summary.groups - summary.counts.MATCHED;
  const guides = REASON_GUIDE.filter((g) => (summary.byReason[g.reason] ?? 0) > 0);
  const choose = (f: Filter) => {
    setFilter(f);
    setPage(1);
  };
  const isActive = (f: Filter) => JSON.stringify(f) === JSON.stringify(filter);
  // Dari panduan tindak lanjut: filter tabel lalu gulir ke tabel dan sorot sebentar agar hasilnya terlihat.
  const showInTable = (f: Filter) => {
    choose(f);
    tableRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    setHighlight(true);
    window.setTimeout(() => setHighlight(false), 1600);
  };
  const pages = results ? Math.max(1, Math.ceil(results.total / PAGE_SIZE)) : 1;

  return (
    <section className="space-y-6" aria-label="Detail run">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Hasil pencocokan {run.unit?.code} · {run.accountId}
          </h2>
          <p className="text-sm text-slate-600">
            Toleransi {ruleTitle(run.ruleVersion)} · {formatDateTime(run.createdAt)}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ${summary.isCanonical ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-slate-100 text-slate-700 ring-slate-200'}`}>
          {summary.isCanonical ? 'Dipakai untuk laporan revenue' : 'Digantikan pencocokan yang lebih baru'}
        </span>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Tingkat kecocokan" value={formatPercent(summary.matchedRatioPercentDisplay)} hint={`${summary.counts.MATCHED} dari ${summary.groups} grup referensi cocok`} tone="good" />
        <Stat label="Revenue terverifikasi" value={formatRupiah(summary.verifiedRevenue)} hint="Nominal internal yang cocok dengan mutasi" tone="good" />
        <Stat label="Perlu ditindaklanjuti" value={`${toReview} grup`} hint={toReview === 0 ? 'Semua transaksi cocok' : 'Lihat daftar di bawah'} tone={toReview > 0 ? 'warn' : 'good'} />
      </div>

      {guides.length > 0 && (
        <div className="rounded-xl bg-white p-5 ring-1 ring-slate-200">
          <h3 className="text-base font-semibold text-slate-900">Yang perlu ditindaklanjuti</h3>
          <ul className="mt-3 divide-y divide-slate-100">
            {guides.map((g) => {
              const count = summary.byReason[g.reason];
              const f: Filter = { kind: 'reason', reason: g.reason };
              return (
                <li key={g.reason} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900">
                      <span className="mr-2 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-amber-100 px-1.5 text-xs font-semibold text-amber-900">{count}</span>
                      {g.title}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">{g.action}</p>
                  </div>
                  {canReadResults && (
                    <button
                      type="button"
                      onClick={() => showInTable(f)}
                      aria-pressed={isActive(f)}
                      className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold shadow-sm ${isActive(f) ? 'bg-slate-900 text-white' : 'bg-blue-700 text-white hover:bg-blue-800'}`}
                    >
                      {isActive(f) ? 'Ditampilkan di tabel ↓' : `Tampilkan ${count} transaksi ↓`}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="rounded-xl bg-white p-5 ring-1 ring-slate-200">
        <h3 className="text-base font-semibold text-slate-900">Nilai transaksi anomali</h3>
        <dl className="mt-3 grid gap-4 sm:grid-cols-3">
          {[
            ['Di catatan internal', summary.anomalousInternalTotal, 'Total nominal internal pada grup yang tidak cocok'],
            ['Di mutasi eksternal', summary.anomalousExternalTotal, 'Total nominal mutasi pada grup yang tidak cocok'],
            ['Selisih pasangan 1:1', summary.uniquePairAmountDifferenceTotal, 'Tidak termasuk data yang hilang & referensi ganda'],
          ].map(([label, value, hint]) => (
            <div key={label}>
              <dt className="text-xs font-medium text-slate-500">{label}</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{formatRupiah(value)}</dd>
              <dd className="text-xs text-slate-500">{hint}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">Ketiga angka ini dilihat terpisah dan tidak dijumlahkan sebagai kerugian.</p>
      </div>

      {canReadResults && results ? (
        <div ref={tableRef} className={`scroll-mt-24 rounded-xl bg-white ring-1 transition-shadow duration-500 ${highlight ? 'ring-2 ring-blue-500 shadow-lg shadow-blue-100' : 'ring-slate-200'}`}>
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-5 py-3" role="group" aria-label="Filter status">
            <span className="mr-1 text-sm font-semibold text-slate-900">Rincian transaksi</span>
            {[{ kind: 'all' } as Filter, ...STATUSES.map((s) => ({ kind: 'status', status: s }) as Filter)].map((f) => (
              <button
                key={JSON.stringify(f)}
                type="button"
                aria-pressed={isActive(f)}
                onClick={() => choose(f)}
                className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ${isActive(f) ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`}
              >
                {f.kind === 'all' ? `Semua (${summary.groups})` : f.kind === 'status' ? `${STATUS_LABEL[f.status]} (${summary.counts[f.status]})` : ''}
              </button>
            ))}
            {filter.kind === 'reason' && (
              <button type="button" onClick={() => choose({ kind: 'all' })} className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900">
                Hanya: {REASON_LABEL[filter.reason]} ✕
              </button>
            )}
          </div>
          <div className="relative overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Rincian hasil pencocokan</caption>
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Referensi</th>
                  <th className="px-5 py-2.5 font-medium">Hasil</th>
                  <th className="px-5 py-2.5 font-medium">Catatan internal</th>
                  <th className="px-5 py-2.5 font-medium">Mutasi eksternal</th>
                  <th className="px-5 py-2.5 text-right font-medium">Selisih</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {results.items.map((g) => (
                  <tr key={g.id} className="align-top">
                    <td className="px-5 py-3 font-mono text-xs text-slate-900">{g.reference}</td>
                    <td className="px-5 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${STATUS_STYLE[g.status]}`}>{STATUS_LABEL[g.status]}</span>
                      {g.reason && <p className="mt-1 text-xs text-slate-600">{REASON_LABEL[g.reason] ?? g.reason}</p>}
                    </td>
                    {[g.internal, g.external].map((side, i) => (
                      <td key={i} className="px-5 py-3 text-xs">
                        {side.length === 0 ? (
                          <span className="text-slate-400">Tidak ada</span>
                        ) : (
                          <ul className="space-y-1">
                            {side.map((t) => (
                              <li key={t.id}>
                                <span className="font-mono text-slate-900">{t.transactionId}</span>
                                <span className="block text-slate-600">
                                  {t.transactionDate} · <span className="tabular-nums">{formatRupiah(t.amount)}</span>
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    ))}
                    <td className="px-5 py-3 text-right text-xs tabular-nums">{g.amountDifference === null ? '—' : formatRupiah(g.amountDifference)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} pages={pages} onChange={setPage} className="border-t border-slate-200 px-5 py-3" />
        </div>
      ) : (
        !canReadResults && <p className="text-xs text-slate-500">Rincian per transaksi hanya tersedia untuk tim Finance dan Admin.</p>
      )}
    </section>
  );
}
