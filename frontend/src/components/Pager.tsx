/** Navigasi halaman sederhana; tidak tampil bila hanya ada satu halaman. */
export function Pager({ page, pages, onChange, className = '' }: { page: number; pages: number; onChange(page: number): void; className?: string }) {
  if (pages <= 1) return null;
  const btn = 'rounded-md border border-slate-300 bg-white px-3 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';
  return (
    <nav aria-label="Navigasi halaman" className={`flex items-center justify-between gap-3 text-sm ${className}`}>
      <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)} className={btn}>
        Sebelumnya
      </button>
      <span className="text-slate-600">
        Halaman {page} dari {pages}
      </span>
      <button type="button" disabled={page >= pages} onClick={() => onChange(page + 1)} className={btn}>
        Berikutnya
      </button>
    </nav>
  );
}

/** Pesan gagal memuat dengan tombol ulangi. */
export function LoadError({ message, onRetry }: { message: string; onRetry(): void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-red-50 p-4 text-sm text-red-800 ring-1 ring-red-200">
      <span>{message}</span>
      <button type="button" onClick={onRetry} className="rounded-md bg-white px-3 py-1.5 font-semibold text-red-800 ring-1 ring-red-300 hover:bg-red-100">
        Coba lagi
      </button>
    </div>
  );
}
