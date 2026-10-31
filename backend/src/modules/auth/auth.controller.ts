import { ApiTags } from '@nestjs/swagger';
import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Actor } from '../access/actor';
import type { AuthenticatedRequest } from '../access/auth.guard';
import { CurrentActor, Public } from '../access/decorators';
import { SESSION_COOKIE, sessionCookieOptions } from '../access/session-cookie';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

export const AUTH_OPTIONS = Symbol('AUTH_OPTIONS');

export interface AuthOptions {
  cookieSecure: boolean;
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(AUTH_OPTIONS) private readonly options: AuthOptions,
  ) {}

  /**
   * Token dikirim sebagai cookie httpOnly (dipakai browser) dan di body (untuk klien API/CLI).
   * Frontend tidak menyimpan token dari body.
   */
  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      const { expiresInMs, ...result } = await this.auth.login(body.email, body.password, req.ip ?? 'unknown');
      res.cookie(SESSION_COOKIE, result.accessToken, sessionCookieOptions(this.options.cookieSecure, expiresInMs));
      return result;
    } catch (err) {
      const retry = (err as { getResponse?: () => { details?: { retryAfterSeconds?: number } } }).getResponse?.()?.details
        ?.retryAfterSeconds;
      if (retry) res.setHeader('Retry-After', String(retry));
      throw err;
    }
  }

  /** Publik agar tetap bisa menghapus cookie walau token sudah kedaluwarsa. */
  @Public()
  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response): void {
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions(this.options.cookieSecure));
  }

  /** Profil + grant + permission + waktu habis sesi. UI memakainya untuk tampilan, bukan otorisasi. */
  @Get('me')
  async me(@CurrentActor() actor: Actor, @Req() req: AuthenticatedRequest) {
    return { ...(await this.auth.profileFor(actor)), sessionExpiresAt: req.sessionExpiresAt };
  }
}
