import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from '../components/Icon';
import { useAuth } from '../features/auth/AuthContext';
import { describeScope, ROLE_LABEL } from '../features/auth/access-labels';
import { formatDateTime, ruleTitle } from '../features/reconciliation/labels';
import type { Page, Run, RunSummary } from '../features/reconciliation/types';
import { apiFetch } from '../lib/api';
import { formatPercent, formatRupiah } from '../lib/format';
import { displayName, greeting, todayLong } from '../lib/people';

interface Action {
  permission: string;
  title: string;
  text: string;
  to: string;
  cta: string;
  icon: IconName;
  accent: string;
  soon?: boolean;
}

/** Urut dari pekerjaan harian yang paling sering. Hanya yang diizinkan peran pengguna yang tampil. */
const ACTIONS: Action[] = [
  { permission: 'dataset.import', title: 'Rekonsiliasi baru', text: 'Unggah catatan internal dan mutasi bank, lalu cocokkan dalam tiga langkah.', to: '/reconciliation', cta: 'Mulai rekonsiliasi', icon: 'reconcile', accent: 'bg-blue-100 text-blue-700' },
  { permission: 'reconciliation.summary.read', title: 'Hasil rekonsiliasi', text: 'Tingkat kecocokan, revenue terverifikasi, dan transaksi yang perlu ditindaklanjuti.', to: '/reconciliation?tab=hasil', cta: 'Lihat hasil', icon: 'chart', accent: 'bg-emerald-100 text-emerald-700' },
  { permission: 'review.manage', title: 'Review karyawan', text: 'Atur KPI, lihat skor sementara, lalu finalisasi review periode ini.', to: '/performance?tab=review', cta: 'Kelola review', icon: 'approval', accent: 'bg-amber-100 text-amber-700' },
  { permission: 'analytics.rpe.read', title: 'Performa & revenue per karyawan', text: 'Revenue per karyawan tiap cabang dan distribusi skor review.', to: '/performance', cta: 'Lihat analitik', icon: 'chart', accent: 'bg-sky-100 text-sky-700' },
  { permission: 'org.read', title: 'Organisasi', text: 'Unit kerja dan karyawan dalam cakupan Anda.', to: '/organization', cta: 'Lihat organisasi', icon: 'org', accent: 'bg-violet-100 text-violet-700' },
  { permission: 'approval.decide', title: 'Perlu persetujuan Anda', text: 'Pengajuan anggaran yang menunggu keputusan Anda.', to: '/approvals?tab=inbox', cta: 'Buka inbox', icon: 'approval', accent: 'bg-amber-100 text-amber-700' },
  { permission: 'approval.request.create', title: 'Ajukan anggaran', text: 'Buat pengajuan dan pantau status persetujuannya.', to: '/approvals?tab=mine', cta: 'Pengajuan saya', icon: 'approval', accent: 'bg-blue-100 text-blue-700' },
  { permission: 'approval.oversight', title: 'Pantau persetujuan', text: 'Lihat seluruh pengajuan dan jejak auditnya (tanpa hak memutuskan).', to: '/approvals?tab=all', cta: 'Lihat pengajuan', icon: 'approval', accent: 'bg-slate-100 text-slate-700' },
];

