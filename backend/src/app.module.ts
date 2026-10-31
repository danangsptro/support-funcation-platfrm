import { DynamicModule, Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { AccessModule } from './modules/access/access.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import type { ApprovalHooks } from './modules/approvals/approvals.service';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { HealthModule } from './modules/health/health.module';
import { OrganizationModule } from './modules/organization/organization.module';
import { PerformanceModule } from './modules/performance/performance.module';
import { ReconciliationModule } from './modules/reconciliation/reconciliation.module';
import type { ReconciliationHooks } from './modules/reconciliation/runs.service';

import type { LoginThrottleOptions } from './modules/auth/login-throttle.service';

export interface AppOptions {
  databaseUrl: string;
  jwtSecret: string;
  jwtExpiresInSeconds: number;
  cookieSecure: boolean;
  trustProxy: string;
  loginThrottle?: LoginThrottleOptions;
  /** Hanya untuk test (injeksi kegagalan sebelum commit). */
  reconciliationHooks?: ReconciliationHooks;
  /** Hanya untuk test (injeksi kegagalan & koordinasi race sebelum commit). */
  approvalHooks?: ApprovalHooks;
}

@Module({})
export class AppModule {
  static forRoot(options: AppOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [
        DatabaseModule.forRoot(options.databaseUrl),
        AccessModule.forRoot(options),
        AuditModule,
        HealthModule,
        AuthModule.forRoot(options),
        OrganizationModule,
        EmployeesModule,
        ReconciliationModule.forRoot(options.reconciliationHooks),
        PerformanceModule,
        ApprovalsModule.forRoot(options.approvalHooks),
      ],
    };
  }
}
