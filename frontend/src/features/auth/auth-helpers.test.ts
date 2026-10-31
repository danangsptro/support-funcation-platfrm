import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../../lib/api';
import { describeScope } from './access-labels';
import { describeLoginError, validateLogin } from './login-form';
import { isExpired } from './session';
import type { Grant } from './types';

describe('validasi formulir login', () => {
  it('email & kata sandi wajib, format email dicek', () => {
    expect(validateLogin({ email: '', password: '' })).toEqual({
      email: 'Email wajib diisi.',
      password: 'Kata sandi wajib diisi.',
    });
    expect(validateLogin({ email: 'manager-a', password: 'x' }).email).toMatch(/Format email/);
    expect(validateLogin({ email: ' manager-a@example.test ', password: 'x' })).toEqual({});
  });
});

describe('pesan error login', () => {
  const err = (status: number) => new ApiRequestError(status, { code: 'X', message: 'x' });
  it.each([
    [401, /Email atau kata sandi salah/],
    [400, /Periksa kembali isian/],
    [429, /Terlalu banyak percobaan masuk yang gagal\. Tunggu sebentar/],
    [503, /Layanan sedang tidak tersedia/],
  ])('status %i', (status, pattern) => {
    expect(describeLoginError(err(status))).toMatch(pattern);
  });
  it('429 dengan retryAfterSeconds → dibulatkan ke menit', () => {
    const e = new ApiRequestError(429, { code: 'TOO_MANY_ATTEMPTS', message: 'x', details: { retryAfterSeconds: 61 } });
    expect(describeLoginError(e)).toMatch(/coba lagi dalam 2 menit/);
  });
  it('gangguan jaringan', () => {
    expect(describeLoginError(new TypeError('Failed to fetch'))).toMatch(/Tidak dapat terhubung/);
  });
});

describe('deskripsi cakupan akses', () => {
  const org = { id: 'o', code: 'ORG-1', name: 'Demo Nusantara' };
  it('grant seluruh organisasi', () => {
    const g: Grant = { role: 'ADMIN', includeDescendants: true, organization: org, unit: null };
    expect(describeScope(g)).toBe('Seluruh organisasi Demo Nusantara');
  });
  it('grant cabang dengan turunan', () => {
    const g: Grant = { role: 'MANAGER', includeDescendants: true, organization: org, unit: { id: 'u', code: 'BR-A', name: 'BR-A', type: 'BRANCH' } };
    expect(describeScope(g)).toBe('Cabang BR-A dan unit di bawahnya · Demo Nusantara');
  });
});

describe('sesi', () => {
  it('kedaluwarsa bila waktu lewat atau tidak valid', () => {
    const now = Date.parse('2026-10-31T10:00:00Z');
    expect(isExpired('2026-10-31T10:00:01Z', now)).toBe(false);
    expect(isExpired('2026-10-31T10:00:00Z', now)).toBe(true);
    expect(isExpired('bukan-tanggal', now)).toBe(true);
  });
});
