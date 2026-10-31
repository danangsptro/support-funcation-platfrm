import { parse } from 'csv-parse/sync';
import Decimal from 'decimal.js';
import { isValidIsoDate } from '../../common/dates';
import { canonicalAmount, CanonicalRow, CSV_HEADER } from './canonical';

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 1024 * 1024;
export const MAX_REPORTED_ERRORS = 100;
const SUPPORTED_CURRENCIES = new Set(['IDR']);
const SUPPORTED_TYPES = new Set(['REVENUE']);
/** Desimal polos tanpa pemisah ribuan/eksponen, maks. 18 digit bulat dan 2 desimal (NUMERIC(20,2)). */
const AMOUNT = /^-?\d{1,18}(\.\d{1,2})?$/;

export type RowErrorCode =
  | 'INVALID_AMOUNT'
  | 'INVALID_DATE'
  | 'REQUIRED_REFERENCE'
  | 'REQUIRED_FIELD'
  | 'UNSUPPORTED_CURRENCY'
  | 'UNSUPPORTED_TRANSACTION_TYPE'
  | 'UNKNOWN_UNIT'
  | 'UNIT_ORG_MISMATCH'
  | 'ROW_SCOPE_MISMATCH'
  | 'NEGATIVE_REVENUE'
  | 'DUPLICATE_TRANSACTION_ID'
  | 'COLUMN_COUNT';

export interface RowError {
  /** Nomor baris di file (header = baris 1). */
  line: number;
  transactionId: string | null;
  code: RowErrorCode;
  message: string;
}

export type FileErrorCode = 'INVALID_CSV' | 'INVALID_HEADER' | 'EMPTY_FILE' | 'TOO_MANY_ROWS';

export interface ImportContext {
  /** Kode organisasi & unit dataset (scope yang dipilih pengguna, sudah lolos otorisasi). */
  organizationCode: string;
  unitCode: string;
  accountId: string;
  /** Semua unit yang dikenal: kode → kode organisasi pemiliknya (kode unit unik per organisasi). */
  unitOrganizations: Map<string, Set<string>>;
}

export type ParseResult =
  | { ok: true; rows: CanonicalRow[] }
  | { ok: false; fileError: { code: FileErrorCode; message: string } }
  | { ok: false; rowErrors: RowError[]; totalErrors: number };

const MESSAGES: Record<RowErrorCode, string> = {
  INVALID_AMOUNT: 'Nominal harus angka desimal tanpa pemisah ribuan, maksimal 2 angka di belakang titik',
  INVALID_DATE: 'Tanggal harus tanggal kalender valid berformat YYYY-MM-DD',
  REQUIRED_REFERENCE: 'Nomor referensi wajib diisi',
  REQUIRED_FIELD: 'Kolom wajib kosong',
  UNSUPPORTED_CURRENCY: 'Mata uang belum didukung (hanya IDR)',
  UNSUPPORTED_TRANSACTION_TYPE: 'Tipe transaksi belum didukung (hanya REVENUE)',
  UNKNOWN_UNIT: 'Unit tidak dikenal',
  UNIT_ORG_MISMATCH: 'Unit bukan milik organisasi pada baris ini',
  ROW_SCOPE_MISMATCH: 'Baris berada di luar organisasi/unit/akun dataset yang dipilih',
  NEGATIVE_REVENUE: 'Nominal revenue harus lebih besar dari 0',
  DUPLICATE_TRANSACTION_ID: 'transaction_id muncul lebih dari sekali di file',
  COLUMN_COUNT: 'Jumlah kolom tidak sesuai header',
};

/**
 * Parse + validasi seluruh file sebelum apa pun disimpan. Satu baris salah → seluruh file ditolak.
 * Urutan cek per baris mengikuti docs/business-rules.md §2.1 sehingga reason deterministik.
 */
