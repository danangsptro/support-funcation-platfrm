import Decimal from 'decimal.js';
import { readFixture, readFixtureJson, type ExpectedRecon } from '../../../test/fixtures/fixtures';
import { canonicalAmount, CanonicalRow, datasetFingerprint, payloadHash } from './canonical';
import { ImportContext, MAX_IMPORT_ROWS, parseTransactionsCsv } from './csv-import';
import { MatchInput, reconcile, summarize } from './matcher';
import { MATCH_RULES, STATUS_LABEL } from './rules';

const UNITS = new Map<string, Set<string>>([
  ['DIV-1', new Set(['ORG-1'])],
  ['BR-A', new Set(['ORG-1'])],
  ['BR-B', new Set(['ORG-1'])],
  ['BR-ZERO', new Set(['ORG-1'])],
  ['CC-A', new Set(['ORG-1'])],
  ['BR-X', new Set(['ORG-2'])],
]);
const ctx = (unitCode = 'BR-A', organizationCode = 'ORG-1', accountId = 'ACC-1'): ImportContext => ({
  organizationCode,
  unitCode,
  accountId,
  unitOrganizations: UNITS,
});

function rowsOf(file: string, c = ctx()): CanonicalRow[] {
  const r = parseTransactionsCsv(readFixture(file), c);
  if (!r.ok) throw new Error(`fixture ${file} gagal diparse: ${JSON.stringify(r)}`);
  return r.rows;
}

const toInput = (r: CanonicalRow): MatchInput => ({
  id: r.transactionId,
  sourceTransactionId: r.transactionId,
  organizationId: r.organizationCode,
  unitId: r.unitCode,
  accountId: r.accountId,
  currency: r.currency,
  reference: r.reference,
  transactionDate: r.transactionDate,
  amount: r.amount,
});

const BR_A_INT = 'reconciliation/scoped/ORG-1-BR-A-internal.csv';
const BR_A_EXT = 'reconciliation/scoped/ORG-1-BR-A-external.csv';

describe('matcher vs reconciliation/expected-results.json (bukan snapshot buatan matcher)', () => {
  const expected = readFixtureJson<ExpectedRecon>('reconciliation/expected-results.json');
  const groups = reconcile(rowsOf(BR_A_INT).map(toInput), rowsOf(BR_A_EXT).map(toInput), MATCH_RULES.v1);

  it('BR-A v1: 7 grup identik dengan expected (status, reason, seluruh ID)', () => {
    const actual = groups.map((g) => ({
      reference: g.reference,
      status: STATUS_LABEL[g.status],
      reason: g.reason,
      internal_ids: g.internal.map((t) => t.sourceTransactionId),
      external_ids: g.external.map((t) => t.sourceTransactionId),
    }));
    expect(actual).toEqual(expected.results);
  });

  it('ringkasan: rasio 2/7, anomali 7.900.000 / 6.400.000, selisih pasangan unik 100.000, verified 15.000.000', () => {
    const s = summarize(groups);
    const e = expected.summary;
    expect(s.groups).toBe(e.groups);
    expect(s.counts).toEqual({ MATCHED: 2, MISMATCHED: 3, MISSING_IN_INTERNAL: 1, MISSING_IN_EXTERNAL: 1 });
    expect(new Decimal(s.counts.MATCHED).div(s.groups).times(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2)).toBe(
      e.matched_ratio_percent_rounded,
    );
    expect(s.verifiedRevenue.toFixed()).toBe(e.verified_revenue);
    expect(s.anomalousInternalTotal.toFixed()).toBe(e.anomalous_internal_total);
    expect(s.anomalousExternalTotal.toFixed()).toBe(e.anomalous_external_total);
    expect(s.uniquePairAmountDifferenceTotal.toFixed()).toBe(e.unique_pair_amount_difference_total);
  });

  it('other_scopes: BR-B dan ORG-2 BR-X masing-masing Matched dengan revenue sesuai', () => {
    for (const o of expected.other_scopes) {
      const prefix = `reconciliation/scoped/${o.organization_id}-${o.unit_id}`;
      const c = ctx(o.unit_id, o.organization_id, o.organization_id === 'ORG-2' ? 'ACC-2' : 'ACC-1');
      const g = reconcile(rowsOf(`${prefix}-internal.csv`, c).map(toInput), rowsOf(`${prefix}-external.csv`, c).map(toInput), MATCH_RULES.v1);
      expect(g.map((x) => STATUS_LABEL[x.status])).toEqual([o.status]);
      expect(summarize(g).verifiedRevenue.toFixed()).toBe(o.verified_revenue);
    }
  });

  it('RULE-V2: toleransi 2 hari → REF-004 Matched, verified 17.000.000', () => {
    const v2 = reconcile(rowsOf(BR_A_INT).map(toInput), rowsOf(BR_A_EXT).map(toInput), MATCH_RULES.v2);
    expect(v2.find((g) => g.reference === 'REF-004')?.status).toBe('MATCHED');
    expect(summarize(v2).verifiedRevenue.toFixed()).toBe('17000000');
  });

  it('deterministik: urutan input diacak → output identik', () => {
    const shuffled = reconcile(rowsOf(BR_A_INT).map(toInput).reverse(), rowsOf(BR_A_EXT).map(toInput).reverse(), MATCH_RULES.v1);
    expect(shuffled).toEqual(groups);
  });
});

