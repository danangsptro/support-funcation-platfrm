import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LoadingBlock } from '../../components/Loading';
import { LoadError } from '../../components/Pager';
import { ApiRequestError, apiFetch } from '../../lib/api';
import { useAuth } from '../auth/AuthContext';
import { NewReconciliation, type UnitOption } from './NewReconciliation';
import { RunDetail } from './RunDetail';
import { RunHistory, type UnitFilterOption } from './RunHistory';
import type { Dataset, Page, Run } from './types';

type Tab = 'baru' | 'hasil';
const PAGE_SIZE = 10;

/**
 * Dua tab: "Rekonsiliasi baru" (Finance) dan "Riwayat & hasil". Tab, filter cabang, halaman, dan run terpilih
 * ada di URL (?tab=hasil&unit=…&page=…&run=…). Riwayat dipaginasi & difilter di server; run terpilih yang tidak
 * ada di halaman aktif (mis. tautan ke run lama) diambil langsung lewat ID.
 */
export function ReconciliationPage() {
  const { can } = useAuth();
  const canCreate = can('dataset.import') && can('reconciliation.run');
  const canRead = can('reconciliation.read');
  const [params, setParams] = useSearchParams();
  const tab: Tab = canCreate && params.get('tab') !== 'hasil' ? 'baru' : 'hasil';
  const selectedId = params.get('run');
  const unitId = params.get('unit');
  const page = Math.max(1, Number(params.get('page')) || 1);

  const [units, setUnits] = useState<UnitOption[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [runs, setRuns] = useState<Page<Run> | null>(null);
  const [runsLoading, setRunsLoading] = useState(false);
  const [filterUnits, setFilterUnits] = useState<UnitFilterOption[]>([]);
  const [allTotal, setAllTotal] = useState<number | null>(null);
  const [linkedRun, setLinkedRun] = useState<Run | null>(null);
  const [linkedMissing, setLinkedMissing] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const runsSeq = useRef(0);
  const [refresh, setRefresh] = useState(0);

  const setQuery = (patch: Record<string, string | null>, replaceAll = false) => {
    const next = replaceAll ? new URLSearchParams() : new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next);
  };

  const loadDatasets = useCallback(async () => {
    if (canRead) setDatasets((await apiFetch<Page<Dataset>>('/datasets?pageSize=100')).items);
  }, [canRead]);

  // Daftar run untuk filter & halaman aktif. Respons yang datang terlambat (filter sudah berganti) diabaikan.
  const loadRuns = useCallback(async () => {
    const seq = ++runsSeq.current;
    setRunsLoading(true);
    const q = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (unitId) q.set('unitId', unitId);
    try {
      const res = await apiFetch<Page<Run>>(`/reconciliation-runs?${q}`);
      if (seq === runsSeq.current) setRuns(res);
    } finally {
      if (seq === runsSeq.current) setRunsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh memaksa muat ulang setelah run baru
  }, [page, unitId, refresh]);

  // Chip filter: total keseluruhan + jumlah per unit dalam scope (hanya unit yang punya run).
  const loadFilters = useCallback(async () => {
    const count = (unit?: string) => apiFetch<Page<Run>>(`/reconciliation-runs?page=1&pageSize=1${unit ? `&unitId=${unit}` : ''}`).then((r) => r.total);
    const scoped = await apiFetch<Page<UnitOption>>('/org-units?pageSize=100').then((u) => u.items).catch(() => [] as UnitOption[]);
    const [total, perUnit] = await Promise.all([count(), Promise.all(scoped.map(async (u) => ({ id: u.id, code: u.code, count: await count(u.id) })))]);
    setAllTotal(total);
    setFilterUnits(perUnit.filter((u) => u.count > 0).sort((a, b) => a.code.localeCompare(b.code)));
  }, []);

  const loadAll = useCallback(() => {
    setLoadError(null);
    Promise.all([
      canCreate ? apiFetch<Page<UnitOption>>('/org-units?pageSize=100').then((u) => setUnits(u.items)) : Promise.resolve(),
      loadDatasets(),
      loadFilters(),
    ]).catch(() => setLoadError('Data rekonsiliasi gagal dimuat.'));
  }, [canCreate, loadDatasets, loadFilters]);
  useEffect(loadAll, [loadAll]);

  useEffect(() => {
    loadRuns().catch(() => setLoadError('Riwayat pencocokan gagal dimuat.'));
  }, [loadRuns]);

  // Tautan langsung ke run yang tidak ada di halaman aktif → ambil detailnya lewat ID.
  const inPage = runs?.items.find((r) => r.id === selectedId) ?? null;
  useEffect(() => {
    setLinkedMissing(false);
    if (!selectedId || !runs || inPage) {
      setLinkedRun(null);
      return;
    }
    let active = true;
    apiFetch<Run>(`/reconciliation-runs/${selectedId}`)
      .then((r) => active && setLinkedRun(r))
      .catch((err) => active && err instanceof ApiRequestError && setLinkedMissing(true));
    return () => {
      active = false;
    };
  }, [selectedId, runs, inPage]);

  if (loadError) {
    return (
      <LoadError
        message={loadError}
        onRetry={() => {
          loadAll();
          loadRuns().catch(() => setLoadError('Riwayat pencocokan gagal dimuat.'));
        }}
      />
    );
  }

  const selected = inPage ?? (selectedId ? linkedRun : (runs?.items[0] ?? null));
  const tabClass = (t: Tab) =>
    `-mb-px border-b-2 px-4 py-2.5 text-sm font-medium ${tab === t ? 'border-blue-700 text-blue-800' : 'border-transparent text-slate-600 hover:text-slate-900'}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Rekonsiliasi transaksi</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Cocokkan catatan internal dengan mutasi bank atau pihak ketiga, lalu tindak lanjuti yang tidak cocok. Hanya cabang dalam akses Anda yang ditampilkan.
        </p>
      </div>

      {canCreate && (
        <div role="tablist" aria-label="Rekonsiliasi" className="flex border-b border-slate-200">
          <button type="button" role="tab" aria-selected={tab === 'baru'} className={tabClass('baru')} onClick={() => setQuery({}, true)}>
            Rekonsiliasi baru
          </button>
          <button type="button" role="tab" aria-selected={tab === 'hasil'} className={tabClass('hasil')} onClick={() => setQuery({ tab: 'hasil', run: selected?.id ?? null }, true)}>
            Riwayat & hasil{allTotal !== null ? ` (${allTotal})` : ''}
          </button>
        </div>
      )}

      {flash && tab === 'hasil' && (
        <p role="status" className="rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-900 ring-1 ring-blue-200">
          {flash}
        </p>
      )}

      {tab === 'baru' ? (
        units.length > 0 && (
          <NewReconciliation
            units={units}
            datasets={datasets}
            onDatasetsChanged={() => void loadDatasets()}
            onRunReady={(run, created) => {
              setFlash(
                created
                  ? 'Pencocokan selesai. Berikut hasilnya.'
                  : 'Data dan toleransi ini sudah pernah dicocokkan — hasil sebelumnya ditampilkan, tidak ada hasil ganda.',
              );
              void loadFilters();
              setRefresh((n) => n + 1);
              setQuery({ tab: 'hasil', run: run.id }, true);
            }}
          />
        )
      ) : runs === null ? (
        <LoadingBlock label="Memuat riwayat pencocokan…" />
      ) : (
        <div className="space-y-6">
          <RunHistory
            runs={runs.items}
            total={runs.total}
            page={page}
            pageSize={PAGE_SIZE}
            allTotal={allTotal}
            units={filterUnits}
            unitId={unitId}
            loading={runsLoading}
            selectedId={selected?.id ?? null}
            // Ganti filter → kembali ke halaman 1 dan lepas pilihan run lama.
            onUnit={(u) => setQuery({ unit: u, page: null, run: null })}
            onPage={(p) => setQuery({ page: String(p) })}
            onSelect={(r) => {
              setFlash(null);
              setQuery({ run: r.id });
              // Hasil ada di bawah daftar: gulir ke sana agar pergantian run langsung terlihat.
              window.requestAnimationFrame(() => detailRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }));
            }}
          />
          {selectedId && !inPage && linkedRun && (
            <p className="rounded-lg bg-slate-50 px-4 py-2.5 text-xs text-slate-600 ring-1 ring-slate-200">Run ini tidak ada di halaman riwayat yang sedang ditampilkan; hasilnya dibuka dari tautan.</p>
          )}
          {linkedMissing && <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">Hasil pencocokan dari tautan tidak ditemukan dalam akses Anda.</p>}
          <div ref={detailRef} className="scroll-mt-24">
            {selected && <RunDetail key={selected.id} run={selected} canReadResults={canRead} />}
          </div>
        </div>
      )}
    </div>
  );
}
