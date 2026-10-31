import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ApprovalActionType, ApprovalStatus, Prisma, Role } from '@prisma/client';
import { AppException } from '../../common/app-exception';
import { Page, pageArgs } from '../../common/pagination';
import { PrismaService } from '../../database/prisma.service';
import type { Actor } from '../access/actor';
import { Permission, roleHasPermission } from '../access/permissions';
import { AccessScope, notFound, ScopeService } from '../access/scope.service';
import { AuditService } from '../audit/audit.service';
import { CreateRequestBody, DelegateBody, ListRequestsQuery, UpdateRequestBody } from './dto';
import { buildSnapshot, WorkflowSnapshot } from './workflow';

type Tx = Prisma.TransactionClient;

/** Titik injeksi untuk test (kegagalan sebelum commit, koordinasi race). Produksi: objek kosong. */
export interface ApprovalHooks {
  beforeCommit?(event: { kind: 'SUBMIT' | 'APPROVE' | 'REJECT' | 'DELEGATE'; requestId: string }): Promise<void> | void;
}
export const APPROVAL_HOOKS = Symbol('APPROVAL_HOOKS');

const WORKFLOW_TYPE = 'BUDGET';
const DECIDER_ROLES: Role[] = (Object.values(Role) as Role[]).filter((r) => roleHasPermission(r, Permission.ApprovalDecide));

const requestInclude = {
  unit: { select: { id: true, externalKey: true, name: true } },
  requester: { select: { id: true, email: true } },
  steps: {
    orderBy: { stepOrder: 'asc' },
    include: { assignee: { select: { id: true, email: true } }, decider: { select: { id: true, email: true } } },
  },
} satisfies Prisma.ApprovalRequestInclude;

type RequestRow = Prisma.ApprovalRequestGetPayload<{ include: typeof requestInclude }>;
type StepRow = RequestRow['steps'][number];

interface Scopes {
  own: AccessScope;
  oversight: AccessScope;
  byRole: Map<Role, AccessScope>;
}

