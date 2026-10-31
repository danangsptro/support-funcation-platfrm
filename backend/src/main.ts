import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { createApp } from './app.factory';
import { loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await createApp(env);
  await app.listen(env.port, '0.0.0.0');
  Logger.log(`API berjalan di port ${env.port} (${env.nodeEnv})`, 'Bootstrap');
}

void bootstrap();
