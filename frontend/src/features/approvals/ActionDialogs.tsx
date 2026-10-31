import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { apiFetch } from '../../lib/api';
import { formatRupiah } from '../../lib/format';
import { ROLE } from './labels';
import type { RequestDetail, UserRef } from './types';

export type ActionKind = 'submit' | 'approve' | 'reject' | 'delegate';

interface Props {
  kind: ActionKind;
  request: RequestDetail;
  busy: boolean;
  error: string | null;
  onClose(): void;
  onConfirm(body: Record<string, string>): void;
}

const TEXT: Record<ActionKind, { title: string; button: string; tone: string }> = {
  submit: { title: 'Ajukan untuk persetujuan?', button: 'Ya, ajukan', tone: 'bg-blue-700 hover:bg-blue-800' },
  approve: { title: 'Setujui langkah ini?', button: 'Ya, setujui', tone: 'bg-emerald-700 hover:bg-emerald-800' },
  reject: { title: 'Tolak pengajuan ini?', button: 'Ya, tolak', tone: 'bg-rose-700 hover:bg-rose-800' },
  delegate: { title: 'Delegasikan langkah ini', button: 'Delegasikan', tone: 'bg-blue-700 hover:bg-blue-800' },
};

/** Konfirmasi tindakan memakai Dialog yang sama (Esc, fokus kembali, tombol tegas). */
export function ActionDialog({ kind, request, busy, error, onClose, onConfirm }: Props) {
  const [comment, setComment] = useState('');
  const [toUserId, setToUserId] = useState('');
  const [candidates, setCandidates] = useState<UserRef[] | null>(null);
  const ids = { comment: useId(), to: useId() };
  const step = request.steps.find((s) => s.status === 'ACTIVE');

  useEffect(() => {
    if (kind !== 'delegate' || !step) return;
    apiFetch<{ items: UserRef[] }>(`/approval-requests/${request.id}/steps/${step.id}/delegates`)
      .then((r) => {
        setCandidates(r.items);
        setToUserId(r.items[0]?.id ?? '');
      })
      .catch(() => setCandidates([]));
  }, [kind, request.id, step]);

  const t = TEXT[kind];
  const needsComment = kind === 'reject';
  const disabled = busy || (needsComment && comment.trim().length < 3) || (kind === 'delegate' && !toUserId);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (disabled) return;
    const body: Record<string, string> = {};
    if (comment.trim()) body.comment = comment.trim();
    if (kind === 'delegate') body.toUserId = toUserId;
    onConfirm(body);
  }

  let explanation: ReactNode;
  if (kind === 'submit') {
    explanation = (
      <>
        Setelah diajukan, nominal {formatRupiah(request.amount)}, unit, dan alasan <strong>tidak bisa diubah</strong>.
      </>
    );
  } else if (kind === 'delegate') {
    explanation = <>Hak memutuskan langkah {step && (ROLE[step.role] ?? step.role)} berpindah ke penerima. Anda tidak bisa memutuskan langkah ini lagi.</>;
  } else {
    explanation = (
      <>
        {request.title} · {formatRupiah(request.amount)} · langkah {step?.order} ({step && (ROLE[step.role] ?? step.role)}). Keputusan tercatat permanen di jejak audit.
      </>
    );
  }

  return (
    <Dialog title={t.title} description={request.code ?? request.title} icon={<Icon name={kind === 'reject' ? 'alert' : kind === 'delegate' ? 'org' : 'check'} />} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="space-y-4 px-6 pb-6 pt-3">
          <p className="text-sm text-slate-700">{explanation}</p>
          {kind === 'delegate' && (
            <div>
              <label htmlFor={ids.to} className="text-sm font-medium text-slate-800">Penerima delegasi</label>
              {candidates === null ? (
                <p className="mt-1.5 text-sm text-slate-500">Memuat…</p>
              ) : candidates.length === 0 ? (
                <p className="mt-1.5 text-sm text-slate-600">Tidak ada pengguna lain yang berwenang untuk langkah ini.</p>
              ) : (
                <select id={ids.to} value={toUserId} onChange={(e) => setToUserId(e.target.value)} className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm">
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>{c.email}</option>
                  ))}
                </select>
              )}
              <p className="mt-1 text-xs text-slate-500">Hanya pengguna aktif dengan peran & cakupan yang sama; pengaju tidak bisa dipilih.</p>
            </div>
          )}
          {kind !== 'submit' && (
            <div>
              <label htmlFor={ids.comment} className="text-sm font-medium text-slate-800">
                {needsComment ? 'Alasan penolakan' : 'Catatan (opsional)'}
              </label>
              <textarea id={ids.comment} rows={3} autoFocus={kind !== 'delegate'} value={comment} onChange={(e) => setComment(e.target.value)} className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm" />
            </div>
          )}
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
          <button type="submit" disabled={disabled} className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:bg-slate-300 ${t.tone}`}>
            {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />}
            {busy ? 'Memproses…' : t.button}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