export function parseTransactionsCsv(content: Buffer | string, ctx: ImportContext): ParseResult {
  let records: string[][];
  try {
    // Akhir baris campuran (CRLF/LF/CR) diterima; tanpa ini csv-parse mengunci delimiter dari baris pertama.
    records = parse(content, {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: false,
      record_delimiter: ['\r\n', '\n', '\r'],
    });
  } catch (err) {
    return { ok: false, fileError: { code: 'INVALID_CSV', message: `File bukan CSV yang valid: ${(err as Error).message}` } };
  }
  if (records.length === 0) return { ok: false, fileError: { code: 'EMPTY_FILE', message: 'File kosong' } };

  const header = records[0].map((h) => h.trim());
  if (header.length !== CSV_HEADER.length || header.some((h, i) => h !== CSV_HEADER[i])) {
    return {
      ok: false,
      fileError: { code: 'INVALID_HEADER', message: `Header harus persis: ${CSV_HEADER.join(',')}` },
    };
  }
  const data = records.slice(1);
  if (data.length === 0) return { ok: false, fileError: { code: 'EMPTY_FILE', message: 'File tidak berisi transaksi' } };
  if (data.length > MAX_IMPORT_ROWS) {
    return { ok: false, fileError: { code: 'TOO_MANY_ROWS', message: `Maksimal ${MAX_IMPORT_ROWS} baris per file` } };
  }

  const rows: CanonicalRow[] = [];
  const errors: RowError[] = [];
  const seenIds = new Set<string>();
  data.forEach((cells, i) => {
    const line = i + 2;
    const result = validateRow(cells, ctx);
    if ('code' in result) {
      errors.push({ line, transactionId: cells[0]?.trim() || null, code: result.code, message: MESSAGES[result.code] });
      return;
    }
    if (seenIds.has(result.transactionId)) {
      errors.push({ line, transactionId: result.transactionId, code: 'DUPLICATE_TRANSACTION_ID', message: MESSAGES.DUPLICATE_TRANSACTION_ID });
      return;
    }
    seenIds.add(result.transactionId);
    rows.push(result);
  });

  if (errors.length > 0) {
    return { ok: false, rowErrors: errors.slice(0, MAX_REPORTED_ERRORS), totalErrors: errors.length };
  }
  return { ok: true, rows };
}

function validateRow(cells: string[], ctx: ImportContext): CanonicalRow | { code: RowErrorCode } {
  if (cells.length !== CSV_HEADER.length) return { code: 'COLUMN_COUNT' };
  const [transactionId, organizationCode, unitCode, accountId, reference, date, amount, currency, type] = cells.map((c) => c.trim());

  if (!AMOUNT.test(amount)) return { code: 'INVALID_AMOUNT' };
  if (!isValidIsoDate(date)) return { code: 'INVALID_DATE' };
  if (!reference) return { code: 'REQUIRED_REFERENCE' };
  if (!transactionId || !organizationCode || !unitCode || !accountId || !currency || !type) return { code: 'REQUIRED_FIELD' };
  if (!SUPPORTED_CURRENCIES.has(currency)) return { code: 'UNSUPPORTED_CURRENCY' };
  if (!SUPPORTED_TYPES.has(type)) return { code: 'UNSUPPORTED_TRANSACTION_TYPE' };

  const owners = ctx.unitOrganizations.get(unitCode);
  if (!owners) return { code: 'UNKNOWN_UNIT' };
  if (!owners.has(organizationCode)) return { code: 'UNIT_ORG_MISMATCH' };
  if (organizationCode !== ctx.organizationCode || unitCode !== ctx.unitCode || accountId !== ctx.accountId) {
    return { code: 'ROW_SCOPE_MISMATCH' };
  }
  if (new Decimal(amount).lessThanOrEqualTo(0)) return { code: 'NEGATIVE_REVENUE' };

  return {
    transactionId,
    organizationCode,
    unitCode,
    accountId,
    reference,
    transactionDate: date,
    amount: canonicalAmount(amount),
    currency,
    transactionType: type,
  };
}
