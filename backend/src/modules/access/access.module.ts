import { DynamicModule, Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ActorService } from './actor.service';
import { AuthGuard } from './auth.guard';
import { PermissionGuard } from './permission.guard';
import { ScopeService } from './scope.service';

export interface AccessOptions {
  jwtSecret: string;
  jwtExpiresInSeconds: number;
}

/** Guard global: AuthGuard (401) lalu PermissionGuard (403). Scope (404) diterapkan di service. */
@Global()
@Module({})
export class AccessModule {
  static forRoot(options: AccessOptions): DynamicModule {
    return {
      module: AccessModule,
      imports: [
        JwtModule.register({
          secret: options.jwtSecret,
          signOptions: { algorithm: 'HS256', expiresIn: options.jwtExpiresInSeconds },
          verifyOptions: { algorithms: ['HS256'] },
        }),
      ],
      providers: [
        ActorService,
        ScopeService,
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: PermissionGuard },
      ],
      exports: [ActorService, ScopeService, JwtModule],
    };
  }
}
