import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { Actor } from './actor';

@Injectable()
export class ActorService {
  constructor(private readonly prisma: PrismaService) {}

  /** null bila user tidak ada atau nonaktif. Tidak pernah memilih password_hash. */
  async load(userId: string): Promise<Actor | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        active: true,
        grants: { select: { role: true, organizationId: true, unitId: true, includeDescendants: true } },
      },
    });
    if (!user || !user.active) return null;
    return { userId: user.id, email: user.email, grants: user.grants };
  }
}
