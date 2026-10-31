import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from '../../common/app-exception';
import { toIsoDate } from '../../common/dates';
import { PrismaService } from '../../database/prisma.service';
import type { Actor } from '../access/actor';
import { Permission } from '../access/permissions';
import { notFound, ScopeService } from '../access/scope.service';
import { AuditService } from '../audit/audit.service';
import { CreatePeriodBody } from './dto';
import { periodDays } from './calc';
import { PeriodRow } from './placement.service';

export function toPeriodView(p: PeriodRow) {
  const span = { startDate: toIsoDate(p.startDate), endDateExclusive: toIsoDate(p.endDateExclusive) };
  return { id: p.id, organizationId: p.organizationId, code: p.externalKey, ...span, timezone: p.timezone, days: periodDays(span) };
}

@Injectable()
export class PeriodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: ScopeService,
    private readonly audit: AuditService,
  ) {}

  /** Periode milik organisasi yang terjangkau actor untuk permission tersebut; selain itu 404. */
  async visible(actor: Actor, periodId: string, permission: Permission): Promise<PeriodRow> {
    const scope = await this.scopes.resolve(actor, permission);
    const period = await this.prisma.reviewPeriod.findUnique({ where: { id: periodId } });
    if (!period || !scope.hasOrganization(period.organizationId)) throw notFound('Periode');
    return period;
  }

  async list(actor: Actor) {
    const scope = await this.scopes.resolve(actor, Permission.RevenueAnalyticsRead);
    const rows = await this.prisma.reviewPeriod.findMany({
      where: { organizationId: { in: scope.organizationIds } },
      orderBy: [{ startDate: 'desc' }],
    });
    return { items: rows.map(toPeriodView), total: rows.length };
  }

  async create(actor: Actor, body: CreatePeriodBody, traceId?: string) {
    const scope = await this.scopes.resolve(actor, Permission.ReviewManage);
    const orgs = scope.organizationIds;
    const organizationId = body.organizationId ?? (orgs.length === 1 ? orgs[0] : undefined);
    if (!organizationId) {
      throw new AppException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'organizationId wajib karena Anda mengelola lebih dari satu organisasi');
    }
    if (!scope.hasOrganization(organizationId)) throw notFound('Organisasi');
    const days = periodDays(body);
    if (days <= 0 || days > 366) {
      throw new AppException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Periode harus 1–366 hari dan endDateExclusive setelah startDate');
    }
    try {
      const period = await this.prisma.$transaction(async (tx) => {
        const created = await tx.reviewPeriod.create({
          data: {
            organizationId,
            externalKey: body.code,
            startDate: new Date(`${body.startDate}T00:00:00.000Z`),
            endDateExclusive: new Date(`${body.endDateExclusive}T00:00:00.000Z`),
          },
        });
        await this.audit.record(tx, {
          organizationId,
          entityType: 'review_period',
          entityId: created.id,
          actorUserId: actor.userId,
          eventType: 'REVIEW_PERIOD_CREATED',
          payload: { code: body.code, startDate: body.startDate, endDateExclusive: body.endDateExclusive },
          traceId,
        });
        return created;
      });
      return toPeriodView(period);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppException(HttpStatus.CONFLICT, 'PERIOD_CODE_EXISTS', `Kode periode ${body.code} sudah dipakai`);
      }
      throw err;
    }
  }
}