describe('matcher — batas dan prioritas', () => {
  const t = (id: string, ref: string, date: string, amount: string): MatchInput => ({
    id,
    sourceTransactionId: id,
    organizationId: 'O',
    unitId: 'U',
    accountId: 'A',
    currency: 'IDR',
    reference: ref,
    transactionDate: date,
    amount,
  });

  it.each([
    ['2026-09-10', '2026-09-11', 'v1', 'MATCHED'],
    ['2026-09-10', '2026-09-09', 'v1', 'MATCHED'],
    ['2026-09-10', '2026-09-12', 'v1', 'MISMATCHED'],
    ['2026-09-10', '2026-09-08', 'v1', 'MISMATCHED'],
    ['2026-09-10', '2026-09-12', 'v2', 'MATCHED'],
    ['2026-09-30', '2026-10-01', 'v1', 'MATCHED'],
    ['2026-02-28', '2026-03-01', 'v1', 'MATCHED'],
  ])('tanggal %s vs %s (%s) → %s', (a, b, v, status) => {
    const [g] = reconcile([t('I', 'R', a, '100')], [t('E', 'R', b, '100')], MATCH_RULES[v]);
    expect(g.status).toBe(status);
  });

  it('nominal exact decimal: 1000 = 1000.00, 1000 ≠ 1000.01', () => {
    expect(reconcile([t('I', 'R', '2026-09-10', '1000')], [t('E', 'R', '2026-09-10', '1000.00')], MATCH_RULES.v1)[0].status).toBe('MATCHED');
    const [g] = reconcile([t('I', 'R', '2026-09-10', '1000')], [t('E', 'R', '2026-09-10', '1000.01')], MATCH_RULES.v1);
    expect([g.status, g.reason, g.amountDifference?.toFixed()]).toEqual(['MISMATCHED', 'AMOUNT_DIFFERENCE', '0.01']);
  });

  it('amount diprioritaskan di atas date', () => {
    const [g] = reconcile([t('I', 'R', '2026-09-01', '100')], [t('E', 'R', '2026-09-20', '200')], MATCH_RULES.v1);
    expect(g.reason).toBe('AMOUNT_DIFFERENCE');
  });

  it('duplicate diprioritaskan di atas missing dan tidak pernah dipasangkan', () => {
    const [g] = reconcile([t('I1', 'R', '2026-09-10', '100'), t('I2', 'R', '2026-09-10', '100')], [], MATCH_RULES.v1);
    expect([g.status, g.reason, g.internal.map((x) => x.id)]).toEqual(['MISMATCHED', 'DUPLICATE_REFERENCE', ['I1', 'I2']]);
    expect(g.amountDifference).toBeNull();
  });

  it('referensi di-trim; referensi sama di unit berbeda = grup berbeda', () => {
    const [g] = reconcile([t('I', ' R-1 ', '2026-09-10', '5')], [t('E', 'R-1', '2026-09-10', '5')], MATCH_RULES.v1);
    expect(g.status).toBe('MATCHED');
    const other = { ...t('E2', 'R-1', '2026-09-10', '5'), unitId: 'U2' };
    expect(reconcile([t('I', 'R-1', '2026-09-10', '5')], [other], MATCH_RULES.v1)).toHaveLength(2);
  });
});

