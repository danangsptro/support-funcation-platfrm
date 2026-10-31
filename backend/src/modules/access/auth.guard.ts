import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AppException } from '../../common/app-exception';
import type { Actor } from './actor';
import { ActorService } from './actor.service';
import { IS_PUBLIC } from './decorators';
import { CSRF_HEADER, CSRF_HEADER_VALUE, SESSION_COOKIE } from './session-cookie';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface AccessTokenPayload {
  sub: string;
  typ: 'access';
}

export interface AuthenticatedRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string | undefined>;
  actor?: Actor;
  sessionExpiresAt?: string;
}

/**
 * Default-deny: setiap endpoint butuh token valid kecuali @Public().
 * Sumber token: header Bearer (klien API/CLI) atau cookie httpOnly (browser).
 * Request mengubah data via cookie wajib membawa header CSRF.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly actors: ActorService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) {
      return true;
    }
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
    const [scheme, bearer] = authHeader.split(' ');
    const fromHeader = scheme === 'Bearer' && bearer ? bearer : undefined;
    const fromCookie = req.cookies?.[SESSION_COOKIE];
    const token = fromHeader ?? fromCookie;
    if (!token) throw unauthenticated('Token tidak ada');

    if (!fromHeader && !SAFE_METHODS.has(req.method) && req.headers[CSRF_HEADER] !== CSRF_HEADER_VALUE) {
      throw new AppException(HttpStatus.FORBIDDEN, 'CSRF_CHECK_FAILED', 'Permintaan ditolak oleh pemeriksaan keamanan');
    }

    let payload: AccessTokenPayload & { exp: number };
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload & { exp: number }>(token);
    } catch {
      throw unauthenticated('Token tidak valid atau kedaluwarsa');
    }
    if (payload.typ !== 'access' || typeof payload.sub !== 'string' || !UUID.test(payload.sub)) {
      throw unauthenticated('Token tidak valid');
    }
    const actor = await this.actors.load(payload.sub);
    if (!actor) throw unauthenticated('Akun tidak aktif');
    req.actor = actor;
    req.sessionExpiresAt = new Date(payload.exp * 1000).toISOString();
    return true;
  }
}

function unauthenticated(message: string) {
  return new AppException(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', message);
}
