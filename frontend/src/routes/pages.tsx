import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h1 className="text-xl font-semibold">Halaman tidak ditemukan</h1>
      <Link to="/" className="mt-3 inline-block text-sm text-blue-700 underline">
        Kembali ke beranda
      </Link>
    </section>
  );
}
