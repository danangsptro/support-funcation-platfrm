import { HttpStatus, Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { AppException } from '../../common/app-exception';
import { PrismaService } from '../../database/prisma.service';
import type { Actor } from '../access/actor';
import type { AccessTokenPayload } from '../access/auth.guard';
import { ROLE_PERMISSIONS } from '../access/permissions';
import { LoginThrottle } from './login-throttle.service';

export const LOGIN_THROTTLE = Symbol('LOGIN_THROTTLE');

export interface UserProfile {
  id: string;
  email: string;
  grants: {
    role: string;
    includeDescendants: boolean;
    organization: { id: string; code: string; name: string };
    unit: { id: string; code: string; name: string; type: string } | null;
  }[];
  permissions: string[];
}

@Injectable()
export class AuthService implements OnModuleInit {
  /** Dipakai saat email tidak terdaftar agar waktu respons setara dengan password salah. */
  private dummyHash = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(LOGIN_THROTTLE) private readonly throttle: LoginThrottle,
  ) {}

  async onModuleInit(): Promise<void> {
    this.dummyHash = await hash('dummy-password-for-timing', 10);
  }

  async login(email: string, password: string, ip: string) {
    this.throttle.assertAllowed(ip, email);
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, active: true, passwordHash: true },
    });
    const ok = await compare(password, user?.passwordHash ?? this.dummyHash);
    // Pesan sama untuk email tidak ada, password salah, atau akun nonaktif.
    if (!user || !ok || !user.active) {
      this.throttle.recordFailure(ip, email);
      throw new AppException(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'Email atau kata sandi salah');
    }
    this.throttle.recordSuccess(ip, email);
    const payload: AccessTokenPayload = { sub: user.id, typ: 'access' };
    const accessToken = await this.jwt.signAsync(payload);
    const { exp } = this.jwt.decode<{ exp: number }>(accessToken);
    return {
      accessToken,
      tokenType: 'Bearer' as const,
      expiresAt: new Date(exp * 1000).toISOString(),
      expiresInMs: exp * 1000 - Date.now(),
      user: await this.profile(user.id),
    };
  }

  async profile(userId: string): Promise<UserProfile> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        grants: {
          orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
          select: {
            role: true,
            includeDescendants: true,
            organization: { select: { id: true, externalKey: true, name: true } },
            unit: { select: { id: true, externalKey: true, name: true, type: true } },
          },
        },
      },
    });
    const grants = user.grants.map((g) => ({
      role: g.role,
      includeDescendants: g.includeDescendants,
      organization: { id: g.organization.id, code: g.organization.externalKey, name: g.organization.name },
      unit: g.unit ? { id: g.unit.id, code: g.unit.externalKey, name: g.unit.name, type: g.unit.type } : null,
    }));
    const permissions = [...new Set(user.grants.flatMap((g) => ROLE_PERMISSIONS[g.role]))].sort();
    return { id: user.id, email: user.email, grants, permissions };
  }

  profileFor(actor: Actor): Promise<UserProfile> {
    return this.profile(actor.userId);
  }
}
