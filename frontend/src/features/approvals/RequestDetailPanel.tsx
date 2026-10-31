import { useCallback, useEffect, useState } from 'react';
import { LoadingBlock } from '../../components/Loading';
import { ApiRequestError, apiFetch } from '../../lib/api';
import { formatRupiah } from '../../lib/format';
import { ActionDialog, type ActionKind } from './ActionDialogs';
import { Icon, type IconName } from '../../components/Icon';
import { dateTime, EVENT, ROLE, STATUS, STATUS_UI, STEP_STATUS, waitingFor } from './labels';
import type { AuditItem, RequestDetail, StepStatus } from './types';

const STEP_UI: Record<StepStatus, { icon: IconName | null; circle: string }> = {
  WAITING: { icon: null, circle: 'bg-white text-slate-500 ring-2 ring-slate-300' },
  ACTIVE: { icon: 'clock', circle: 'bg-amber-400 text-white ring-4 ring-amber-100' },
  APPROVED: { icon: 'check', circle: 'bg-emerald-600 text-white' },
  REJECTED: { icon: 'close', circle: 'bg-rose-600 text-white' },
};

const EVENT_DOT: Record<string, string> = {
  SUBMITTED: 'bg-blue-600',
  APPROVED: 'bg-emerald-600',
  REJECTED: 'bg-rose-600',
  DELEGATED: 'bg-violet-600',
};