/** Ringkasan rekonsiliasi terbaru yang dipakai laporan (bila pengguna berhak). */
function LatestReconciliation() {
  const [state, setState] = useState<{ run: Run; summary: RunSummary } | 'empty' | 'error' | null>(null);

  useEffect(() => {
    let active = true;
    apiFetch<Page<Run>>('/reconciliation-runs?pageSize=20')
      .then(async (runs) => {
        const run = runs.items.find((r) => r.isCanonical) ?? runs.items[0];
        if (!run) return active && setState('empty');
        const summary = await apiFetch<RunSummary>(`/reconciliation-runs/${run.id}/summary`);
        if (active) setState({ run, summary });
      })
      .catch(() => active && setState('error'));
    return () => {
      active = false;
    };
  }, []);

  if (state === null) return <div className="h-40 animate-pulse rounded-2xl bg-white ring-1 ring-slate-200" aria-label="Memuat ringkasan" />;
  if (state === 'error') return null;
  if (state === 'empty') {
    return (
      <section className="rounded-2xl bg-white p-6 ring-1 ring-slate-200">
        <h2 className="text-base font-semibold text-slate-900">Rekonsiliasi terakhir</h2>
        <p className="mt-1 text-sm text-slate-600">Belum ada hasil pencocokan dalam cakupan Anda.</p>
      </section>
    );
  }
  const { run, summary } = state;
  const toReview = summary.groups - summary.counts.MATCHED;
  const stats = [
    { label: 'Tingkat kecocokan', value: formatPercent(summary.matchedRatioPercentDisplay), hint: `${summary.counts.MATCHED} dari ${summary.groups} grup cocok` },
    { label: 'Revenue terverifikasi', value: formatRupiah(summary.verifiedRevenue), hint: 'Siap dipakai laporan' },
    { label: 'Perlu ditindaklanjuti', value: `${toReview} grup`, hint: toReview ? 'Lihat panduan tindak lanjut' : 'Semua cocok', warn: toReview > 0 },
  ];
  return (
    <section aria-labelledby="latest-title" className="rounded-2xl bg-white p-6 ring-1 ring-slate-200">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="latest-title" className="text-base font-semibold text-slate-900">
            Rekonsiliasi terakhir
          </h2>
          <p className="mt-0.5 text-sm text-slate-600">
            {run.unit?.code} · {run.accountId} · toleransi {ruleTitle(run.ruleVersion)} · {formatDateTime(run.createdAt)}
          </p>
        </div>
        <Link
          to={`/reconciliation?tab=hasil&run=${run.id}`}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50"
        >
          Lihat detail <Icon name="arrow" className="h-4 w-4" />
        </Link>
      </div>
      <dl className="mt-5 grid gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className={`rounded-xl p-4 ${s.warn ? 'bg-amber-50 ring-1 ring-amber-200' : 'bg-slate-50'}`}>
            <dt className="text-xs font-medium text-slate-500">{s.label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{s.value}</dd>
            <dd className="mt-0.5 text-xs text-slate-500">{s.hint}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function HomePage() {
  const { user, can } = useAuth();
  const grants = user?.grants ?? [];
  const actions = ACTIONS.filter((a) => can(a.permission));
  const roles = [...new Set(grants.map((g) => ROLE_LABEL[g.role]))];

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-700 via-blue-800 to-slate-900 px-6 py-7 text-white shadow-sm sm:px-8">
        <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
        <p className="flex items-center gap-2 text-sm text-blue-100">
          <Icon name="calendar" className="h-4 w-4" />
          {todayLong()}
        </p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
          {greeting()}, {displayName(user?.email)}
        </h1>
        <p className="mt-1 text-sm text-blue-100">Selamat datang di Support Function Platform.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          {grants.length === 0 ? (
            <span className="rounded-full bg-white/15 px-3 py-1 text-xs">Belum ada peran</span>
          ) : (
            roles.map((r) => (
              <span key={r} className="rounded-full bg-white/15 px-3 py-1 text-xs font-medium ring-1 ring-white/20">
                {r}
              </span>
            ))
          )}
        </div>
      </section>

      {can('reconciliation.summary.read') && <LatestReconciliation />}

      {actions.length > 0 && (
        <section aria-labelledby="actions-title">
          <h2 id="actions-title" className="text-base font-semibold text-slate-900">
            Apa yang bisa Anda lakukan
          </h2>
          <ul className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {actions.map((a) => (
              <li key={a.title}>
                <Link
                  to={a.to}
                  className={`group flex h-full flex-col rounded-2xl bg-white p-5 ring-1 transition ${
                    a.soon ? 'ring-slate-200 hover:ring-slate-300' : 'ring-slate-200 hover:-translate-y-0.5 hover:shadow-md hover:ring-blue-300'
                  }`}
                >
                  <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${a.accent}`}>
                    <Icon name={a.icon} />
                  </span>
                  <span className="mt-4 flex items-center gap-2 font-semibold text-slate-900">
                    {a.title}
                    {a.soon && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Segera</span>}
                  </span>
                  <span className={`mt-1 flex-1 text-sm ${a.soon ? 'text-slate-500' : 'text-slate-600'}`}>{a.text}</span>
                  <span className={`mt-4 flex items-center gap-1.5 text-sm font-medium ${a.soon ? 'text-slate-500' : 'text-blue-700'}`}>
                    {a.cta}
                    <Icon name="arrow" className="h-4 w-4 transition group-hover:translate-x-0.5" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="access-title" className="rounded-2xl bg-white p-6 ring-1 ring-slate-200">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
            <Icon name="shield" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="access-title" className="text-base font-semibold text-slate-900">
              Akses Anda
            </h2>
            {grants.length === 0 ? (
              <p className="mt-1 text-sm text-slate-600">
                Akun ini belum memiliki peran atau cakupan data. Hubungi admin organisasi untuk meminta akses.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {grants.map((g, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-800 ring-1 ring-blue-200">{ROLE_LABEL[g.role]}</span>
                    <span className="text-slate-700">{describeScope(g)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-slate-500">Semua data, angka ringkasan, dan tindakan otomatis dibatasi pada cakupan ini.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
