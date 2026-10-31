import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Page, pageArgs } from '../../common/pagination';
import { PrismaService } from '../../database/prisma.service';
import type { Actor } from '../access/actor';
import { Permission } from '../access/permissions';
import { AccessScope, notFound, ScopeService } from '../access/scope.service';
import { AuditService } from '../audit/audit.service';
import { ListOrgUnitsQuery } from './org-units.dto';

const unitSelect = {
  id: true,
  externalKey: true,
  name: true,
  type: true,
  parentId: true,
  organization: { select: { id: true, externalKey: true, name: true } },
} satisfies Prisma.OrgUnitSelect;

type UnitRow = Prisma.OrgUnitGetPayload<{ select: typeof unitSelect }>;

export interface OrgUnitView {
  id: string;
  code: string;
  name: string;
  type: string;
  organization: { id: string; code: string; name: string };
  /** null bila unit induk berada di luar scope actor (tidak dibocorkan). */
  parentId: string | null;
}

@Injectable()
export class OrgUnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: ScopeService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: Actor, q: ListOrgUnitsQuery): Promise<Page<OrgUnitView>> {
    const scope = await this.scopes.resolve(actor, Permission.OrgRead);
    // Filter dari klien hanya mempersempit; nilai di luar scope → 404, bukan perluasan akses.
    if (q.organizationId && !scope.hasOrganization(q.organizationId)) throw notFound('Organisasi');
    if (q.parentId) scope.assertUnit(q.parentId, 'Unit induk');
    const where: Prisma.OrgUnitWhereInput = {
      id: { in: scope.unitIds },
      organizationId: q.organizationId,
      parentId: q.parentId,
      type: q.type,
    };
    const [rows, total] = await Promise.all([
      this.prisma.orgUnit.findMany({
        where,
        select: unitSelect,
        orderBy: [{ organization: { externalKey: 'asc' } }, { externalKey: 'asc' }],
        ...pageArgs(q),
      }),
      this.prisma.orgUnit.count({ where }),
    ]);
    return { items: rows.map((r) => toView(r, scope)), page: q.page, pageSize: q.pageSize, total };
  }

  async detail(actor: Actor, id: string) {
    const scope = await this.scopes.resolve(actor, Permission.OrgRead);
    scope.assertUnit(id, 'Unit');
    const row = await this.prisma.orgUnit.findUniqueOrThrow({ where: { id }, select: unitSelect });
    const children = await this.prisma.orgUnit.findMany({
      where: { parentId: id, id: { in: scope.unitIds } },
      select: unitSelect,
      orderBy: { externalKey: 'asc' },
    });
    return { ...toView(row, scope), children: children.map((c) => toView(c, scope)) };
  }

  /** Mutasi master: scope dicek dengan permission OrgManage; audit di transaksi yang sama. */
  async rename(actor: Actor, id: string, name: string, traceId?: string) {
    const scope = await this.scopes.resolve(actor, Permission.OrgManage);
    scope.assertUnit(id, 'Unit');
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.orgUnit.findUniqueOrThrow({ where: { id }, select: { name: true, organizationId: true } });
      await tx.orgUnit.update({ where: { id }, data: { name } });
      await this.audit.record(tx, {
        organizationId: before.organizationId,
        entityType: 'org_unit',
        entityId: id,
        actorUserId: actor.userId,
        eventType: 'ORG_UNIT_RENAMED',
        payload: { from: before.name, to: name },
        traceId,
      });
    });
    return this.detail(actor, id);
  }
}

function toView(r: UnitRow, scope: AccessScope): OrgUnitView {
  return {
    id: r.id,
    code: r.externalKey,
    name: r.name,
    type: r.type,
    organization: { id: r.organization.id, code: r.organization.externalKey, name: r.organization.name },
    parentId: r.parentId && scope.hasUnit(r.parentId) ? r.parentId : null,
  };
}
