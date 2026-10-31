import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/app-exception';
import { LoginThrottle } from './login-throttle.service';

describe('LoginThrottle', () => {
  let t = 0;
  const now = () => t;
  const make = () => new LoginThrottle({ maxPerIpEmail: 3, maxPerIp: 5, windowMs: 60_000 }, now);
  beforeEach(() => (t = 1_000_000));

  function retryAfter(fn: () => void): number | null {
    try {
      fn();
      return null;
    } catch (e) {
      const err = e as AppException;
      expect(err.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      return (err.getResponse() as { details: { retryAfterSeconds: number } }).details.retryAfterSeconds;
    }
  }

  it('memblokir IP+email setelah batas gagal, dengan retryAfter', () => {
    const th = make();
    for (let i = 0; i < 3; i++) {
      th.assertAllowed('1.1.1.1', 'a@x');
      th.recordFailure('1.1.1.1', 'a@x');
    }
    t += 20_000;
    expect(retryAfter(() => th.assertAllowed('1.1.1.1', 'a@x'))).toBe(40);
  });

  it('email yang sama dari IP lain tidak ikut terblokir (tidak bisa mengunci akun korban)', () => {
    const th = make();
    for (let i = 0; i < 3; i++) th.recordFailure('6.6.6.6', 'korban@x');
    expect(retryAfter(() => th.assertAllowed('1.1.1.1', 'korban@x'))).toBeNull();
  });

  it('batas per IP berlaku lintas email', () => {
    const th = make();
    for (const e of ['a', 'b', 'c', 'd', 'e']) th.recordFailure('2.2.2.2', `${e}@x`);
    expect(retryAfter(() => th.assertAllowed('2.2.2.2', 'baru@x'))).toBe(60);
  });

  it('jendela waktu habis → boleh lagi; sukses mereset hitungan IP+email', () => {
    const th = make();
    for (let i = 0; i < 3; i++) th.recordFailure('3.3.3.3', 'a@x');
    t += 60_000;
    expect(retryAfter(() => th.assertAllowed('3.3.3.3', 'a@x'))).toBeNull();
    th.recordFailure('3.3.3.3', 'a@x');
    th.recordFailure('3.3.3.3', 'a@x');
    th.recordSuccess('3.3.3.3', 'a@x');
    th.recordFailure('3.3.3.3', 'a@x');
    expect(retryAfter(() => th.assertAllowed('3.3.3.3', 'a@x'))).toBeNull();
  });
});
