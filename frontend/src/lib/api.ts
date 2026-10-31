export const API_BASE = '/api/v1';

/** Header CSRF yang diwajibkan backend untuk request non-GET berbasis cookie. */
export const CSRF_HEADERS = { 'X-Requested-With': 'sfp-web' };

export interface ApiError {
  code: string;
  message: string;
  requestId?: string;
  details?: unknown;
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError,
  ) {
    super(body.message);
  }
}

let onUnauthorized: (() => void) | null = null;

/** Jumlah request API yang sedang berjalan — dipakai progress bar di top bar. */
let pending = 0;
const pendingListeners = new Set<(n: number) => void>();
export function subscribePending(listener: (n: number) => void): () => void {
  pendingListeners.add(listener);
  listener(pending);
  return () => pendingListeners.delete(listener);
}
function setPending(delta: number) {
  pending = Math.max(0, pending + delta);
  pendingListeners.forEach((l) => l(pending));
}

/** Dipanggil saat API menjawab 401 di luar proses login (sesi habis/dicabut). */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

/**
 * Wrapper fetch: cookie sesi httpOnly dikirim otomatis (same-origin), header CSRF selalu
 * disertakan, JSON in/out, error API → ApiRequestError. Otorisasi tetap diputuskan backend.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  setPending(1);
  try {
    return await request<T>(path, init);
  } finally {
    setPending(-1);
  }
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'same-origin',
    ...init,
    headers: {
      Accept: 'application/json',
      ...CSRF_HEADERS,
      // FormData: biarkan browser memasang multipart boundary sendiri.
      ...(typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') onUnauthorized?.();
    const error = (body as ApiError | undefined) ?? { code: 'HTTP_ERROR', message: `HTTP ${res.status}` };
    throw new ApiRequestError(res.status, error);
  }
  return body as T;
}
