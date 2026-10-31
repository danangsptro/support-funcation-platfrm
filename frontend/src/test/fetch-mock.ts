import { vi } from 'vitest';

type Handler = (init: RequestInit | undefined) => Response | Promise<Response>;

export function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Mock fetch per "METHOD /path" (tanpa prefix /api/v1). Rute tak terdaftar → 404.
 * Default: GET /auth/me → 401 (belum login), POST /auth/logout → 204.
 */
export function installFetchMock(routes: Record<string, Handler> = {}) {
  const all: Record<string, Handler> = {
    'GET /auth/me': () => jsonResponse(401, { code: 'UNAUTHENTICATED', message: 'Token tidak ada' }),
    'POST /auth/logout': () => new Response(null, { status: 204 }),
    ...routes,
  };
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input).replace(/^\/api\/v1/, '').split('?')[0];
    const key = `${(init?.method ?? 'GET').toUpperCase()} ${url}`;
    const handler = all[key];
    return handler ? handler(init) : jsonResponse(404, { code: 'NOT_FOUND', message: key });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}
