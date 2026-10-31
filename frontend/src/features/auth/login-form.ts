import { ApiRequestError } from '../../lib/api';

export interface LoginValues {
  email: string;
  password: string;
}

export type LoginErrors = Partial<Record<keyof LoginValues, string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validasi ringan di browser agar kesalahan ketik terlihat sebelum dikirim. Backend tetap memvalidasi. */
export function validateLogin(values: LoginValues): LoginErrors {
  const errors: LoginErrors = {};
  const email = values.email.trim();
  if (!email) errors.email = 'Email wajib diisi.';
  else if (!EMAIL.test(email)) errors.email = 'Format email belum benar, contoh: nama@example.test';
  if (!values.password) errors.password = 'Kata sandi wajib diisi.';
  return errors;
}

/** Pesan yang bisa ditindaklanjuti pengguna, bukan kode teknis. */
export function describeLoginError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 401) return 'Email atau kata sandi salah. Periksa kembali, lalu coba lagi.';
    if (error.status === 400) return 'Periksa kembali isian email dan kata sandi Anda.';
    if (error.status === 429) {
      const seconds = (error.body.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
      const minutes = seconds ? Math.max(1, Math.ceil(seconds / 60)) : null;
      return minutes
        ? `Terlalu banyak percobaan masuk yang gagal. Demi keamanan, coba lagi dalam ${minutes} menit.`
        : 'Terlalu banyak percobaan masuk yang gagal. Tunggu sebentar, lalu coba lagi.';
    }
    if (error.status >= 500) return 'Layanan sedang tidak tersedia. Coba lagi dalam beberapa saat.';
  }
  return 'Tidak dapat terhubung ke server. Periksa koneksi Anda atau coba lagi dalam beberapa saat.';
}
