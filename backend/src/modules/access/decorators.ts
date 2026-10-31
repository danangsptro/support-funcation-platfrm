import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Actor } from './actor';
import type { Permission } from './permissions';

export const IS_PUBLIC = 'access:isPublic';
export const REQUIRED_PERMISSION = 'access:requiredPermission';

/** Endpoint tanpa autentikasi (login, health). Semua endpoint lain default wajib login. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Actor wajib memiliki permission ini pada minimal satu grant; selain itu 403. */
export const RequirePermission = (permission: Permission) => SetMetadata(REQUIRED_PERMISSION, permission);

export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): Actor => {
  const req = ctx.switchToHttp().getRequest<{ actor?: Actor }>();
  if (!req.actor) throw new Error('CurrentActor dipakai pada endpoint publik');
  return req.actor;
});
