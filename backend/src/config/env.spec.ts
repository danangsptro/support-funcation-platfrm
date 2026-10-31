import { loadEnv } from './env';

const base = { DATABASE_URL: 'postgresql://u:p@h/db', JWT_SECRET: 'x'.repeat(32) };

describe('loadEnv', () => {
  it('default: port 3000, token 1 jam, cookie non-secure untuk localhost, trust proxy jaringan privat', () => {
    expect(loadEnv(base)).toMatchObject({
      port: 3000,
      jwtExpiresInSeconds: 3600,
      cookieSecure: false,
      trustProxy: 'loopback, linklocal, uniquelocal',
    });
    expect(loadEnv({ ...base, COOKIE_SECURE: 'true' }).cookieSecure).toBe(true);
  });

  it('menolak JWT_SECRET kosong atau terlalu pendek', () => {
    expect(() => loadEnv({ ...base, JWT_SECRET: undefined })).toThrow(/JWT_SECRET/);
    expect(() => loadEnv({ ...base, JWT_SECRET: 'pendek' })).toThrow(/JWT_SECRET/);
  });

  it('menolak DATABASE_URL kosong, masa berlaku token di luar batas, COOKIE_SECURE aneh', () => {
    expect(() => loadEnv({ ...base, DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
    expect(() => loadEnv({ ...base, JWT_EXPIRES_IN_SECONDS: '10' })).toThrow(/JWT_EXPIRES_IN_SECONDS/);
    expect(() => loadEnv({ ...base, COOKIE_SECURE: 'ya' })).toThrow(/COOKIE_SECURE/);
  });
});
