import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/app-exception';

export interface LoginThrottleOptions {
  /** Gagal maksimum per kombinasi IP + email dalam satu jendela. */
  maxPerIpEmail: number;
  /** Gagal maksimum per IP (semua email) dalam satu jendela. */
  maxPerIp: number;
  windowMs: number;
}

export const DEFAULT_LOGIN_THROTTLE: LoginThrottleOptions = {
  maxPerIpEmail: 5,
  maxPerIp: 30,
  windowMs: 15 * 60 * 1000,
};

interface Bucket {
  failures: number;
  resetAt: number;
}

/**
 * Pembatas percobaan login gagal (fixed window, in-memory).
 * Kunci IP+email, bukan email saja, agar penyerang tidak bisa mengunci akun orang lain dari IP lain.
 * Batas: state per proses API — bila API diskalakan >1 instance, pindahkan ke store bersama (Redis/DB).
 */
export class LoginThrottle {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly options: LoginThrottleOptions = DEFAULT_LOGIN_THROTTLE,
    private readonly now: () => number = Date.now,
  ) {}

  /** Lempar 429 TOO_MANY_ATTEMPTS bila salah satu kunci sudah mencapai batas. */
  assertAllowed(ip: string, email: string): void {
    const retryMs = Math.max(
      this.blockedFor(ipEmailKey(ip, email), this.options.maxPerIpEmail),
      this.blockedFor(ipKey(ip), this.options.maxPerIp),
    );
    if (retryMs > 0) {
      const retryAfterSeconds = Math.ceil(retryMs / 1000);
      throw new AppException(
        HttpStatus.TOO_MANY_REQUESTS,
        'TOO_MANY_ATTEMPTS',
        'Terlalu banyak percobaan masuk. Coba lagi nanti.',
        { retryAfterSeconds },
      );
    }
  }

  recordFailure(ip: string, email: string): void {
    this.increment(ipEmailKey(ip, email));
    this.increment(ipKey(ip));
  }

  /** Login berhasil menghapus hitungan IP+email (hitungan IP tetap, mencegah tebak-massal lintas akun). */
  recordSuccess(ip: string, email: string): void {
    this.buckets.delete(ipEmailKey(ip, email));
  }

  private blockedFor(key: string, max: number): number {
    const b = this.live(key);
    return b && b.failures >= max ? b.resetAt - this.now() : 0;
  }

  private increment(key: string): void {
    const b = this.live(key) ?? { failures: 0, resetAt: this.now() + this.options.windowMs };
    b.failures += 1;
    this.buckets.set(key, b);
    if (this.buckets.size > 10_000) this.sweep();
  }

  private live(key: string): Bucket | undefined {
    const b = this.buckets.get(key);
    if (b && b.resetAt <= this.now()) {
      this.buckets.delete(key);
      return undefined;
    }
    return b;
  }

  private sweep(): void {
    for (const [k, b] of this.buckets) if (b.resetAt <= this.now()) this.buckets.delete(k);
  }
}

const ipKey = (ip: string) => `ip:${ip}`;
const ipEmailKey = (ip: string, email: string) => `ip-email:${ip}:${email}`;
