import { CSV_HEADER, csvTemplate } from './labels';

/** Bantuan format file, tertutup secara default agar halaman tetap ringkas. */
export function CsvFormatHelp({ orgCode, unitCode, accountId }: { orgCode: string; unitCode: string; accountId: string }) {
  const href = `data:text/csv;charset=utf-8,${encodeURIComponent(csvTemplate(orgCode, unitCode, accountId))}`;
  return (
    <details className="rounded-lg bg-slate-50 px-4 py-3 text-sm ring-1 ring-slate-200">
      <summary className="cursor-pointer font-medium text-slate-800">Format file CSV</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-700">
        <li>Satu file untuk satu cabang, satu akun, dan satu sumber (internal atau mutasi).</li>
        <li>
          Kolom judul wajib persis: <code className="break-all rounded bg-white px-1 text-xs">{CSV_HEADER}</code>
        </li>
        <li>Tanggal berformat YYYY-MM-DD (contoh 2026-09-10). Nominal tanpa titik ribuan (contoh 1500000.50). Mata uang IDR.</li>
        <li>Bila ada satu baris salah, seluruh file ditolak dan tidak ada data yang tersimpan — perbaiki lalu unggah ulang.</li>
      </ul>
      <a href={href} download="contoh-format-transaksi.csv" className="mt-3 inline-block rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100">
        Unduh contoh file
      </a>
    </details>
  );
}
