import type { MatchStatus } from './types';

export const STATUS_LABEL: Record<MatchStatus, string> = {
  MATCHED: 'Matched',
  MISMATCHED: 'Mismatched',
  MISSING_IN_INTERNAL: 'Missing in Internal',
  MISSING_IN_EXTERNAL: 'Missing in External',
};

export const STATUS_STYLE: Record<MatchStatus, string> = {
  MATCHED: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  MISMATCHED: 'bg-amber-50 text-amber-900 ring-amber-200',
  MISSING_IN_INTERNAL: 'bg-rose-50 text-rose-800 ring-rose-200',
  MISSING_IN_EXTERNAL: 'bg-rose-50 text-rose-800 ring-rose-200',
};

/** Alasan singkat (kolom tabel). */
export const REASON_LABEL: Record<string, string> = {
  AMOUNT_DIFFERENCE: 'Nominal berbeda',
  DATE_OUTSIDE_TOLERANCE: 'Tanggal di luar toleransi',
  DUPLICATE_REFERENCE: 'Referensi ganda — tinjau manual',
  NO_INTERNAL: 'Tidak ada di catatan internal',
  NO_EXTERNAL: 'Tidak ada di catatan eksternal',
};

/** Panduan tindak lanjut untuk staf Finance, urut dari yang paling sering perlu aksi. */
export const REASON_GUIDE: { reason: string; title: string; action: string }[] = [
  {
    reason: 'NO_EXTERNAL',
    title: 'Ada di catatan internal, tidak ada di mutasi',
    action: 'Pastikan dana benar-benar diterima. Bisa jadi belum masuk mutasi bank atau tercatat di akun lain.',
  },
  {
    reason: 'NO_INTERNAL',
    title: 'Ada di mutasi, tidak ada di catatan internal',
    action: 'Telusuri asal dana dan catat transaksi yang terlewat di sistem internal.',
  },
  {
    reason: 'AMOUNT_DIFFERENCE',
    title: 'Nominal berbeda',
    action: 'Bandingkan bukti transaksi kedua sisi — misalnya potongan biaya atau salah input.',
  },
  {
    reason: 'DATE_OUTSIDE_TOLERANCE',
    title: 'Tanggal berbeda melebihi toleransi',
    action: 'Periksa tanggal pencatatan; sering terjadi karena keterlambatan settlement.',
  },
  {
    reason: 'DUPLICATE_REFERENCE',
    title: 'Nomor referensi ganda',
    action: 'Sistem tidak menebak pasangannya. Tinjau manual transaksi dengan referensi yang sama.',
  },
];

/** Pilihan aturan dalam bahasa sehari-hari (kode versi tetap tercatat di sistem). */
export const RULE_OPTIONS: { version: string; title: string; description: string; recommended?: boolean }[] = [
  { version: 'v1', title: 'Standar', description: 'Tanggal boleh berbeda 1 hari, nominal harus sama persis.', recommended: true },
  { version: 'v2', title: 'Longgar', description: 'Tanggal boleh berbeda 2 hari, nominal harus sama persis.' },
];

export function ruleTitle(version: string): string {
  const r = RULE_OPTIONS.find((o) => o.version === version);
  return r ? `${r.title} (±${version === 'v1' ? 1 : 2} hari)` : version;
}

export const SIDE_TEXT = {
  INTERNAL: { title: 'Catatan internal', hint: 'Transaksi dari sistem operasional perusahaan.' },
  EXTERNAL: { title: 'Mutasi bank / pihak ketiga', hint: 'Mutasi rekening atau laporan dari pihak ketiga.' },
} as const;

/** Pesan import yang bisa ditindaklanjuti. */
export function describeImportError(code: string, message: string): string {
  const map: Record<string, string> = {
    INVALID_HEADER: 'Kolom judul (header) file tidak sesuai format. Lihat “Format file CSV” dan unduh contohnya.',
    EMPTY_FILE: 'File tidak berisi transaksi.',
    TOO_MANY_ROWS: 'File terlalu besar: maksimal 5.000 baris. Pecah menjadi beberapa file.',
    PAYLOAD_TOO_LARGE: 'Ukuran file melebihi 1 MB.',
    UNSUPPORTED_FILE_TYPE: 'Hanya file .csv yang bisa diunggah.',
    FILE_REQUIRED: 'Pilih file CSV terlebih dulu.',
    TRANSACTION_CONFLICT: 'Sebagian transaksi sudah pernah diunggah dengan isi berbeda. Tidak ada data yang disimpan.',
    INVALID_CSV: 'File tidak bisa dibaca sebagai CSV.',
  };
  return map[code] ?? message;
}

export const CSV_HEADER = 'transaction_id,organization_id,unit_id,account_id,reference,transaction_date,amount,currency,transaction_type';

export function csvTemplate(orgCode: string, unitCode: string, accountId: string): string {
  return `${CSV_HEADER}\nTRX-001,${orgCode},${unitCode},${accountId},REF-001,2026-09-10,1500000.00,IDR,REVENUE\n`;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}
