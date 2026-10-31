#!/usr/bin/env node
/**
 * Menyiapkan data rekonsiliasi demo BR-A & BR-B (v1) lewat API sebagai Finance — sama seperti langkah UI.
 * Aman diulang dan tidak menghapus apa pun: import identik dikenali (idempoten) dan run dengan dataset + rule
 * yang sama mengembalikan run lama, bukan membuat hasil ganda.
 *
 * Pemakaian (dari root repo, stack berjalan):
 *   set -a; . ./.env; set +a
 *   node scripts/prepare-demo-recon.mjs                       # http://localhost:${WEB_HOST_PORT:-8080}
 *   node scripts/prepare-demo-recon.mjs http://localhost:8097 # stack gladi
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.argv[2] ?? `http://localhost:${process.env.WEB_HOST_PORT ?? 8080}`;
const password = process.env.DEMO_PASSWORD;
if (!password) {
  console.error('DEMO_PASSWORD belum di-set. Jalankan: set -a; . ./.env; set +a');
  process.exit(1);
}
const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), '../samples/test-data/reconciliation/scoped');
const headers = { 'X-Requested-With': 'sfp-web' };

async function call(path, init = {}) {
  const res = await fetch(`${base}/api/v1${path}`, { ...init, headers: { ...headers, ...init.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${body.code ?? ''} ${body.message ?? ''}`);
  return { res, body };
}

const login = await call('/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'finance@example.test', password }),
});
headers.Cookie = login.res.headers.get('set-cookie').split(';')[0];

const units = (await call('/org-units?pageSize=100')).body.items;
for (const code of ['BR-A', 'BR-B']) {
  const unit = units.find((u) => u.code === code);
  const ids = {};
  for (const side of ['INTERNAL', 'EXTERNAL']) {
    const file = `ORG-1-${code}-${side.toLowerCase()}.csv`;
    const form = new FormData();
    form.set('unitId', unit.id);
    form.set('accountId', 'ACC-1');
    form.set('side', side);
    form.set('file', new Blob([await readFile(resolve(fixtures, file))], { type: 'text/csv' }), file);
    const { body } = await call('/datasets/import', { method: 'POST', body: form });
    ids[side] = body.dataset.id;
    console.log(`${code} ${side.padEnd(8)} ${file}: ${body.created ? 'diimpor' : 'sudah ada (idempoten)'} · ${body.dataset.rowCount} baris`);
  }
  const { body } = await call('/reconciliation-runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ internalDatasetId: ids.INTERNAL, externalDatasetId: ids.EXTERNAL, ruleVersion: 'v1' }),
  });
  const summary = (await call(`/reconciliation-runs/${body.run.id}/summary`)).body;
  console.log(`${code} run v1: ${body.created ? 'dibuat' : 'sudah ada (idempoten)'} · cocok ${summary.matchedRatioPercentDisplay}% · revenue terverifikasi Rp${Number(summary.verifiedRevenue).toLocaleString('id-ID')}`);
}
