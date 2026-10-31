import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { todayInJakarta, toIsoDate } from '../../common/dates';
import { Page, pageArgs } from '../../common/pagination';
import { PrismaService } from '../../database/prisma.service';
import type { Actor } from '../access/actor';
import { Permission } from '../access/permissions';
import { AccessScope, notFound, ScopeService } from '../access/scope.service';
import { ListEmployeesQuery } from './employees.dto';

const employeeSelect = {
  id: true,
  externalKey: true,
  name: true,
  organizationId: true,
  assignments: {
    orderBy: { startDate: 'asc' },
    select: {
      unitId: true,
      startDate: true,
      endDateExclusive: true,
      isPrimary: true,
      unit: { select: { externalKey: true, name: true } },
    },
  },
} satisfies Prisma.EmployeeSelect;

type EmployeeRow = Prisma.EmployeeGetPayload<{ select: typeof employeeSelect }>;

/**
 * Karyawan terlihat bila actor punya scope seluruh organisasinya, atau karyawan pernah/sedang
 * ditempatkan di unit dalam scope. Riwayat penempatan di unit luar scope disembunyikan.
 */
export function employeeScopeWhere(scope: AccessScope): Prisma.EmployeeWhereInput {
  return {
    OR: [
      { organizationId: { in: scope.orgWideOrganizationIds } },
      { assignments: { some: { unitId: { in: scope.unitIds } } } },
    ],
  };
}

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: ScopeService,
  ) {}

  async list(actor: Actor, q: ListEmployeesQuery): Promise<Page<ReturnType<typeof toView>>> {
    const scope = await this.scopes.resolve(actor, Permission.EmployeeRead);
    if (q.unitId) scope.assertUnit(q.unitId, 'Unit');
    const where: Prisma.EmployeeWhereInput = {
      AND: [employeeScopeWhere(scope), q.unitId ? { assignments: { some: { unitId: q.unitId } } } : {}],
    };
    const [rows, total] = await Promise.all([
      this.prisma.employee.findMany({ where, select: employeeSelect, orderBy: { externalKey: 'asc' }, ...pageArgs(q) }),
      this.prisma.employee.count({ where }),
    ]);
    return { items: rows.map((r) => toView(r, scope)), page: q.page, pageSize: q.pageSize, total };
  }

  async detail(actor: Actor, id: string) {
    const scope = await this.scopes.resolve(actor, Permission.EmployeeRead);
    const row = await this.prisma.employee.findFirst({ where: { AND: [{ id }, employeeScopeWhere(scope)] }, select: employeeSelect });
    if (!row) throw notFound('Karyawan');
    return toView(row, scope);
  }

  /**
   * Helper agregat ber-scope: jumlah penempatan primer aktif per unit pada tanggal asOf.
   * Hanya unit dalam scope yang dihitung; tidak ada parameter klien yang memperluasnya.
   */
  async summary(actor: Actor, asOf = todayInJakarta()) {
    const scope = await this.scopes.resolve(actor, Permission.EmployeeRead);
    const day = new Date(`${asOf}T00:00:00.000Z`);
    const [units, counts] = await Promise.all([
      this.prisma.orgUnit.findMany({
        where: { id: { in: scope.unitIds } },
        select: { id: true, externalKey: true, name: true, type: true },
        orderBy: { externalKey: 'asc' },
      }),
      this.prisma.employeeAssignment.groupBy({
        by: ['unitId'],
        where: {
          unitId: { in: scope.unitIds },
          isPrimary: true,
          startDate: { lte: day },
          OR: [{ endDateExclusive: null }, { endDateExclusive: { gt: day } }],
        },
        _count: { _all: true },
      }),
    ]);
    const byUnitId = new Map(counts.map((c) => [c.unitId, c._count._all]));
    const byUnit = units.map((u) => ({ unitId: u.id, code: u.externalKey, name: u.name, type: u.type, count: byUnitId.get(u.id) ?? 0 }));
    return { asOf, total: byUnit.reduce((sum, u) => sum + u.count, 0), byUnit };
  }
}

function toView(r: EmployeeRow, scope: AccessScope) {
  const orgWide = scope.orgWideOrganizationIds.includes(r.organizationId);
  return {
    id: r.id,
    code: r.externalKey,
    name: r.name,
    organizationId: r.organizationId,
    assignments: r.assignments
      .filter((a) => orgWide || scope.hasUnit(a.unitId))
      .map((a) => ({
        unitId: a.unitId,
        unitCode: a.unit.externalKey,
        unitName: a.unit.name,
        startDate: toIsoDate(a.startDate),
        endDateExclusive: a.endDateExclusive ? toIsoDate(a.endDateExclusive) : null,
        isPrimary: a.isPrimary,
      })),
  };
}
