export interface AppEnv {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  jwtExpiresInSeconds: number;
  /** Cookie sesi hanya dikirim via HTTPS. Wajib true di produksi; false untuk http://localhost. */
  cookieSecure: boolean;
  /** Nilai Express "trust proxy" agar IP klien di balik nginx terbaca untuk rate limiting. */
  trustProxy: string;
}

/** Validasi environment saat start; gagal cepat bila konfigurasi wajib tidak ada. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const databaseUrl = source.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL wajib diisi (lihat .env.example)');
  }
  const port = Number(source.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`PORT tidak valid: ${source.PORT}`);
  }
  const jwtSecret = source.JWT_SECRET ?? '';
  if (jwtSecret.length < 32) {
    throw new Error('JWT_SECRET wajib diisi minimal 32 karakter (lihat .env.example)');
  }
  const jwtExpiresInSeconds = Number(source.JWT_EXPIRES_IN_SECONDS ?? 3600);
  if (!Number.isInteger(jwtExpiresInSeconds) || jwtExpiresInSeconds < 60 || jwtExpiresInSeconds > 86400) {
    throw new Error('JWT_EXPIRES_IN_SECONDS harus bilangan bulat 60–86400');
  }
  const cookieSecure = (source.COOKIE_SECURE ?? 'false').toLowerCase();
  if (!['true', 'false'].includes(cookieSecure)) {
    throw new Error('COOKIE_SECURE harus true atau false');
  }
  return {
    nodeEnv: source.NODE_ENV ?? 'development',
    port,
    databaseUrl,
    jwtSecret,
    jwtExpiresInSeconds,
    cookieSecure: cookieSecure === 'true',
    trustProxy: source.TRUST_PROXY ?? 'loopback, linklocal, uniquelocal',
  };
}