function conflict(code: string, message: string) {
  return new AppException(HttpStatus.CONFLICT, code, message);
}
function forbidden(code: string, message: string) {
  return new AppException(HttpStatus.FORBIDDEN, code, message);
}

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: ScopeService,
    private readonly audit: AuditService,
    @Inject(APPROVAL_HOOKS) private readonly hooks: ApprovalHooks,
  ) {}

  // ---------- Akses ----------

  /** Semua scope dihitung server dari grant actor; role tetap terikat pada scope grant-nya. */
  private async scopesFor(actor: Actor): Promise<Scopes> {
    const byRole = new Map<Role, AccessScope>();
    for (const role of DECIDER_ROLES) byRole.set(role, await this.scopes.resolveForRole(actor, role));
    return {
      own: await this.scopes.resolve(actor, Permission.ApprovalRequestCreate),
      oversight: await this.scopes.resolve(actor, Permission.ApprovalOversight),
      byRole,
    };
  }

  /**
   * Boleh melihat bila: (a) pengaju sendiri & masih punya grant pengaju atas unitnya; (b) oversight eksplisit
   * (ADMIN) dan sudah disubmit; atau (c) reviewer: sudah disubmit dan ada langkah ber-role R yang scope grant R
   * actor mencakup unit. Draft orang lain tidak pernah terlihat.
   */
  private canView(actor: Actor, s: Scopes, r: Pick<RequestRow, 'requesterUserId' | 'unitId' | 'status'> & { steps: Pick<StepRow, 'role'>[] }): boolean {
    if (r.requesterUserId === actor.userId && s.own.hasUnit(r.unitId)) return true;
    if (r.status === 'DRAFT') return false;
    if (s.oversight.hasUnit(r.unitId)) return true;
    return r.steps.some((st) => s.byRole.get(st.role)?.hasUnit(r.unitId));
  }

  /** Kelayakan bertindak pada langkah aktif (dicek ulang di dalam transaksi setelah lock). */
  private async assertCanAct(actor: Actor, r: Pick<RequestRow, 'requesterUserId' | 'unitId'>, step: Pick<StepRow, 'role' | 'assigneeUserId'>) {
    if (r.requesterUserId === actor.userId) throw forbidden('SELF_APPROVAL_FORBIDDEN', 'Pengaju tidak boleh memutuskan pengajuannya sendiri');
    if (step.assigneeUserId && step.assigneeUserId !== actor.userId) {
      throw forbidden('NOT_ASSIGNEE', 'Langkah ini sudah didelegasikan kepada orang lain');
    }
    const scope = await this.scopes.resolveForRole(actor, step.role);
    if (!roleHasPermission(step.role, Permission.ApprovalDecide) || !scope.hasUnit(r.unitId)) {
      throw forbidden('NOT_ELIGIBLE', 'Anda tidak berwenang memutuskan langkah ini');
    }
  }

  // ---------- Opsi form ----------

  async options(actor: Actor) {
    const own = await this.scopes.resolve(actor, Permission.ApprovalRequestCreate);
    const units = await this.prisma.orgUnit.findMany({
      where: { id: { in: own.unitIds } },
      select: { id: true, externalKey: true, name: true, type: true, organizationId: true },
      orderBy: { externalKey: 'asc' },
    });
    const workflows = await this.prisma.workflowDefinition.findMany({
      where: { organizationId: { in: own.organizationIds }, type: WORKFLOW_TYPE, active: true },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    });
    return {
      units: units.map((u) => ({ id: u.id, code: u.externalKey, name: u.name, type: u.type, organizationId: u.organizationId })),
      workflows: workflows.map((w) => ({
        organizationId: w.organizationId,
        key: w.externalKey,
        version: w.version,
        steps: w.steps.map((s) => ({ order: s.stepOrder, role: s.role, conditionType: s.conditionType, conditionAmount: s.conditionAmount?.toString() ?? null })),
      })),
    };
  }

  // ---------- Draft ----------

  async create(actor: Actor, body: CreateRequestBody, traceId?: string) {
    const own = await this.scopes.resolve(actor, Permission.ApprovalRequestCreate);
    if (!own.hasUnit(body.unitId)) throw notFound('Unit');
    const unit = await this.prisma.orgUnit.findUniqueOrThrow({ where: { id: body.unitId } });
    const workflow = await this.activeWorkflow(this.prisma, unit.organizationId);
    const id = await this.prisma.$transaction(async (tx) => {
      const r = await tx.approvalRequest.create({
        data: {
          organizationId: unit.organizationId,
          unitId: unit.id,
          requesterUserId: actor.userId,
          workflowId: workflow.id,
          title: body.title,
          reason: body.reason,
          amount: new Prisma.Decimal(body.amount),
          currency: 'IDR',
        },
      });
      await this.record(tx, r.organizationId, r.id, actor, 'CREATED', { amount: body.amount, unitId: unit.id, title: body.title }, traceId);
      return r.id;
    });
    return this.detail(actor, id);
  }

  async update(actor: Actor, id: string, body: UpdateRequestBody, traceId?: string) {
    const own = await this.scopes.resolve(actor, Permission.ApprovalRequestCreate);
    if (body.unitId && !own.hasUnit(body.unitId)) throw notFound('Unit');
    await this.prisma.$transaction(async (tx) => {
      const r = await this.lockRequest(tx, id);
      if (!r || r.requesterUserId !== actor.userId || !own.hasUnit(r.unitId)) throw notFound('Pengajuan');
      if (r.status !== 'DRAFT') throw conflict('REQUEST_NOT_DRAFT', 'Pengajuan sudah disubmit; nominal, unit, dan alasan tidak bisa diubah');
      if (body.unitId) {
        const unit = await tx.orgUnit.findUniqueOrThrow({ where: { id: body.unitId } });
        if (unit.organizationId !== r.organizationId) throw notFound('Unit');
      }
      const before = { title: r.title, reason: r.reason, amount: r.amount.toString(), unitId: r.unitId };
      await tx.approvalRequest.update({
        where: { id },
        data: {
          title: body.title,
          reason: body.reason,
          unitId: body.unitId,
          amount: body.amount !== undefined ? new Prisma.Decimal(body.amount) : undefined,
          version: { increment: 1 },
        },
      });
      await this.record(tx, r.organizationId, id, actor, 'DRAFT_UPDATED', { before, after: { ...body } }, traceId);
    });
    return this.detail(actor, id);
  }

  // ---------- Submit ----------

  /**
   * Lock request → pastikan masih DRAFT milik actor → ambil workflow aktif → snapshot versi & langkah →
   * buat langkah (yang pertama ACTIVE) → PENDING → audit, satu transaksi. Submit paralel: yang kedua
   * menunggu lock lalu 409; unique (request, step_order) & "satu langkah ACTIVE" sebagai jaring kedua.
   */
  async submit(actor: Actor, id: string, traceId?: string) {
    const own = await this.scopes.resolve(actor, Permission.ApprovalRequestCreate);
    await this.prisma.$transaction(
      async (tx) => {
        const r = await this.lockRequest(tx, id);
        if (!r || r.requesterUserId !== actor.userId || !own.hasUnit(r.unitId)) throw notFound('Pengajuan');
        if (r.status !== 'DRAFT') throw conflict('REQUEST_ALREADY_SUBMITTED', 'Pengajuan ini sudah disubmit');
        const workflow = await this.activeWorkflow(tx, r.organizationId);
        const snapshot = buildSnapshot(
          { id: workflow.id, key: workflow.externalKey, version: workflow.version, type: workflow.type },
          workflow.steps.map((s) => ({
            workflowStepId: s.id,
            order: s.stepOrder,
            role: s.role,
            conditionType: s.conditionType,
            conditionAmount: s.conditionAmount?.toString() ?? null,
          })),
          r.amount.toString(),
        );
        const applicable = snapshot.steps.filter((s) => s.applies);
        if (applicable.length === 0) throw conflict('WORKFLOW_NOT_APPLICABLE', 'Tidak ada langkah persetujuan yang berlaku untuk nominal ini');
        await tx.approvalStep.createMany({
          data: applicable.map((s, i) => ({ requestId: id, workflowStepId: s.workflowStepId, stepOrder: s.order, role: s.role, status: i === 0 ? 'ACTIVE' : 'WAITING' })),
        });
        await tx.approvalRequest.update({
          where: { id },
          data: {
            status: 'PENDING',
            workflowId: workflow.id,
            workflowSnapshot: snapshot as unknown as Prisma.InputJsonValue,
            submittedAt: new Date(),
            currentStepOrder: applicable[0].order,
            version: { increment: 1 },
          },
        });
        await this.record(tx, r.organizationId, id, actor, 'SUBMITTED', { amount: r.amount.toString(), workflow: `${workflow.externalKey} v${workflow.version}`, steps: applicable.map((s) => s.role) }, traceId);
        await this.hooks.beforeCommit?.({ kind: 'SUBMIT', requestId: id });
      },
      { timeout: 30_000 },
    );
    return this.detail(actor, id);
  }

  // ---------- Keputusan ----------

  async approve(actor: Actor, id: string, stepId: string, comment: string | undefined, traceId?: string) {
    return this.decide(actor, id, stepId, 'APPROVE', comment, traceId);
  }

  async reject(actor: Actor, id: string, stepId: string, comment: string, traceId?: string) {
    return this.decide(actor, id, stepId, 'REJECT', comment, traceId);
  }

  /**
   * 1 lock request (FOR UPDATE) → 2 lock & baca ulang langkah → 3 validasi visibilitas (404), stepId (404),
   * state (409: tidak PENDING / langkah tidak aktif = stepId lama atau mendahului), kelayakan (403) →
   * 4 simpan keputusan (unique: satu keputusan terminal per langkah) → 5 majukan langkah / status akhir →
   * 6 audit → 7 commit. Semua dalam satu transaksi.
   */
  private async decide(actor: Actor, id: string, stepId: string, action: 'APPROVE' | 'REJECT', comment: string | undefined, traceId?: string) {
    const scopes = await this.scopesFor(actor);
    await this.prisma.$transaction(
      async (tx) => {
        const { r, steps, step } = await this.lockForAction(tx, actor, scopes, id, stepId);
        await this.assertCanAct(actor, r, step);
        await tx.approvalAction.create({
          data: { stepId, requestId: id, actorUserId: actor.userId, action: action as ApprovalActionType, comment: comment || null },
        });
        const now = new Date();
        await tx.approvalStep.update({
          where: { id: stepId },
          data: { status: action === 'APPROVE' ? 'APPROVED' : 'REJECTED', decidedBy: actor.userId, decidedAt: now },
        });
        const next = steps.find((s) => s.stepOrder > step.stepOrder && s.status === 'WAITING');
        let toStatus: ApprovalStatus = 'PENDING';
        if (action === 'APPROVE' && next) {
          await tx.approvalStep.update({ where: { id: next.id }, data: { status: 'ACTIVE' } });
          await tx.approvalRequest.update({ where: { id }, data: { currentStepOrder: next.stepOrder, version: { increment: 1 } } });
        } else {
          toStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
          await tx.approvalRequest.update({ where: { id }, data: { status: toStatus, currentStepOrder: null, decidedAt: now, version: { increment: 1 } } });
        }
        await this.record(
          tx,
          r.organizationId,
          id,
          actor,
          action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
          { stepId, stepOrder: step.stepOrder, role: step.role, comment: comment || null, fromStatus: 'PENDING', toStatus, nextStepOrder: action === 'APPROVE' ? (next?.stepOrder ?? null) : null },
          traceId,
        );
        await this.hooks.beforeCommit?.({ kind: action, requestId: id });
      },
      { timeout: 30_000 },
    );
    return this.detail(actor, id);
  }

  /**
   * Delegasi memakai lock yang sama dengan keputusan. Pendelegasi harus berhak bertindak sekarang; penerima
   * harus aktif, punya grant role langkah yang scope-nya mencakup unit, bukan pengaju, bukan dirinya sendiri.
   * Langkah tetap ACTIVE; hak bertindak berpindah ke penerima. Tidak ada grant yang ditambahkan.
   */
  async delegate(actor: Actor, id: string, stepId: string, body: DelegateBody, traceId?: string) {
    const scopes = await this.scopesFor(actor);
    await this.prisma.$transaction(
      async (tx) => {
        const { r, step } = await this.lockForAction(tx, actor, scopes, id, stepId);
        await this.assertCanAct(actor, r, step);
        await this.assertValidDelegate(tx, r, step, body.toUserId, actor.userId);
        await tx.approvalAction.create({
          data: { stepId, requestId: id, actorUserId: actor.userId, action: 'DELEGATE', delegateToUserId: body.toUserId, comment: body.comment || null },
        });
        await tx.approvalStep.update({ where: { id: stepId }, data: { assigneeUserId: body.toUserId } });
        await tx.approvalRequest.update({ where: { id }, data: { version: { increment: 1 } } });
        await this.record(
          tx,
          r.organizationId,
          id,
          actor,
          'DELEGATED',
          { stepId, stepOrder: step.stepOrder, role: step.role, fromAssignee: step.assigneeUserId, toUserId: body.toUserId, comment: body.comment || null },
          traceId,
        );
        await this.hooks.beforeCommit?.({ kind: 'DELEGATE', requestId: id });
      },
      { timeout: 30_000 },
    );
    return this.detail(actor, id);
  }

  /** Calon penerima delegasi — hanya untuk actor yang berhak bertindak pada langkah aktif saat ini. */
  async delegates(actor: Actor, id: string, stepId: string) {
    const scopes = await this.scopesFor(actor);
    const r = await this.prisma.approvalRequest.findUnique({ where: { id }, include: requestInclude });
    if (!r || !this.canView(actor, scopes, r)) throw notFound('Pengajuan');
    const step = r.steps.find((s) => s.id === stepId);
    if (!step) throw notFound('Langkah');
    if (r.status !== 'PENDING' || step.status !== 'ACTIVE') throw conflict('STEP_NOT_ACTIVE', 'Langkah ini tidak sedang aktif');
    await this.assertCanAct(actor, r, step);
    const users = await this.eligibleUsers(this.prisma, r, step.role);
    return {
      items: users
        .filter((u) => u.id !== actor.userId && u.id !== r.requesterUserId && u.id !== step.assigneeUserId)
        .map((u) => ({ id: u.id, email: u.email })),
    };
  }

  // ---------- Baca ----------

  async list(actor: Actor, q: ListRequestsQuery): Promise<Page<ReturnType<ApprovalsService['summary']>>> {
    const s = await this.scopesFor(actor);
    const own: Prisma.ApprovalRequestWhereInput = { requesterUserId: actor.userId, unitId: { in: s.own.unitIds } };
    const reviewer = [...s.byRole.entries()]
      .filter(([, scope]) => !scope.isEmpty)
      .map(([role, scope]): Prisma.ApprovalRequestWhereInput => ({ status: { not: 'DRAFT' }, unitId: { in: scope.unitIds }, steps: { some: { role } } }));
    const inbox = [...s.byRole.entries()]
      .filter(([, scope]) => !scope.isEmpty)
      .map(([role, scope]): Prisma.ApprovalRequestWhereInput => ({
        status: 'PENDING',
        unitId: { in: scope.unitIds },
        requesterUserId: { not: actor.userId },
        steps: { some: { role, status: 'ACTIVE', OR: [{ assigneeUserId: null }, { assigneeUserId: actor.userId }] } },
      }));
    const visible: Prisma.ApprovalRequestWhereInput[] = [own, { status: { not: 'DRAFT' }, unitId: { in: s.oversight.unitIds } }, ...reviewer];
    const base: Prisma.ApprovalRequestWhereInput =
      q.view === 'mine' ? own : q.view === 'inbox' ? { OR: inbox.length ? inbox : [{ id: { in: [] } }] } : { OR: visible };
    const where: Prisma.ApprovalRequestWhereInput = { AND: [base, q.status ? { status: q.status } : {}] };
    const [rows, total] = await Promise.all([
      this.prisma.approvalRequest.findMany({ where, include: requestInclude, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], ...pageArgs(q) }),
      this.prisma.approvalRequest.count({ where }),
    ]);
    return { items: rows.map((r) => this.summary(r)), page: q.page, pageSize: q.pageSize, total };
  }

  async detail(actor: Actor, id: string) {
    const s = await this.scopesFor(actor);
    const r = await this.prisma.approvalRequest.findUnique({ where: { id }, include: requestInclude });
    if (!r || !this.canView(actor, s, r)) throw notFound('Pengajuan');
    const actions = await this.prisma.approvalAction.findMany({
      where: { requestId: id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { actor: { select: { email: true } }, delegateTo: { select: { email: true } }, step: { select: { stepOrder: true } } },
    });
    const active = r.steps.find((st) => st.status === 'ACTIVE');
    let canAct = false;
    if (active && r.status === 'PENDING') {
      canAct = await this.assertCanAct(actor, r, active).then(
        () => true,
        () => false,
      );
    }
    const own = r.requesterUserId === actor.userId && s.own.hasUnit(r.unitId);
    return {
      ...this.summary(r),
      reason: r.reason,
      workflow: r.workflowSnapshot as unknown as WorkflowSnapshot | null,
      steps: r.steps.map((st) => ({
        id: st.id,
        order: st.stepOrder,
        role: st.role,
        status: st.status,
        assignee: st.assignee,
        decidedBy: st.decider,
        decidedAt: st.decidedAt?.toISOString() ?? null,
      })),
      history: actions.map((a) => ({
        action: a.action,
        stepOrder: a.step.stepOrder,
        actor: a.actor.email,
        delegateTo: a.delegateTo?.email ?? null,
        comment: a.comment,
        at: a.createdAt.toISOString(),
      })),
      permissions: {
        canEdit: own && r.status === 'DRAFT',
        canSubmit: own && r.status === 'DRAFT',
        canDecide: canAct,
        activeStepId: active?.id ?? null,
      },
    };
  }

  async auditTrail(actor: Actor, id: string) {
    const s = await this.scopesFor(actor);
    const r = await this.prisma.approvalRequest.findUnique({ where: { id }, include: requestInclude });
    if (!r || !this.canView(actor, s, r)) throw notFound('Pengajuan');
    const events = await this.prisma.auditEvent.findMany({ where: { entityType: 'approval_request', entityId: id }, orderBy: { id: 'asc' } });
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(events.map((e) => e.actorUserId).filter((x): x is string => Boolean(x)))] } },
      select: { id: true, email: true },
    });
    const email = new Map(users.map((u) => [u.id, u.email]));
    return {
      items: events.map((e) => ({
        id: e.id.toString(),
        eventType: e.eventType,
        actor: e.actorUserId ? (email.get(e.actorUserId) ?? null) : null,
        at: e.createdAt.toISOString(),
        payload: e.payload,
        traceId: e.traceId,
      })),
    };
  }

  // ---------- Internal ----------

  private summary(r: RequestRow) {
    const active = r.steps.find((s) => s.status === 'ACTIVE');
    return {
      id: r.id,
      code: r.externalKey,
      title: r.title,
      amount: r.amount.toString(),
      currency: r.currency.trim(),
      status: r.status,
      unit: { id: r.unit.id, code: r.unit.externalKey, name: r.unit.name },
      requester: r.requester,
      createdAt: r.createdAt.toISOString(),
      submittedAt: r.submittedAt?.toISOString() ?? null,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      activeStep: active ? { id: active.id, order: active.stepOrder, role: active.role, assignee: active.assignee } : null,
      version: r.version,
    };
  }

  private async lockRequest(tx: Tx, id: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM approval_requests WHERE id = ${id}::uuid FOR UPDATE`;
    if (rows.length === 0) return null;
    return tx.approvalRequest.findUniqueOrThrow({ where: { id } });
  }

  private async lockForAction(tx: Tx, actor: Actor, scopes: Scopes, id: string, stepId: string) {
    const locked = await this.lockRequest(tx, id);
    if (!locked) throw notFound('Pengajuan');
    // Urutan lock konsisten: request → steps.
    await tx.$queryRaw`SELECT id FROM approval_steps WHERE request_id = ${id}::uuid ORDER BY step_order FOR UPDATE`;
    const r = await tx.approvalRequest.findUniqueOrThrow({ where: { id }, include: requestInclude });
    if (!this.canView(actor, scopes, r)) throw notFound('Pengajuan');
    const step = r.steps.find((s) => s.id === stepId);
    if (!step) throw notFound('Langkah');
    if (r.status !== 'PENDING') throw conflict('REQUEST_NOT_PENDING', 'Pengajuan ini sudah diputuskan');
    if (step.status !== 'ACTIVE') {
      throw conflict(
        'STEP_NOT_ACTIVE',
        step.status === 'WAITING' ? 'Langkah ini belum aktif; langkah sebelumnya harus diputuskan dulu' : 'Langkah ini sudah diputuskan',
      );
    }
    return { r, steps: r.steps, step };
  }

  private async eligibleUsers(db: Tx | PrismaService, r: Pick<RequestRow, 'unitId' | 'organizationId'>, role: Role) {
    const users = await db.user.findMany({
      where: { active: true, grants: { some: { role, organizationId: r.organizationId } } },
      select: { id: true, email: true, grants: { select: { role: true, organizationId: true, unitId: true, includeDescendants: true } } },
      orderBy: { email: 'asc' },
    });
    const out: { id: string; email: string }[] = [];
    for (const u of users) if ((await this.scopes.resolveForRole(u, role)).hasUnit(r.unitId)) out.push({ id: u.id, email: u.email });
    return out;
  }

  private async assertValidDelegate(tx: Tx, r: RequestRow, step: StepRow, toUserId: string, actorId: string) {
    const invalid = (m: string) => forbidden('INVALID_DELEGATE', m);
    if (toUserId === r.requesterUserId) throw invalid('Pengaju tidak boleh menjadi penerima delegasi');
    if (toUserId === actorId) throw invalid('Tidak bisa mendelegasikan kepada diri sendiri');
    if (toUserId === step.assigneeUserId) throw invalid('Pengguna ini sudah menjadi penerima langkah');
    const eligible = await this.eligibleUsers(tx, r, step.role);
    if (!eligible.some((u) => u.id === toUserId)) {
      throw invalid('Penerima harus pengguna aktif dengan peran dan cakupan yang sesuai untuk langkah ini');
    }
  }

  private async activeWorkflow(db: Tx | PrismaService, organizationId: string) {
    const w = await db.workflowDefinition.findFirst({
      where: { organizationId, type: WORKFLOW_TYPE, active: true },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    });
    if (!w) throw conflict('NO_ACTIVE_WORKFLOW', 'Belum ada workflow persetujuan aktif untuk organisasi ini');
    return w;
  }

  private record(tx: Tx, organizationId: string, requestId: string, actor: Actor, eventType: string, payload: Prisma.InputJsonValue, traceId?: string) {
    return this.audit.record(tx, { organizationId, entityType: 'approval_request', entityId: requestId, actorUserId: actor.userId, eventType, payload, traceId });
  }
}
