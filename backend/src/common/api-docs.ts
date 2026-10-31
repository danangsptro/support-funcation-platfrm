import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { SESSION_COOKIE } from '../modules/access/session-cookie';

/** Lokasi Swagger UI & dokumen OpenAPI (di bawah /api agar ikut diteruskan nginx). */
export const API_DOCS_PATH = 'api/v1/docs';

/**
 * Swagger UI di /api/v1/docs dan JSON OpenAPI di /api/v1/docs-json. Skema DTO dibuat plugin @nestjs/swagger saat
 * `nest build` dari tipe TypeScript + dekorator class-validator. Dokumentasi saja: otorisasi tetap di guard.
 */
export function setupApiDocs(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Support Function Platform API')
    .setDescription(
      [
        'API rekonsiliasi keuangan, performa & RPE, serta persetujuan anggaran.',
        '',
        '**Cara mencoba:** jalankan `POST /api/v1/auth/login` (mis. `finance@example.test` dengan password `DEMO_PASSWORD` dari `.env`).',
        'Salin `accessToken` dari respons → tombol **Authorize** → isi pada skema *bearer*. Klien Bearer tidak perlu header CSRF.',
        '',
        'Data di luar cakupan akses → 404; tanpa permission → 403. Nominal uang berupa string desimal. Error: `{ code, message, requestId, details? }`.',
      ].join('\n'),
    )
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
    .addCookieAuth(SESSION_COOKIE, { type: 'apiKey', in: 'cookie', name: SESSION_COOKIE }, 'cookie')
    .addSecurityRequirements('bearer')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(API_DOCS_PATH, app, document, {
    customSiteTitle: 'Support Function Platform — API',
    swaggerOptions: { persistAuthorization: true, docExpansion: 'none', tagsSorter: 'alpha' },
  });
}
