import { assertConnectedTestDatabase, assertTestDatabaseUrl } from './test-db-guard';

describe('T-INF-03 guard reset database test', () => {
  const testUrl = 'postgresql://app_owner:pw@localhost:5433/support_test';

  it('mengizinkan database *_test saat NODE_ENV=test', () => {
    expect(assertTestDatabaseUrl(testUrl, 'test')).toBe('support_test');
  });

  it.each([
    ['database utama', 'postgresql://u:p@localhost:5433/support'],
    ['nama mengandung test di tengah', 'postgresql://u:p@localhost:5433/test_support'],
    ['database postgres', 'postgresql://u:p@localhost:5433/postgres'],
    ['tanpa nama database', 'postgresql://u:p@localhost:5433'],
    ['URL rusak', 'bukan-url'],
  ])('menolak %s', (_label, url) => {
    expect(() => assertTestDatabaseUrl(url, 'test')).toThrow(/ditolak/);
  });

  it('menolak bila URL kosong', () => {
    expect(() => assertTestDatabaseUrl(undefined, 'test')).toThrow(/ditolak/);
  });

  it('menolak bila NODE_ENV bukan test walau nama database *_test', () => {
    expect(() => assertTestDatabaseUrl(testUrl, 'production')).toThrow(/NODE_ENV/);
  });

  it('cek sisi server menolak koneksi ke database non-test', () => {
    expect(() => assertConnectedTestDatabase('support')).toThrow(/ditolak/);
    expect(() => assertConnectedTestDatabase('support_test')).not.toThrow();
  });
});
