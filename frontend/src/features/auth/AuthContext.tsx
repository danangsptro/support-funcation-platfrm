import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { apiFetch, setUnauthorizedHandler } from '../../lib/api';
import { clearHadSession, hadSession, markHadSession } from './session';
import type { LoginResponse, UserProfile } from './types';

export type LogoutReason = 'manual' | 'expired';

interface AuthState {
  status: 'loading' | 'authenticated' | 'anonymous';
  user: UserProfile | null;
  /** Alasan sesi terakhir berakhir; ditampilkan di halaman login. */
  lastLogoutReason: LogoutReason | null;
  login(email: string, password: string): Promise<void>;
  logout(reason?: LogoutReason): Promise<void>;
  can(permission: string): boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [lastLogoutReason, setLastLogoutReason] = useState<LogoutReason | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  const endSession = useCallback((reason: LogoutReason) => {
    setUser(null);
    setExpiresAt(null);
    setStatus('anonymous');
    setLastLogoutReason(reason);
    if (reason === 'manual') clearHadSession();
  }, []);

  const logout = useCallback(
    async (reason: LogoutReason = 'manual') => {
      // Cookie httpOnly hanya bisa dihapus oleh server.
      await apiFetch('/auth/logout', { method: 'POST' }).catch(() => undefined);
      endSession(reason);
    },
    [endSession],
  );

  // 401 di tengah pemakaian = sesi habis/dicabut.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (statusRef.current === 'authenticated') void logout('expired');
    });
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  // Saat halaman dibuka: cookie (bila ada) dikirim otomatis; backend yang menentukan sesi masih sah.
  useEffect(() => {
    let active = true;
    apiFetch<UserProfile>('/auth/me')
      .then((profile) => {
        if (!active) return;
        setUser(profile);
        setExpiresAt(profile.sessionExpiresAt ?? null);
        setStatus('authenticated');
      })
      .catch(() => {
        if (!active) return;
        setStatus('anonymous');
        if (hadSession()) setLastLogoutReason('expired');
      });
    return () => {
      active = false;
    };
  }, []);

  // Keluar otomatis tepat saat sesi kedaluwarsa.
  useEffect(() => {
    if (status !== 'authenticated' || !expiresAt) return;
    const ms = Date.parse(expiresAt) - Date.now();
    const timer = window.setTimeout(() => void logout('expired'), Math.max(ms, 0));
    return () => window.clearTimeout(timer);
  }, [status, expiresAt, logout]);

  const login = useCallback(async (email: string, password: string) => {
    // Token di body sengaja diabaikan; sesi browser memakai cookie httpOnly dari respons ini.
    const res = await apiFetch<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: email.trim(), password }),
    });
    markHadSession();
    setUser(res.user);
    setExpiresAt(res.expiresAt);
    setStatus('authenticated');
    setLastLogoutReason(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      lastLogoutReason,
      login,
      logout,
      can: (permission) => user?.permissions.includes(permission) ?? false,
    }),
    [status, user, lastLogoutReason, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth harus dipakai di dalam AuthProvider');
  return ctx;
}
