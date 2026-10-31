# Submission checklist

Deliverable wajib dari PDF soal → file di repository → status verifikasi. Bukti rinci: [test-report.md](test-report.md) bagian "Hasil final Phase 07".

## Deliverable wajib
| # | Deliverable (PDF) | File / lokasi | Verifikasi | Status |
|---|---|---|---|---|
| 1 | Source code backend API | `backend/src/` (NestJS, modul `access`, `auth`, `organization`, `employees`, `reconciliation`, `performance`, `approvals`, `audit`, `health`) | Lint, typecheck, build, unit & integration lulus di Node 22.23.4 | __S_BUILD__ |
| 2 | Skema migrasi DB relasional + seed | `backend/prisma/schema.prisma`, `backend/prisma/migrations/` (4 migration), `backend/src/database/seed/`, `docker/postgres/init/` | Migration + seed di volume kosong; seed ulang tanpa duplikasi; migration gagal → API tidak start | __S_CLEAN__ |
| 3 | UI internal tools | `frontend/src/` (Beranda, Rekonsiliasi, Performa, Persetujuan, Organisasi) | E2E Chrome desktop + HP 390px; persistence setelah restart | __S_E2E__ |
| 4 | Docker Compose satu perintah (API, DB, Web) | `compose.yaml`, `backend/Dockerfile` (target build/migrate/runtime), `frontend/Dockerfile`, `frontend/nginx.conf`, `.env.example` | `docker compose up -d --build --wait` dari salinan bersih, build tanpa cache | __S_CLEAN__ |
| 5 | Automated test (unit + integration): kalkulasi performa, rekonsiliasi, konkurensi approval | `backend/src/**/*.spec.ts`, `backend/test/integration/`, `frontend/src/**/*.test.ts(x)`, `frontend/e2e/` | Lihat tabel hasil di test-report | __S_TEST__ |
| 6 | Fixture & expected results | `samples/test-data/` (tidak diubah) | `validate_fixtures.py` PASS, crosscheck 48/48 | ✅ PASS |
| 7 | README.md: setup, migrasi, test | [README.md](../README.md) | Diikuti langkah demi langkah pada salinan bersih | __S_CLEAN__ |
| 8 | PRODUCT_MEMO.md | [PRODUCT_MEMO.md](../PRODUCT_MEMO.md) | Konsisten dengan business-rules & test-report | ✅ Ditinjau |
| 9 | Presentation deck 5–7 slide (PDF/interaktif) | [presentation/deck.pdf](presentation/deck.pdf) (7 slide), sumber [presentation/deck.html](presentation/deck.html) | Dirender & diperiksa: tanpa teks meluap/terpotong | __S_DECK__ |
| 10 | Persiapan sesi 45 menit (presentasi + code defense) | [presentation/presenter-notes.md](presentation/presenter-notes.md), [demo-script.md](demo-script.md) | Langkah demo sesuai perilaku yang diuji E2E | ✅ Tersedia |
| 11 | Format penyerahan: repositori Git | Repo ini (`master`) | Lihat "Kesiapan commit" | ⏳ Perlu commit oleh pemilik |

## Dokumen pendukung
| Dokumen | Isi |
|---|---|
| [architecture.md](architecture.md) | Diagram modul & deployment, ERD dari schema final, alur Finance → HR, transaksi approval & audit, scoping (aplikasi, bukan RLS) |
| [api.md](api.md) | Endpoint aktual, permission, kode error |
| [business-rules.md](business-rules.md) | Aturan bisnis final |
| [requirements-matrix.md](requirements-matrix.md) | Requirement PDF → fitur → test → bukti |
| [test-report.md](test-report.md) | Hasil final + histori per phase + keterbatasan |

## Pemeriksaan isi paket
| Pemeriksaan | Hasil |
|---|---|
| Nilai rahasia dari `.env` lokal (5 nilai) di file paket | 0 kemunculan |
| `.env` aktif, pgpass, dump database, kunci privat, token | Tidak ada; `.env` di-ignore, hanya `.env.example` |
| `node_modules`, `dist`, `test-results`, trace Playwright | Tidak ada (di-ignore) |
| Lockfile | `pnpm-lock.yaml` (dipakai `--frozen-lockfile` di host & Docker) |
| Versi runtime | `.nvmrc` 22.23.4, `engines` `>=22.12.0 <23`, `packageManager` pnpm@10.13.1; image `node:22.23.4-alpine`, `postgres:16.15-alpine`, `nginx:1.27.5-alpine` |
| File yang dibutuhkan ada di paket (bukan hanya di disk lokal) | Paket = `git ls-files -co --exclude-standard`; salinan bersih dibangun & diuji hanya dari daftar itu |

## Kesiapan commit
__COMMIT__
