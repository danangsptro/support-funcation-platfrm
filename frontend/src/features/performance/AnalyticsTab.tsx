import { useEffect, useState } from 'react';
import { LoadingBlock } from '../../components/Loading';
import { LoadError } from '../../components/Pager';
import { apiFetch } from '../../lib/api';
import { formatRupiah } from '../../lib/format';
import { BarList } from './BarList';
import { formatNumber } from './format';
import type { Metrics, PerformanceResponse, RpeResponse, RpeUnit } from './types';

function TotalCard({ title, metrics, note }: { title: string; metrics: Metrics | null; note?: string }) {
  return (
    <div className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      {metrics ? (
        <dl className="mt-3 grid grid-cols-3 gap-3">
          <div>
            <dt className="text-xs text-slate-500">Revenue terverifikasi</dt>
            <dd className="mt-0.5 font-semibold tabular-nums">{formatRupiah(metrics.verifiedRevenue)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Rata-rata karyawan</dt>
            <dd className="mt-0.5 font-semibold tabular-nums">{formatNumber(metrics.averageHeadcount)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Revenue per karyawan</dt>
            <dd className="mt-0.5 font-semibold tabular-nums">{formatRupiah(metrics.rpe)}</dd>
          </div>
        </dl>
      ) : (
        <p className="mt-2 text-sm text-slate-600">{note}</p>
      )}
    </div>
  );
}

/** Cabang memakai subtotal (cabang + cost center di bawahnya). */
const branchMetrics = (u: RpeUnit) => u.subtotal ?? u.own;

export function AnalyticsTab({ periodId, canSeeScores }: { periodId: string; canSeeScores: boolean }) {
  const [rpe, setRpe] = useState<RpeResponse | null>(null);
  const [perf, setPerf] = useState<PerformanceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setError(null);
    setRpe(null);
    setPerf(null);
    apiFetch<RpeResponse>(`/analytics/revenue-per-employee?periodId=${periodId}`)
      .then(setRpe)
      .catch(() => setError('Analitik gagal dimuat.'));
    if (canSeeScores) apiFetch<PerformanceResponse>(`/analytics/performance?periodId=${periodId}`).then(setPerf).catch(() => undefined);
  }, [periodId, canSeeScores, attempt]);

  if (error) return <LoadError message={error} onRetry={() => setAttempt((n) => n + 1)} />;
  if (!rpe) return <LoadingBlock variant="page" label="Memuat analitik…" />;

  const divisions = rpe.units.filter((u) => u.unit.type === 'DIVISION');
  const branches = rpe.units.filter((u) => u.unit.type === 'BRANCH');
  const benchmarkRpe = branches.find((b) => b.benchmark?.parentRpe)?.benchmark?.parentRpe ?? null;
  const parentCode = branches.find((b) => b.benchmark)?.benchmark?.parentUnitId;
  const parentLabel = rpe.units.find((u) => u.unit.id === parentCode)?.unit.code ?? 'induk';
  const codeOf = (id: string) => rpe.units.find((u) => u.unit.id === id)?.unit.code ?? '';

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        {divisions.length === 0 ? (
          <TotalCard title="Total divisi" metrics={null} note="Benchmark divisi tidak tersedia untuk akses Anda. Angka di bawah hanya untuk cabang dalam cakupan Anda." />
        ) : (
          divisions.map((d) => (
            <TotalCard
              key={d.unit.id}
              title={`Total ${d.unit.name}`}
              metrics={d.subtotal}
              note="Total tidak ditampilkan karena sebagian unit di divisi ini berada di luar akses Anda."
            />
          ))
        )}
        {rpe.organizationTotal && <TotalCard title="Total organisasi" metrics={rpe.organizationTotal} />}
      </div>

      <BarList
        title="Revenue per karyawan per cabang"
        reference={benchmarkRpe ? { value: Number(benchmarkRpe), label: `${parentLabel} ${formatRupiah(benchmarkRpe)}` } : null}
        emptyText="Tidak ada cabang dalam cakupan Anda."
        bars={branches.map((b) => {
          const m = branchMetrics(b);
          return {
            key: b.unit.id,
            label: b.unit.code,
            value: m.rpe === null ? null : Number(m.rpe),
            display: m.rpe === null ? 'N/A' : formatRupiah(m.rpe).replace(/,00$/, ''),
            tooltip:
              m.rpe === null
                ? `${b.unit.code}: tidak ada karyawan di periode ini (RPE N/A)`
                : `${b.unit.code}: ${formatRupiah(m.verifiedRevenue)} ÷ ${formatNumber(m.averageHeadcount)} karyawan`,
          };
        })}
      />

      <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200" aria-label="Tabel revenue per karyawan">
        <div className="relative overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2.5 font-medium">Cabang</th>
                <th className="px-5 py-2.5 text-right font-medium">Revenue terverifikasi</th>
                <th className="px-5 py-2.5 text-right font-medium">Revenue tercatat</th>
                <th className="px-5 py-2.5 text-right font-medium">Rata-rata karyawan</th>
                <th className="px-5 py-2.5 text-right font-medium">RPE</th>
                <th className="px-5 py-2.5 text-right font-medium">Dibanding {parentLabel}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {branches.map((b) => {
                const m = branchMetrics(b);
                return (
                  <tr key={b.unit.id}>
                    <td className="px-5 py-2.5 font-medium text-slate-900">{b.unit.name === b.unit.code ? b.unit.code : `${b.unit.name} (${b.unit.code})`}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{formatRupiah(m.verifiedRevenue)}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-slate-600">{formatRupiah(m.recordedRevenue)}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{formatNumber(m.averageHeadcount)}</td>
                    <td className="px-5 py-2.5 text-right font-medium tabular-nums">{formatRupiah(m.rpe)}</td>
                    <td className="px-5 py-2.5 text-right text-xs tabular-nums">
                      {b.benchmark?.index
                        ? `${formatNumber(String(Number(b.benchmark.index) * 100), 0)}% (${Number(b.benchmark.difference) >= 0 ? '+' : '−'}${formatRupiah(String(Math.abs(Number(b.benchmark.difference))))})`
                        : b.benchmarkUnavailableReason === 'PARENT_OUT_OF_SCOPE'
                          ? 'Tidak tersedia'
                          : 'N/A'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
          RPE = revenue terverifikasi ÷ rata-rata karyawan (hari kerja karyawan ÷ hari periode). Revenue unit adalah sasaran bersama, bukan kontribusi individu.
          {rpe.branchSpread && ` Selisih RPE tertinggi (${codeOf(rpe.branchSpread.highest.unitId)}) dan terendah (${codeOf(rpe.branchSpread.lowest.unitId)}): ${formatRupiah(rpe.branchSpread.difference)}.`}
        </p>
      </section>

      {canSeeScores && perf && (
        <BarList
          title={`Distribusi skor review final (${perf.withinScope.count} karyawan dalam cakupan Anda)`}
          emptyText="Belum ada review yang difinalisasi pada periode ini."
          bars={
            perf.withinScope.count === 0
              ? []
              : perf.bands.map((band) => ({
                  key: band.key,
                  label: band.label,
                  value: perf.withinScope.bands[band.key],
                  display: `${perf.withinScope.bands[band.key]} orang`,
                  tooltip: `${perf.withinScope.bands[band.key]} karyawan dengan skor ${band.label}`,
                }))
          }
        />
      )}
      {canSeeScores && perf && perf.withinScope.count > 0 && (
        <p className="-mt-3 text-xs text-slate-500">
          Rata-rata {formatNumber(perf.withinScope.average)} · median {formatNumber(perf.withinScope.median)}. Hanya review final dalam cakupan Anda.
        </p>
      )}
    </div>
  );
}
