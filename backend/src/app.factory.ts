import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule, AppOptions } from './app.module';
import { setupApiDocs } from './common/api-docs';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { accessLogMiddleware } from './common/access-log.middleware';
import { requestIdMiddleware } from './common/request-id.middleware';
import { createValidationPipe } from './common/validation';

export const API_PREFIX = 'api/v1';

/** Konfigurasi bersama untuk main.ts dan test integrasi. */
export async function createApp(options: AppOptions, logger = true): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.forRoot(options), {
    logger: logger ? ['log', 'warn', 'error'] : false,
  });
  configureApp(app, options);
  setupApiDocs(app);
  return app;
}

export function configureApp(app: INestApplication, options: Pick<AppOptions, 'trustProxy'>): void {
  const http = app.getHttpAdapter().getInstance() as { set(name: string, value: unknown): void; disable(name: string): void };
  // IP klien asli dari X-Forwarded-For hanya bila request datang dari proxy tepercaya (nginx).
  http.set('trust proxy', options.trustProxy);
  http.disable('x-powered-by');
  app.use(requestIdMiddleware);
  app.use(accessLogMiddleware);
  app.use(cookieParser());
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(createValidationPipe());
  // Juga menangani rute tak dikenal (NotFoundException dari router Nest).
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();
}
