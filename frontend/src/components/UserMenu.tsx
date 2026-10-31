import { useEffect, useId, useRef, useState } from 'react';
import { useAuth } from '../features/auth/AuthContext';
import { ROLE_LABEL } from '../features/auth/access-labels';
import { apiFetch } from '../lib/api';
import { displayName, initials } from '../lib/people';
import { Icon } from './Icon';

type Health = 'checking' | 'up' | 'down';

/** Avatar + status sistem di top bar (latar terang); klik untuk melihat akun dan keluar. */
export function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState<Health>('checking');
  const ref = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const roles = [...new Set(user?.grants.map((g) => ROLE_LABEL[g.role]) ?? [])];

  useEffect(() => {
    let active = true;
    apiFetch('/health/ready')
      .then(() => active && setHealth('up'))
      .catch(() => active && setHealth('down'));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const healthText = { checking: 'Memeriksa sistem…', up: 'Sistem siap', down: 'Sistem tidak tersedia' }[health];
  const dot = { checking: 'bg-slate-400', up: 'bg-emerald-400', down: 'bg-red-500' }[health];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Menu akun ${user?.email ?? ''}`}
        className="flex items-center gap-2.5 rounded-full py-1 pl-1 pr-2 text-left text-slate-900 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-sm font-semibold text-white">
          {initials(user?.email)}
          <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-white ${dot}`} title={healthText} />
        </span>
        <span className="hidden leading-tight md:block">
          <span className="block text-sm font-medium">{displayName(user?.email)}</span>
          <span className="block text-xs text-slate-500">
            {/* Hindari "Finance / Finance": bila nama sama dengan peran, tampilkan email. */}
            {roles.join(', ') === displayName(user?.email) ? user?.email : roles.join(', ') || 'Tanpa peran'}
          </span>
        </span>
        <Icon name="chevron" className="hidden h-4 w-4 text-slate-400 md:block" />
        <span className="sr-only">{healthText}</span>
      </button>

      {open && (
        <div id={menuId} className="absolute right-0 z-20 mt-2 w-72 overflow-hidden rounded-xl bg-white text-slate-900 shadow-xl ring-1 ring-slate-200">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold">{displayName(user?.email)}</p>
            <p className="truncate text-sm text-slate-600">{user?.email}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {roles.map((r) => (
                <span key={r} className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-800 ring-1 ring-blue-200">
                  {r}
                </span>
              ))}
            </div>
          </div>
          <p className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-600">
            <span className={`h-2.5 w-2.5 rounded-full ${dot}`} aria-hidden="true" />
            {healthText}
          </p>
          <button
            type="button"
            onClick={() => void logout('manual')}
            className="flex w-full items-center gap-2 border-t border-slate-100 px-4 py-3 text-left text-sm font-medium text-red-700 hover:bg-red-50"
          >
            <Icon name="logout" className="h-4 w-4" />
            Keluar
          </button>
        </div>
      )}
    </div>
  );
}
