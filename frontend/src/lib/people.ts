/** Nama tampilan dari email bila profil belum punya nama, mis. "manager-a@…" → "Manager A". */
export function displayName(email: string | undefined): string {
  if (!email) return '';
  return email
    .split('@')[0]
    .split(/[-._]+/)
    .filter(Boolean)
    // Singkatan pendek (mis. "hr") ditulis kapital: "HR".
    .map((w) => (w.length <= 2 && /^[a-z]+$/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

export function initials(email: string | undefined): string {
  const parts = displayName(email).split(' ');
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

/** Sapaan menurut jam di Asia/Jakarta. */
export function greeting(now = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Jakarta' }).format(now));
  if (hour >= 4 && hour < 11) return 'Selamat pagi';
  if (hour >= 11 && hour < 15) return 'Selamat siang';
  if (hour >= 15 && hour < 18) return 'Selamat sore';
  return 'Selamat malam';
}

export function todayLong(now = new Date()): string {
  return new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(now);
}
