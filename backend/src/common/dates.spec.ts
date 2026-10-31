import { isValidIsoDate, todayInJakarta } from './dates';

describe('tanggal bisnis', () => {
  it('validasi tanggal kalender', () => {
    expect(isValidIsoDate('2026-09-30')).toBe(true);
    expect(isValidIsoDate('2026-02-30')).toBe(false);
    expect(isValidIsoDate('2026-9-1')).toBe(false);
  });

  it('hari ini mengikuti Asia/Jakarta (UTC+7)', () => {
    expect(todayInJakarta(new Date('2026-09-30T17:30:00Z'))).toBe('2026-10-01');
    expect(todayInJakarta(new Date('2026-09-30T16:59:00Z'))).toBe('2026-09-30');
  });
});
