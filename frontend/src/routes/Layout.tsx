import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Icon, type IconName } from '../components/Icon';
import { UserMenu } from '../components/UserMenu';
import { subscribePending } from '../lib/api';
import { useAuth } from '../features/auth/AuthContext';

/** Menu hanya disembunyikan untuk kenyamanan; backend tetap menolak akses tanpa izin. */
const NAV: { to: string; label: string; icon: IconName; end?: boolean; permission?: string | string[]; hint: string }[] = [
  { to: '/', label: 'Beranda', icon: 'home', end: true, hint: 'Ringkasan dan tindakan cepat' },
  { to: '/reconciliation', label: 'Rekonsiliasi', icon: 'reconcile', permission: 'reconciliation.summary.read', hint: 'Pencocokan transaksi internal & bank' },
  { to: '/performance', label: 'Performa', icon: 'chart', permission: 'analytics.rpe.read', hint: 'KPI, review, dan revenue per karyawan' },
  { to: '/approvals', label: 'Persetujuan', icon: 'approval', permission: ['approval.request.create', 'approval.decide', 'approval.oversight'], hint: 'Pengajuan & persetujuan anggaran' },
  { to: '/organization', label: 'Organisasi', icon: 'org', permission: 'org.read', hint: 'Unit kerja dan karyawan' },
];

const today = () => new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export function Layout() {
  const { can } = useAuth();
  const { pathname } = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const items = NAV.filter((item) => !item.permission || [item.permission].flat().some((p) => can(p)));
  const current = NAV.find((n) => (n.end ? pathname === n.to : pathname.startsWith(n.to))) ?? null;

  // Progress bar: tampil saat pindah halaman (minimal sebentar agar terlihat) dan selama request API berjalan.
  const [pending, setPending] = useState(0);
  const [navigating, setNavigating] = useState(false);
  useEffect(() => subscribePending(setPending), []);
  useEffect(() => {
    setNavigating(true);
    const t = window.setTimeout(() => setNavigating(false), 450);
    return () => window.clearTimeout(t);
  }, [pathname]);
  const busy = navigating || pending > 0;

  // Pindah halaman menutup drawer seluler.
  useEffect(() => setDrawerOpen(false), [pathname]);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const sidebar = (label: string) => (
    <div className="flex h-full flex-col bg-gradient-to-b from-slate-900 via-slate-900 to-blue-950 text-white">
      <div className="flex items-center gap-3 px-5 py-5">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-900/40">
          <Icon name="logo" />
        </span>
        <span className="leading-tight">
          <span className="block text-sm font-semibold tracking-tight">Support Function</span>
          <span className="block text-[11px] uppercase tracking-widest text-blue-200/70">Platform</span>
        </span>
      </div>
      <nav aria-label={label} className="flex-1 overflow-y-auto px-3 pb-4">
        <p className="px-3 pb-2 pt-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Menu</p>
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                    isActive ? 'bg-white/10 text-white shadow-inner ring-1 ring-white/10' : 'text-slate-300 hover:bg-white/5 hover:text-white'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && <span aria-hidden="true" className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-blue-400" />}
                    <span
                      className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
                        isActive ? 'bg-blue-600 text-white shadow-md shadow-blue-900/50' : 'bg-white/5 text-slate-300 group-hover:bg-white/10 group-hover:text-white'
                      }`}
                    >
                      <Icon name={item.icon} className="h-4 w-4" />
                    </span>
                    {item.label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="border-t border-white/10 px-5 py-4 text-xs text-slate-400">
        <p className="font-medium text-slate-300">Demo · data fixture</p>
        <p>Akses mengikuti peran & cakupan Anda.</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      {/* Desktop: sidebar tetap di kiri. */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 shadow-xl lg:block">{sidebar('Navigasi utama')}</aside>

      {/* Seluler: sidebar sebagai drawer. */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Tutup menu" onClick={() => setDrawerOpen(false)} className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-2xl">{sidebar('Navigasi utama (seluler)')}</aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div
            role="progressbar"
            aria-label="Memuat halaman"
            aria-hidden={!busy}
            className={`absolute inset-x-0 bottom-0 h-0.5 overflow-hidden transition-opacity duration-300 ${busy ? 'opacity-100' : 'opacity-0'}`}
          >
            <span className="animate-route-progress block h-full w-1/3 rounded-full bg-gradient-to-r from-blue-400 via-blue-600 to-indigo-500" />
          </div>
          <div className="flex items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Buka menu"
              aria-expanded={drawerOpen}
              className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100 lg:hidden"
            >
              <Icon name="menu" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900">{current?.label ?? 'Support Function Platform'}</p>
              <p className="hidden truncate text-xs text-slate-500 sm:block">{current ? `${current.hint} · ${today()}` : today()}</p>
            </div>
            <UserMenu />
          </div>
        </header>
        <main key={pathname} className="animate-page-in mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
