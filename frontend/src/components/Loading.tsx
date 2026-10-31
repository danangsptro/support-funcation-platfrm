/** Indikator memuat yang dipakai bersama: spinner, blok memuat halaman/bagian dengan skeleton. */
export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={`animate-spin text-blue-600 ${className}`} aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Blok memuat: spinner + teks (role=status agar terbaca pembaca layar) dan kerangka konten.
 * `page` = satu halaman penuh (kartu ringkasan + tabel), `section` = satu bagian/panel.
 */
export function LoadingBlock({ label, variant = 'section' }: { label: string; variant?: 'page' | 'section' }) {
  const bar = 'animate-pulse rounded-md bg-slate-200/80';
  return (
    <div className="space-y-4">
      <p role="status" className="flex items-center gap-2.5 text-sm font-medium text-slate-600">
        <Spinner />
        {label}
      </p>
      {variant === 'page' && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl bg-white p-4 ring-1 ring-slate-200">
              <span className={`h-10 w-10 ${bar}`} />
              <span className="flex-1 space-y-2">
                <span className={`block h-4 w-12 ${bar}`} />
                <span className={`block h-3 w-20 ${bar}`} />
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="space-y-3 rounded-2xl bg-white p-5 ring-1 ring-slate-200" aria-hidden="true">
        <span className={`block h-4 w-40 ${bar}`} />
        {[0, 1, 2].map((i) => (
          <span key={i} className="flex items-center gap-3">
            <span className={`h-8 w-8 shrink-0 ${bar}`} />
            <span className={`h-3 flex-1 ${bar}`} style={{ maxWidth: `${90 - i * 15}%` }} />
          </span>
        ))}
      </div>
    </div>
  );
}