/** Detail pengajuan + tindakan. Tombol hanya muncul bila server menyatakan actor berhak (permissions). */
export function RequestDetailPanel({ id, onChanged }: { id: string; onChanged(): void }) {
  const [r, setR] = useState<RequestDetail | null>(null);
  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [action, setAction] = useState<ActionKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [detail, trail] = await Promise.all([apiFetch<RequestDetail>(`/approval-requests/${id}`), apiFetch<{ items: AuditItem[] }>(`/approval-requests/${id}/audit`)]);
      setR(detail);
      setAudit(trail.items);
    } catch {
      setLoadError('Pengajuan tidak ditemukan dalam akses Anda.');
    }
  }, [id]);

  useEffect(() => {
    setR(null);
    setNotice(null);
    void load();
  }, [load]);

  async function confirm(body: Record<string, string>) {
    if (!r || !action) return;
    setBusy(true);
    setError(null);
    const stepId = r.permissions.activeStepId;
    const path = action === 'submit' ? `/approval-requests/${r.id}/submit` : `/approval-requests/${r.id}/steps/${stepId}/${action}`;
    try {
      setR(await apiFetch<RequestDetail>(path, { method: 'POST', body: JSON.stringify(body) }));
      setAction(null);
      setNotice({ tone: 'ok', text: { submit: 'Pengajuan berhasil diajukan.', approve: 'Langkah disetujui.', reject: 'Pengajuan ditolak.', delegate: 'Langkah berhasil didelegasikan.' }[action] });
      onChanged();
      void load();
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 409) {
        // Status sudah berubah (mis. diputuskan orang lain): tutup dialog, jelaskan, muat ulang data terbaru.
        setAction(null);
        setNotice({ tone: 'warn', text: `${err.body.message}. Status terbaru sudah dimuat ulang.` });
        onChanged();
        await load();
      } else {
        setError(err instanceof ApiRequestError ? err.body.message : 'Tindakan gagal. Coba lagi.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <p className="rounded-2xl bg-white p-6 text-sm text-slate-600 ring-1 ring-slate-200">{loadError}</p>;
  if (!r) return <LoadingBlock label="Memuat pengajuan…" />;

  const s = STATUS[r.status];
  const waiting = waitingFor(r);
  const delegatedTo = (stepOrder: number) => r.history.filter((h) => h.action === 'DELEGATE' && h.stepOrder === stepOrder).at(-1)?.delegateTo;

  return (
    <section aria-label={`Pengajuan ${r.code ?? r.title}`} className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <span aria-hidden="true" className={`block h-1.5 ${STATUS_UI[r.status].bar}`} />
      <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${STATUS_UI[r.status].iconBox}`}>
            <Icon name={STATUS_UI[r.status].icon} className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
              {r.code && <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">{r.code}</span>}
              <span className="rounded bg-blue-50 px-1.5 py-0.5 font-medium text-blue-800">{r.unit.code}</span>
              <span>oleh {r.requester.email}</span>
            </p>
            <h2 className="mt-1 text-lg font-semibold text-slate-900">{r.title}</h2>
            <span className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${s.style}`}>{s.label}</span>
          </div>
        </div>
        <div className="rounded-xl bg-slate-50 px-4 py-3 text-right ring-1 ring-slate-200">
          <p className="text-xs font-medium text-slate-500">Nominal</p>
          <p className="text-2xl font-bold tabular-nums text-slate-900">{formatRupiah(r.amount)}</p>
        </div>
      </header>

      {notice && (
        <p role="status" className={`rounded-lg px-4 py-3 text-sm ring-1 ${notice.tone === 'ok' ? 'bg-emerald-50 text-emerald-900 ring-emerald-200' : 'bg-amber-50 text-amber-900 ring-amber-200'}`}>
          {notice.text}
        </p>
      )}

      <div className="rounded-xl border-l-4 border-blue-300 bg-slate-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Alasan pengajuan</p>
        <p className="mt-1 whitespace-pre-line text-sm text-slate-800">{r.reason || '—'}</p>
      </div>

      {waiting && (
        <p className="flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
          <Icon name="clock" className="h-4 w-4 shrink-0" />
          <span>
            Menunggu keputusan dari <strong>{waiting}</strong>
            {r.permissions.canDecide && ' — yaitu Anda.'}
          </span>
        </p>
      )}

      {r.steps.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Alur persetujuan</h3>
          <ol className="mt-3 grid gap-3 sm:grid-flow-col sm:auto-cols-fr" aria-label="Langkah persetujuan">
            {r.steps.map((st, i) => {
              const ui = STEP_UI[st.status];
              return (
                <li key={st.id} className={`relative rounded-xl p-4 ring-1 ${st.status === 'ACTIVE' ? 'bg-amber-50/60 ring-amber-200' : 'bg-white ring-slate-200'}`}>
                  {i < r.steps.length - 1 && <span aria-hidden="true" className="absolute -right-3 top-1/2 z-10 hidden h-0.5 w-3 bg-slate-300 sm:block" />}
                  <div className="flex items-start gap-3">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${ui.circle}`}>
                      {ui.icon ? <Icon name={ui.icon} className="h-4 w-4" /> : st.order}
                    </span>
                    <span className="min-w-0 text-sm">
                      <span className="font-semibold text-slate-900">Langkah {st.order}: {ROLE[st.role] ?? st.role}</span>
                      <span className="block text-xs font-medium text-slate-700">{STEP_STATUS[st.status]}</span>
                      <span className="block text-xs text-slate-500">
                        {st.decidedBy && `oleh ${st.decidedBy.email} · ${dateTime(st.decidedAt!)}`}
                        {st.assignee && st.status === 'ACTIVE' && `Didelegasikan ke ${st.assignee.email}`}
                        {!st.assignee && st.status !== 'ACTIVE' && delegatedTo(st.order) && ` · didelegasikan ke ${delegatedTo(st.order)}`}
                      </span>
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {(r.permissions.canSubmit || r.permissions.canDecide) && (
        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          {r.permissions.canSubmit && (
            <button type="button" onClick={() => { setError(null); setAction('submit'); }} className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-800">
              Ajukan
            </button>
          )}
          {r.permissions.canDecide && (
            <>
              <button type="button" onClick={() => { setError(null); setAction('approve'); }} className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800">
                <span className="inline-flex items-center gap-1.5"><Icon name="check" className="h-4 w-4" />Setujui</span>
              </button>
              <button type="button" onClick={() => { setError(null); setAction('reject'); }} className="rounded-lg border border-rose-300 bg-white px-4 py-2.5 text-sm font-semibold text-rose-700 shadow-sm hover:bg-rose-50">
                <span className="inline-flex items-center gap-1.5"><Icon name="close" className="h-4 w-4" />Tolak</span>
              </button>
              <button type="button" onClick={() => { setError(null); setAction('delegate'); }} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-100">
                <span className="inline-flex items-center gap-1.5"><Icon name="forward" className="h-4 w-4" />Delegasikan</span>
              </button>
            </>
          )}
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-slate-900">Riwayat</h3>
        <ol className="relative mt-3 space-y-4 before:absolute before:bottom-2 before:left-[7px] before:top-2 before:w-0.5 before:bg-slate-200" aria-label="Jejak audit">
          {audit.map((e) => (
            <li key={e.id} className="relative pl-7 text-sm">
              <span aria-hidden="true" className={`absolute left-0 top-1 h-4 w-4 rounded-full ring-4 ring-white ${EVENT_DOT[e.eventType] ?? 'bg-slate-400'}`} />
              <span className="font-medium text-slate-900">{EVENT[e.eventType] ?? e.eventType}</span>
              {typeof e.payload.stepOrder === 'number' && <span className="text-slate-600"> · langkah {e.payload.stepOrder}</span>}
              <span className="block text-xs text-slate-500">
                {e.actor ?? 'sistem'} · {dateTime(e.at)}
              </span>
              {typeof e.payload.comment === 'string' && e.payload.comment && (
                <span className="mt-1 block rounded-lg bg-slate-50 px-3 py-1.5 text-xs italic text-slate-700 ring-1 ring-slate-200">“{e.payload.comment}”</span>
              )}
            </li>
          ))}
        </ol>
      </div>

      </div>
      {action && <ActionDialog kind={action} request={r} busy={busy} error={error} onClose={() => setAction(null)} onConfirm={(b) => void confirm(b)} />}
    </section>
  );
}