describe('CSV import — validasi dan fixture invalid', () => {
  const invalid = readFixtureJson<{ cases: { file: string; reason: string }[] }>('invalid/expected.json');

  it.each(invalid.cases.map((c) => [c.file, c.reason]))('%s → %s', (file, reason) => {
    const r = parseTransactionsCsv(readFixture(`invalid/${file}`), ctx());
    expect(r.ok).toBe(false);
    expect('rowErrors' in r && r.rowErrors.map((e) => e.code)).toEqual([reason]);
    expect('rowErrors' in r && r.rowErrors[0].line).toBe(2);
  });

  it('file gabungan multi-scope → ROW_SCOPE_MISMATCH untuk baris di luar scope', () => {
    const r = parseTransactionsCsv(readFixture('reconciliation/internal-transactions.csv'), ctx());
    expect(r.ok).toBe(false);
    if (!('rowErrors' in r)) throw new Error('harus row error');
    expect(r.rowErrors.map((e) => [e.transactionId, e.code])).toEqual([
      ['I8', 'ROW_SCOPE_MISMATCH'],
      ['I9', 'ROW_SCOPE_MISMATCH'], // ORG-2/BR-X konsisten, tetapi di luar scope dataset ORG-1/BR-A
    ]);
  });

  it('akhir baris campuran: header CRLF (fixture) + baris LF tetap terbaca', () => {
    const header = readFixture(BR_A_INT).toString('utf8').split('\n')[0];
    expect(header.endsWith('\r')).toBe(true);
    const r = parseTransactionsCsv(`${header}\nT1,ORG-1,BR-A,ACC-1,R1,2026-09-10,1,IDR,REVENUE\rT2,ORG-1,BR-A,ACC-1,R2,2026-09-10,2,IDR,REVENUE\n`, ctx());
    expect(r).toMatchObject({ ok: true, rows: [{ transactionId: 'T1' }, { transactionId: 'T2' }] });
  });

  it('header salah, file kosong, terlalu banyak baris, kolom kurang, ID ganda, BOM & CRLF', () => {
    expect(parseTransactionsCsv('id,amount\n1,2', ctx())).toMatchObject({ ok: false, fileError: { code: 'INVALID_HEADER' } });
    expect(parseTransactionsCsv('', ctx())).toMatchObject({ ok: false, fileError: { code: 'EMPTY_FILE' } });
    const header = readFixture(BR_A_INT).toString('utf8').split('\n')[0];
    expect(parseTransactionsCsv(`${header}\n`, ctx())).toMatchObject({ ok: false, fileError: { code: 'EMPTY_FILE' } });
    const many = [header, ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `T${i},ORG-1,BR-A,ACC-1,R${i},2026-09-10,1,IDR,REVENUE`)].join('\n');
    expect(parseTransactionsCsv(many, ctx())).toMatchObject({ ok: false, fileError: { code: 'TOO_MANY_ROWS' } });
    const short = parseTransactionsCsv(`${header}\nT1,ORG-1,BR-A`, ctx());
    expect('rowErrors' in short && short.rowErrors[0].code).toBe('COLUMN_COUNT');
    const dup = parseTransactionsCsv(`${header}\nT1,ORG-1,BR-A,ACC-1,R1,2026-09-10,1,IDR,REVENUE\nT1,ORG-1,BR-A,ACC-1,R2,2026-09-10,1,IDR,REVENUE`, ctx());
    expect('rowErrors' in dup && dup.rowErrors.map((e) => [e.line, e.code])).toEqual([[3, 'DUPLICATE_TRANSACTION_ID']]);
    const bomCrlf = parseTransactionsCsv(`\uFEFF${header}\r\nT1,ORG-1,BR-A,ACC-1, R1 ,2026-09-10,1500.50,IDR,REVENUE\r\n`, ctx());
    expect(bomCrlf).toMatchObject({ ok: true, rows: [{ reference: 'R1', amount: '1500.5' }] });
  });

  it('nominal: nol & negatif ditolak, pemisah ribuan/eksponen/3 desimal ditolak', () => {
    const header = readFixture(BR_A_INT).toString('utf8').split('\n')[0];
    const code = (amount: string) => {
      const r = parseTransactionsCsv(`${header}\nT1,ORG-1,BR-A,ACC-1,R1,2026-09-10,${amount},IDR,REVENUE`, ctx());
      return r.ok ? 'OK' : 'rowErrors' in r ? r.rowErrors[0].code : r.fileError.code;
    };
    expect(['0', '0.00', '-5', '1e5', '1.000', '"1,000"', '100.5'].map(code)).toEqual([
      'NEGATIVE_REVENUE',
      'NEGATIVE_REVENUE',
      'NEGATIVE_REVENUE',
      'INVALID_AMOUNT',
      'INVALID_AMOUNT',
      'INVALID_AMOUNT',
      'OK',
    ]);
  });
});

describe('fingerprint & payload', () => {
  const scope = { organizationId: 'org', unitId: 'unit', accountId: 'ACC-1', side: 'INTERNAL' };
  const rows = rowsOf(BR_A_INT);

  it('urutan baris tidak memengaruhi fingerprint; multiplicity dipertahankan', () => {
    expect(datasetFingerprint(scope, [...rows].reverse())).toBe(datasetFingerprint(scope, rows));
    const withoutDuplicate = rows.filter((r) => r.transactionId !== 'I7');
    expect(datasetFingerprint(scope, withoutDuplicate)).not.toBe(datasetFingerprint(scope, rows));
  });

  it('sisi/scope berbeda → fingerprint berbeda; format nominal setara → sama', () => {
    expect(datasetFingerprint({ ...scope, side: 'EXTERNAL' }, rows)).not.toBe(datasetFingerprint(scope, rows));
    expect(canonicalAmount('700000.00')).toBe('700000');
    const a = { ...rows[0], amount: canonicalAmount('10000000.00') };
    expect(payloadHash(a)).toBe(payloadHash(rows[0]));
    expect(payloadHash({ ...rows[0], amount: '10000001' })).not.toBe(payloadHash(rows[0]));
  });
});
