import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

export const DATABASE_URL = Symbol('DATABASE_URL');

/**
 * Koneksi dibuka lazily pada query pertama agar API tetap bisa start (dan melaporkan
 * readiness 503) ketika database belum tersedia.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(databaseUrl: string) {
    super({ datasourceUrl: databaseUrl });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
