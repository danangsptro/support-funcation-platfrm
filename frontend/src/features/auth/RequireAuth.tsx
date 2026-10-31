import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Spinner } from '../../components/Loading';
import { useAuth } from './AuthContext';

/** Kenyamanan UI saja: backend tetap menolak request tanpa token/izin. */
export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-100" role="status">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-lg ring-1 ring-slate-200">
          <Spinner className="h-7 w-7" />
        </span>
        <span className="text-sm font-medium text-slate-600">Memuat sesi Anda…</span>
      </div>
    );
  }
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <Outlet />;
}
