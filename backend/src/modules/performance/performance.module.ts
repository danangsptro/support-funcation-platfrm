import { Module } from '@nestjs/common';
import { RevenueService } from '../reconciliation/revenue.service';
import { PerformanceAnalyticsService } from './analytics.service';
import { PerformanceController } from './performance.controller';
import { PeriodsService } from './periods.service';
import { PlacementService } from './placement.service';
import { ReviewAccessPolicy } from './review-access.policy';
import { ReviewsService } from './reviews.service';

/** RevenueService stateless; disediakan langsung agar modul rekonsiliasi (dinamis) tidak diimpor dua kali. */
@Module({
  controllers: [PerformanceController],
  providers: [PeriodsService, PlacementService, ReviewsService, PerformanceAnalyticsService, RevenueService, ReviewAccessPolicy],
})
export class PerformanceModule {}
