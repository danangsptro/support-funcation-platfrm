import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { RequestId } from '../../common/request-context';
import type { Actor } from '../access/actor';
import { CurrentActor, RequirePermission } from '../access/decorators';
import { Permission } from '../access/permissions';
import { PerformanceAnalyticsService } from './analytics.service';
import { CalculateBody, CreateKpiBody, CreatePeriodBody, PeriodQuery, UpdateKpiBody } from './dto';
import { PeriodsService } from './periods.service';
import { ReviewsService } from './reviews.service';

@Controller()
export class PerformanceController {
  constructor(
    private readonly periods: PeriodsService,
    private readonly reviews: ReviewsService,
    private readonly analytics: PerformanceAnalyticsService,
  ) {}

  @Get('review-periods')
  @RequirePermission(Permission.RevenueAnalyticsRead)
  listPeriods(@CurrentActor() actor: Actor) {
    return this.periods.list(actor);
  }

  @Post('review-periods')
  @RequirePermission(Permission.ReviewManage)
  createPeriod(@CurrentActor() actor: Actor, @Body() body: CreatePeriodBody, @RequestId() requestId?: string) {
    return this.periods.create(actor, body, requestId);
  }

  @Post('kpi-assignments')
  @RequirePermission(Permission.ReviewManage)
  createKpi(@CurrentActor() actor: Actor, @Body() body: CreateKpiBody, @RequestId() requestId?: string) {
    return this.reviews.createKpi(actor, body, requestId);
  }

  @Patch('kpi-assignments/:id')
  @RequirePermission(Permission.ReviewManage)
  updateKpi(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateKpiBody, @RequestId() requestId?: string) {
    return this.reviews.updateKpi(actor, id, body, requestId);
  }

  @Get('reviews')
  @RequirePermission(Permission.PerformanceAnalyticsRead)
  listReviews(@CurrentActor() actor: Actor, @Query() q: PeriodQuery) {
    return this.reviews.listForPeriod(actor, q);
  }

  /** Preview: membuat review DRAFT bila belum ada dan menghitung skor dari KPI & revenue saat ini. */
  @Post('reviews/calculate')
  @HttpCode(200)
  @RequirePermission(Permission.ReviewManage)
  calculate(@CurrentActor() actor: Actor, @Body() body: CalculateBody) {
    return this.reviews.calculate(actor, body);
  }

  @Get('reviews/:id')
  @RequirePermission(Permission.PerformanceAnalyticsRead)
  review(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.reviews.detail(actor, id);
  }

  @Post('reviews/:id/finalize')
  @HttpCode(200)
  @RequirePermission(Permission.ReviewManage)
  finalize(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @RequestId() requestId?: string) {
    return this.reviews.finalize(actor, id, requestId);
  }

  @Get('analytics/revenue-per-employee')
  @RequirePermission(Permission.RevenueAnalyticsRead)
  rpe(@CurrentActor() actor: Actor, @Query() q: PeriodQuery) {
    return this.analytics.revenuePerEmployee(actor, q);
  }

  @Get('analytics/performance')
  @RequirePermission(Permission.PerformanceAnalyticsRead)
  performance(@CurrentActor() actor: Actor, @Query() q: PeriodQuery) {
    return this.analytics.performance(actor, q);
  }
}
