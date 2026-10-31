import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppException } from '../../common/app-exception';
import type { Actor } from './actor';
import { REQUIRED_PERMISSION } from './decorators';
import { Permission, roleHasPermission } from './permissions';

/** 403 bila tidak ada satu pun grant actor yang role-nya memberi permission endpoint. */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const permission = this.reflector.getAllAndOverride<Permission | undefined>(REQUIRED_PERMISSION, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!permission) return true;
    const actor = context.switchToHttp().getRequest<{ actor?: Actor }>().actor;
    if (actor && actor.grants.some((g) => roleHasPermission(g.role, permission))) return true;
    throw new AppException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Anda tidak memiliki izin untuk tindakan ini');
  }
}
