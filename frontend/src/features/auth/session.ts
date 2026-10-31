/**
 * Token sesi disimpan backend sebagai cookie httpOnly — JavaScript tidak pernah melihatnya.
 * Di sini hanya ada penanda non-rahasia "pernah login di tab ini" agar UI bisa membedakan
 * "sesi berakhir" dari "belum login".
 */
const HAD_SESSION_KEY = 'sfp.hadSession';

export function markHadSession(): void {
  try {
    sessionStorage.setItem(HAD_SESSION_KEY, '1');
  } catch {
    /* penyimpanan diblokir: abaikan, hanya memengaruhi pesan */
  }
}

export function clearHadSession(): void {
  try {
    sessionStorage.removeItem(HAD_SESSION_KEY);
  } catch {
    /* abaikan */
  }
}

export function hadSession(): boolean {
  try {
    return sessionStorage.getItem(HAD_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

export function isExpired(expiresAt: string, now = Date.now()): boolean {
  const t = Date.parse(expiresAt);
  return Number.isNaN(t) || t <= now;
}
