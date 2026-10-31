import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFetchMock, jsonResponse } from '../test/fetch-mock';
import { apiFetch, subscribePending } from './api';

describe('penghitung request berjalan (progress bar)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('naik saat request dimulai dan kembali 0 setelah selesai, termasuk saat gagal', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    installFetchMock({
      'GET /slow': async () => {
        await gate;
        return jsonResponse(200, { ok: true });
      },
      'GET /fail': () => jsonResponse(500, { code: 'X', message: 'gagal' }),
    });
    const seen: number[] = [];
    const unsubscribe = subscribePending((n) => seen.push(n));
    const slow = apiFetch('/slow');
    const fail = apiFetch('/fail').catch(() => 'ditolak');
    expect(seen.at(-1)).toBe(2);
    await fail;
    release();
    await slow;
    expect(seen.at(-1)).toBe(0);
    unsubscribe();
  });
});
