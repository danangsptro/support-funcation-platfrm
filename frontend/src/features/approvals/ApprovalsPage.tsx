import { useCallback, useEffect, useState } from 'react';
import { Spinner } from '../../components/Loading';
import { useSearchParams } from 'react-router-dom';
import { Icon, type IconName } from '../../components/Icon';
import { LoadError, Pager } from '../../components/Pager';
import { apiFetch } from '../../lib/api';
import { formatRupiah } from '../../lib/format';
import { useAuth } from '../auth/AuthContext';
import { shortDate, STATUS, STATUS_UI, waitingFor } from './labels';
import { NewRequestDialog } from './NewRequestDialog';
import { RequestDetailPanel } from './RequestDetailPanel';
import type { ApprovalStatus, RequestSummary } from './types';

type Tab = 'mine' | 'inbox' | 'all';
const PAGE_SIZE = 20;
const STATUSES = Object.keys(STATUS) as ApprovalStatus[];
type Counts = Partial<Record<ApprovalStatus | 'ALL', number>>;

/** Persetujuan anggaran. Tab, filter status, halaman & pengajuan terpilih ada di URL (?tab=inbox&status=…&page=2&id=…). */
export function ApprovalsPage() {
  const { can } = useAuth();
  const canRequest = can('approval.request.create');
  const canDecide = can('approval.decide');
  const canOversee = can('approval.oversight');
  const tabs: { key: Tab; label: string; icon: IconName }[] = [
    ...(canDecide ? [{ key: 'inbox' as const, label: 'Perlu tindakan saya', icon: 'inbox' as const }] : []),
    ...(canRequest ? [{ key: 'mine' as const, label: 'Pengajuan saya', icon: 'doc' as const }] : []),
    ...(canDecide || canOversee ? [{ key: 'all' as const, label: 'Semua pengajuan', icon: 'stack' as const }] : []),
  ];
  const [params, setParams] = useSearchParams();
  const tab = (tabs.find((t) => t.key === params.get('tab'))?.key ?? tabs[0]?.key ?? 'mine') as Tab;
  const selected = params.get('id');
  const status = STATUSES.find((st) => st === params.get('status')) ?? null;
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [items, setItems] = useState<RequestSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Counts>({});
  const [loadError, setLoadError] = useState(false);
  const [creating, setCreating] = useState(false);

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next);
  };

  // Status yang relevan per tab: draf hanya terlihat oleh pemiliknya; inbox selalu "menunggu".
  const filterStatuses = tab === 'inbox' ? [] : STATUSES.filter((st) => tab === 'mine' || st !== 'DRAFT');

  const load = useCallback(() => {
    setLoadError(false);
    const q = new URLSearchParams({ view: tab, page: String(page), pageSize: String(PAGE_SIZE) });
    if (status) q.set('status', status);
    apiFetch<{ items: RequestSummary[]; total: number }>(`/approval-requests?${q}`)
      .then((r) => {
        setItems(r.items);
        setTotal(r.total);
      })
      .catch(() => setLoadError(true));
  }, [tab, page, status]);
  useEffect(load, [load]);

  // Jumlah per status untuk kartu filter (total dari server, bukan hitungan halaman ini).
  const statusKey = filterStatuses.join(',');
  const loadCounts = useCallback(() => {
    if (!statusKey) {
      setCounts({});
      return;
    }
    const keys = ['ALL', ...statusKey.split(',')] as (ApprovalStatus | 'ALL')[];
    Promise.all(
      keys.map((k) =>
        apiFetch<{ total: number }>(`/approval-requests?view=${tab}&page=1&pageSize=1${k === 'ALL' ? '' : `&status=${k}`}`).then((r) => [k, r.total] as const),
      ),
    )
      .then((pairs) => setCounts(Object.fromEntries(pairs)))
      .catch(() => setCounts({}));
  }, [tab, statusKey]);
  useEffect(loadCounts, [loadCounts]);

  const reload = () => {
    load();
    loadCounts();
  };
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Persetujuan anggaran</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">Pengajuan sampai Rp10 juta cukup disetujui Manager; di atasnya dilanjutkan ke Finance. Setiap keputusan tercatat di jejak audit.</p>
        </div>
        {canRequest && (
          <button type="button" onClick={() => setCreating(true)} className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-800">
            + Pengajuan baru
          </button>
        )}
      </div>

      {tabs.length > 1 && (
        <div role="tablist" aria-label="Persetujuan" className="inline-flex flex-wrap gap-1 rounded-xl bg-slate-200/70 p-1">
          {tabs.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => set({ tab: t.key, id: null, page: null, status: null })}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${active ? 'bg-white text-blue-800 shadow-sm' : 'text-slate-600 hover:bg-white/60 hover:text-slate-900'}`}
              >
                <Icon name={t.icon} className="h-4 w-4" />
                {t.label}
                {t.key === 'inbox' && active && items ? <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-semibold text-white">{total}</span> : null}
              </button>
            );
          })}
        </div>
      )}

      {filterStatuses.length > 0 && (
        <div role="group" aria-label="Filter status" className={`grid grid-cols-2 gap-3 sm:grid-cols-3 ${filterStatuses.length === 4 ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
          <StatusCard label="Semua" icon="stack" iconBox="bg-blue-100 text-blue-700" count={counts.ALL} active={!status} onClick={() => set({ status: null, page: null, id: null })} />
          {filterStatuses.map((st) => (
            <StatusCard
              key={st}
              label={STATUS[st].label}
              icon={STATUS_UI[st].icon}
              iconBox={STATUS_UI[st].iconBox}
              count={counts[st]}
              active={status === st}
              onClick={() => set({ status: st, page: null, id: null })}
            />
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="self-start overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">{tab === 'inbox' ? 'Menunggu keputusan Anda' : status ? STATUS[status].label : 'Semua pengajuan'}</h2>
            {items && <span className="text-xs text-slate-500">{total} pengajuan</span>}
          </div>
          {loadError ? (
            <div className="p-4">
              <LoadError message="Daftar pengajuan gagal dimuat." onRetry={reload} />
            </div>
          ) : items === null ? (
            <>
              <p role="status" className="flex items-center gap-2 px-5 pt-4 text-sm text-slate-600">
                <Spinner className="h-4 w-4" />
                Memuat daftar pengajuan…
              </p>
              <ul aria-hidden="true" className="divide-y divide-slate-100">
              {[0, 1, 2].map((i) => (
                <li key={i} className="flex items-center gap-3 px-5 py-4">
                  <span className="h-9 w-9 animate-pulse rounded-lg bg-slate-200/80" />
                  <span className="flex-1 space-y-2">
                    <span className="block h-3.5 w-3/4 animate-pulse rounded bg-slate-200/80" />
                    <span className="block h-3 w-1/2 animate-pulse rounded bg-slate-200/80" />
                  </span>
                </li>
              ))}
              </ul>
            </>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                <Icon name={tab === 'inbox' ? 'check' : 'inbox'} className="h-6 w-6" />
              </span>
              <p className="text-sm text-slate-600">
                {tab === 'inbox' ? 'Tidak ada pengajuan yang menunggu keputusan Anda.' : status ? `Tidak ada pengajuan berstatus "${STATUS[status].label}".` : 'Belum ada pengajuan.'}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100" aria-label="Daftar pengajuan">
              {items.map((r) => (
                <RequestRow key={r.id} r={r} showRequester={tab !== 'mine'} active={r.id === selected} onSelect={() => set({ id: r.id })} />
              ))}
            </ul>
          )}
          <Pager page={page} pages={pages} onChange={(p) => set({ page: String(p), id: null })} className="border-t border-slate-100 px-4 py-3" />
        </div>
        {selected ? (
          <RequestDetailPanel key={selected} id={selected} onChanged={reload} />
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 self-start rounded-2xl border-2 border-dashed border-slate-300 bg-white/50 px-6 py-14 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-700">
              <Icon name="approval" className="h-6 w-6" />
            </span>
            <p className="max-w-xs text-sm text-slate-600">Pilih pengajuan untuk melihat detail, langkah, dan riwayatnya.</p>
          </div>
        )}
      </div>

      {creating && (
        <NewRequestDialog
          onClose={() => setCreating(false)}
          onCreated={(r) => {
            setCreating(false);
            set({ tab: 'mine', id: r.id, page: null, status: null });
            reload();
          }}
        />
      )}
    </div>
  );
}

function StatusCard({ label, icon, iconBox, count, active, onClick }: { label: string; icon: IconName; iconBox: string; count?: number; active: boolean; onClick(): void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex items-center gap-3 rounded-xl bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow ${active ? 'ring-2 ring-blue-600' : 'ring-1 ring-slate-200'}`}
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${iconBox}`}>
        <Icon name={icon} className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-xl font-semibold leading-tight tabular-nums text-slate-900">{count ?? '–'}</span>
        <span className="block truncate text-xs font-medium text-slate-600">{label}</span>
      </span>
    </button>
  );
}

function RequestRow({ r, showRequester, active, onSelect }: { r: RequestSummary; showRequester: boolean; active: boolean; onSelect(): void }) {
  const s = STATUS[r.status];
  const ui = STATUS_UI[r.status];
  const w = waitingFor(r);
  return (
    <li className="relative">
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${ui.bar}`} />
      <button type="button" onClick={onSelect} aria-current={active} className={`flex w-full items-start gap-3 py-3.5 pl-5 pr-4 text-left transition ${active ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
        <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${ui.iconBox}`}>
          <Icon name={ui.icon} className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-slate-900">{r.title}</span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            {r.code && <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">{r.code}</span>}
            <span className="rounded bg-blue-50 px-1.5 py-0.5 font-medium text-blue-800">{r.unit.code}</span>
            <span>{r.submittedAt ? `Diajukan ${shortDate(r.submittedAt)}` : `Dibuat ${shortDate(r.createdAt)}`}</span>
          </span>
          {showRequester && <span className="mt-1 block truncate text-xs text-slate-500">{r.requester.email}</span>}
          {w && (
            <span className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-amber-800">
              <Icon name="clock" className="h-3.5 w-3.5" />
              Menunggu: {w}
            </span>
          )}
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-sm font-bold tabular-nums text-slate-900">{formatRupiah(r.amount).replace(/,00$/, '')}</span>
          <span className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${s.style}`}>{s.label}</span>
        </span>
      </button>
    </li>
  );
}
