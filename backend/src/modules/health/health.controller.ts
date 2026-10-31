import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/app-exception';
import { PrismaService } from '../../database/prisma.service';
import { Public } from '../access/decorators';

const READY_TIMEOUT_MS = 2000;

@Public()
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Proses hidup; tidak menyentuh dependensi. */
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /** Siap melayani: database dapat di-query dalam batas waktu. */
  @Get('ready')
  async ready() {
    try {
      await withTimeout(this.prisma.$queryRaw`SELECT 1`, READY_TIMEOUT_MS);
      return { status: 'ok', checks: { database: 'up' } };
    } catch {
      throw new AppException(HttpStatus.SERVICE_UNAVAILABLE, 'NOT_READY', 'Database tidak tersedia', {
        checks: { database: 'down' },
      });
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
