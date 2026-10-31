/** Tanggal bisnis hari ini di Asia/Jakarta (YYYY-MM-DD). */
export function todayInJakarta(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(now);
}

export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Tanggal kalender valid berformat YYYY-MM-DD (menolak 2026-02-30). */
export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && toIsoDate(d) === value;
}
