/** Cookie sesi httpOnly: tidak terbaca JavaScript, hanya dikirim ke /api pada situs yang sama. */
export const SESSION_COOKIE = 'sfp_session';
export const SESSION_COOKIE_PATH = '/api';

/**
 * Header wajib untuk request non-GET yang diautentikasi lewat cookie (proteksi CSRF lapis kedua
 * di samping SameSite=Strict). Form/link lintas situs tidak bisa menyetel header kustom, dan fetch
 * lintas origin dengan header kustom memicu preflight yang tidak diizinkan API (tanpa CORS).
 */
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_HEADER_VALUE = 'sfp-web';

export function sessionCookieOptions(secure: boolean, maxAgeMs?: number) {
  return {
    httpOnly: true,
    secure,
    sameSite: 'strict' as const,
    path: SESSION_COOKIE_PATH,
    ...(maxAgeMs !== undefined ? { maxAge: maxAgeMs } : {}),
  };
}
