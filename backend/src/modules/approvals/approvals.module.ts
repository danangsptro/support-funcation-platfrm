import { DynamicModule, Module } from '@nestjs/common';
import { ApprovalsController } from './approvals.controller';
import { APPROVAL_HOOKS, ApprovalHooks, ApprovalsService } from './approvals.service';

@Module({})
export class ApprovalsModule {
  static forRoot(hooks: ApprovalHooks = {}): DynamicModule {
    return {
      module: ApprovalsModule,
      controllers: [ApprovalsController],
      providers: [ApprovalsService, { provide: APPROVAL_HOOKS, useValue: hooks }],
    };
  }
}
