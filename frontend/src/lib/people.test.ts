import { describe, expect, it } from 'vitest';
import { displayName, greeting, initials } from './people';

describe('nama & sapaan', () => {
  it('nama tampilan dan inisial dari email', () => {
    expect(displayName('manager-a2@example.test')).toBe('Manager A2');
    expect(displayName('finance@example.test')).toBe('Finance');
    expect(initials('manager-a@example.test')).toBe('MA');
    expect(displayName('hr@example.test')).toBe('HR');
    expect(initials('hr@example.test')).toBe('H');
  });

  it('sapaan mengikuti jam Jakarta (UTC+7)', () => {
    expect(greeting(new Date('2026-10-31T00:30:00Z'))).toBe('Selamat pagi'); // 07.30 WIB
    expect(greeting(new Date('2026-10-31T05:00:00Z'))).toBe('Selamat siang'); // 12.00
    expect(greeting(new Date('2026-10-31T09:00:00Z'))).toBe('Selamat sore'); // 16.00
    expect(greeting(new Date('2026-10-31T14:00:00Z'))).toBe('Selamat malam'); // 21.00
  });
});
