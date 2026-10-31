import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { toIsoDate } from '../../common/dates';
import { PrismaService } from '../../database/prisma.service';
import { AssignmentSpan, homeUnitForPeriod, PeriodSpan } from './calc';

export interface PeriodRow {
  id: string;
  organizationId: string;
  externalKey: string;
  startDate: Date;
  endDateExclusive: Date;
  timezone: string;
}

export const periodSpan = (p: PeriodRow): PeriodSpan => ({ startDate: toIsoDate(p.startDate), endDateExclusive: toIsoDate(p.endDateExclusive) });

type Db = Pick<PrismaService, 'employeeAssignment'> | Prisma.TransactionClient;

/** Penempatan karyawan yang beririsan dengan periode, dan unit "rumah" karyawan pada periode itu. */
@Injectable()
export class PlacementService {
  constructor(private readonly prisma: PrismaService) {}

  async spans(where: Prisma.EmployeeAssignmentWhereInput, p: PeriodRow, db: Db = this.prisma): Promise<AssignmentSpan[]> {
    const rows = await db.employeeAssignment.findMany({
      where: {
        AND: [
          where,
          { startDate: { lt: p.endDateExclusive } },
          { OR: [{ endDateExclusive: null }, { endDateExclusive: { gt: p.startDate } }] },
        ],
      },
      select: { employeeId: true, unitId: true, startDate: true, endDateExclusive: true, isPrimary: true },
    });
    return rows.map((r) => ({
      employeeId: r.employeeId,
      unitId: r.unitId,
      startDate: toIsoDate(r.startDate),
      endDateExclusive: r.endDateExclusive ? toIsoDate(r.endDateExclusive) : null,
      isPrimary: r.isPrimary,
    }));
  }

  async homeUnit(employeeId: string, p: PeriodRow, db: Db = this.prisma): Promise<string | null> {
    return homeUnitForPeriod(await this.spans({ employeeId }, p, db), periodSpan(p));
  }

  /** Unit rumah semua karyawan organisasi pada periode. */
  async homeUnits(p: PeriodRow): Promise<Map<string, string>> {
    const spans = await this.spans({ organizationId: p.organizationId }, p);
    const byEmployee = new Map<string, AssignmentSpan[]>();
    for (const s of spans) byEmployee.set(s.employeeId, [...(byEmployee.get(s.employeeId) ?? []), s]);
    const out = new Map<string, string>();
    for (const [e, list] of byEmployee) {
      const home = homeUnitForPeriod(list, periodSpan(p));
      if (home) out.set(e, home);
    }
    return out;
  }
}
