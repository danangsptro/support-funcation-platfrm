import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';

export const CSV_HEADER = [
  'transaction_id',
  'organization_id',
  'unit_id',
  'account_id',
  'reference',
  'transaction_date',
  'amount',
  'currency',
  'transaction_type',
] as const;

/** Baris tervalidasi dan ternormalisasi (kode fixture, bukan UUID). */
export interface CanonicalRow {
  transactionId: string;
  organizationCode: string;
  unitCode: string;
  accountId: string;
  reference: string;
  transactionDate: string;
  amount: string;
  currency: string;
  transactionType: string;
}

/** Nominal canonical: tanpa trailing zero, tanpa eksponen ("700000.00" → "700000"). */
export function canonicalAmount(value: string): string {
  return new Decimal(value).toFixed();
}

/** Isi bisnis transaksi (tanpa identitas) — beda isi dengan ID sama = konflik. */
export function payloadHash(row: CanonicalRow): string {
  return sha256(
    [row.unitCode, row.reference, row.transactionDate, row.amount, row.currency, row.transactionType].join('|'),
  );
}

export interface DatasetScopeKey {
  organizationId: string;
  unitId: string;
  accountId: string;
  side: string;
}

/**
 * Fingerprint dataset: scope + sisi + baris canonical terurut. Urutan baris di file tidak berpengaruh;
 * multiplicity tetap (setiap baris punya transaction_id sendiri dan semuanya ikut di-hash).
 */
export function datasetFingerprint(scope: DatasetScopeKey, rows: CanonicalRow[]): string {
  const lines = rows
    .map((r) =>
      [r.transactionId, r.organizationCode, r.unitCode, r.accountId, r.reference, r.transactionDate, r.amount, r.currency, r.transactionType].join(
        '|',
      ),
    )
    .sort();
  return sha256([`scope:${scope.organizationId}/${scope.unitId}/${scope.accountId}`, `side:${scope.side}`, ...lines].join('\n'));
}

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}
