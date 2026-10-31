import { DynamicModule, Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({})
export class DatabaseModule {
  static forRoot(databaseUrl: string): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [{ provide: PrismaService, useFactory: () => new PrismaService(databaseUrl) }],
      exports: [PrismaService],
    };
  }
}
