import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Akses baca ke samples/test-data (fixture tidak pernah diubah oleh test). */
export const FIXTURE_DIR = resolve(__dirname, '../../../samples/test-data');

export const fixturePath = (rel: string) => join(FIXTURE_DIR, rel);
export const readFixture = (rel: string) => readFileSync(fixturePath(rel));
export const readFixtureJson = <T>(rel: string): T => JSON.parse(readFileSync(fixturePath(rel), 'utf8')) as T;

export interface ExpectedRecon {
  results: {
    reference: string;
    status: string;
    reason: string | null;
    internal_ids: string[];
    external_ids: string[];
  }[];
  summary: Record<string, string | number>;
  other_scopes: { organization_id: string; unit_id: string; internal_ids: string[]; external_ids: string[]; status: string; verified_revenue: string }[];
}
