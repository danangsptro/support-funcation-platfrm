import { DynamicModule, Module } from '@nestjs/common';
import { DatasetsService } from './datasets.service';
import { ReconciliationController } from './reconciliation.controller';
import { RevenueService } from './revenue.service';
import { RECONCILIATION_HOOKS, ReconciliationHooks, RunsService } from './runs.service';

@Module({})
export class ReconciliationModule {
  static forRoot(hooks: ReconciliationHooks = {}): DynamicModule {
    return {
      module: ReconciliationModule,
      controllers: [ReconciliationController],
      providers: [DatasetsService, RunsService, RevenueService, { provide: RECONCILIATION_HOOKS, useValue: hooks }],
      exports: [RevenueService],
    };
  }
}
