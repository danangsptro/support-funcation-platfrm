import Decimal from 'decimal.js';
import { formatRupiah } from '../../lib/format';
import type { IconName } from '../../components/Icon';
import type { ApprovalStatus, Options, StepStatus } from './types';

export const STATUS: Record<ApprovalStatus, { label: string; style: string }> = {
  DRAFT: { label: 'Draf', style: 'bg-slate-100 text-slate-700 ring-slate-200' },
  PENDING: { label: 'Menunggu persetujuan', style: 'bg-amber-50 text-amber-900 ring-amber-200' },
  APPROVED: { label: 'Disetujui', style: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
  REJECTED: { label: 'Ditolak', style: 'bg-rose-50 text-rose-800 ring-rose-200' },
};

/** Tampilan visual per status: ikon, warna aksen, dan latar ikon (identitas status selalu disertai teks). */
export const STATUS_UI: Record<ApprovalStatus, { icon: IconName; bar: string; iconBox: string }> = {
  DRAFT: { icon: 'doc', bar: 'bg-slate-300', iconBox: 'bg-slate-100 text-slate-600' },
  PENDING: { icon: 'clock', bar: 'bg-amber-400', iconBox: 'bg-amber-100 text-amber-700' },
  APPROVED: { icon: 'check', bar: 'bg-emerald-500', iconBox: 'bg-emerald-100 text-emerald-700' },
  REJECTED: { icon: 'close', bar: 'bg-rose-500', iconBox: 'bg-rose-100 text-rose-700' },
};

export const STEP_STATUS: Record<StepStatus, string> = {
  WAITING: 'Menunggu giliran',
  ACTIVE: 'Sedang menunggu keputusan',
  APPROVED: 'Disetujui',
  REJECTED: 'Ditolak',
};

export const ROLE: Record<string, string> = { MANAGER: 'Manager', FINANCE: 'Finance', HR: 'HR', ADMIN: 'Admin', REQUESTER: 'Pengaju' };

export const EVENT: Record<string, string> = {
  CREATED: 'Draf dibuat',
  DRAFT_UPDATED: 'Draf diubah',
  SUBMITTED: 'Diajukan',
  APPROVED: 'Disetujui',
  REJECTED: 'Ditolak',
  DELEGATED: 'Didelegasikan',
};

/** Langkah yang akan berlaku untuk nominal tertentu, dari konfigurasi workflow aktif. */
export function previewPath(workflow: Options['workflows'][number] | undefined, amount: string): string[] {
  if (!workflow || !/^\d+(\.\d{1,2})?$/.test(amount) || new Decimal(amount).lessThanOrEqualTo(0)) return [];
  return workflow.steps
    .filter((s) => s.conditionType === 'ALWAYS' || new Decimal(amount).greaterThan(s.conditionAmount ?? '0'))
    .map((s) => ROLE[s.role] ?? s.role);
}

export function describeRule(workflow: Options['workflows'][number] | undefined): string[] {
  if (!workflow) return [];
  return workflow.steps.map((s) =>
    s.conditionType === 'ALWAYS' ? `${ROLE[s.role] ?? s.role}: selalu` : `${ROLE[s.role] ?? s.role}: bila nominal di atas ${formatRupiah(s.conditionAmount)}`,
  );
}

export function waitingFor(r: { status: ApprovalStatus; activeStep: { role: string; assignee: { email: string } | null } | null; unit: { code: string } }): string | null {
  if (r.status !== 'PENDING' || !r.activeStep) return null;
  return r.activeStep.assignee ? r.activeStep.assignee.email : `${ROLE[r.activeStep.role] ?? r.activeStep.role} ${r.unit.code}`;
}

export const dateTime = (iso: string) => new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });

export const shortDate = (iso: string) => new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
