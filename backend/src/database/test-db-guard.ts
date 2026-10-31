/**
 * Pengaman operasi destruktif (reset/truncate) pada test. Hanya mengizinkan database yang
 * namanya berakhiran `_test`, dan hanya ketika NODE_ENV=test.
 */
export function assertTestDatabaseUrl(url: string | undefined, nodeEnv = process.env.NODE_ENV): string {
  if (nodeEnv !== 'test') {
    throw new Error(`Reset database ditolak: NODE_ENV harus "test" (sekarang "${nodeEnv}")`);
  }
  if (!url) {
    throw new Error('Reset database ditolak: URL database test tidak diisi');
  }
  let dbName: string;
  try {
    dbName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  } catch {
    throw new Error('Reset database ditolak: URL database tidak valid');
  }
  if (!/^[A-Za-z0-9_]+_test$/.test(dbName)) {
    throw new Error(`Reset database ditolak: "${dbName || '(kosong)'}" bukan database test (*_test)`);
  }
  return dbName;
}

/** Cek kedua di sisi server: nama database yang benar-benar terhubung. */
export function assertConnectedTestDatabase(currentDatabase: string): void {
  if (!/_test$/.test(currentDatabase)) {
    throw new Error(`Reset database ditolak: koneksi aktif ke "${currentDatabase}", bukan *_test`);
  }
}
