import { v5 as uuidv5 } from 'uuid';

/** Namespace tetap agar external key fixture selalu dipetakan ke UUID yang sama (seed idempotent). */
const NAMESPACE = '4f1c2b7e-9a51-4d0e-8c3f-5b8a6e2d1f90';

export function fixtureId(kind: string, ...keys: (string | number | null)[]): string {
  return uuidv5([kind, ...keys.map((k) => (k === null ? '<null>' : String(k)))].join(':'), NAMESPACE);
}
