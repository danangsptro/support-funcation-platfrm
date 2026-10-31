# Submission checklist

Deliverable wajib dari PDF soal → file di repository → status verifikasi. Bukti rinci: [test-report.md](test-report.md) bagian "Hasil final Phase 07".

## Deliverable wajib
| # | Deliverable (PDF) | File / lokasi | Verifikasi | Status |
|---|---|---|---|---|
| 1 | Source code backend API | `backend/src/` (NestJS, modul `access`, `auth`, `organization`, `employees`, `reconciliation`, `performance`, `approvals`, `audit`, `health`) | Lint, typecheck, build, unit & integration lulus di Node 22.23.4 | ✅ PASS (container Node 22.23.4: lint/typecheck/build, unit backend 85, integration 184; unit frontend 70/70 pada run ulang — lihat test-report §0) |
| 2 | Skema migrasi DB relasional + seed | `backend/prisma/schema.prisma`, `backend/prisma/migrations/` (4 migration), `backend/src/database/seed/`, `docker/postgres/init/` | Migration + seed di volume kosong; seed ulang tanpa duplikasi; migration gagal → API tidak start | ✅ PASS (stack `sfp-clean`; lihat test-report §0) |
| 3 | UI internal tools | `frontend/src/` (Beranda, Rekonsiliasi, Performa, Persetujuan, Organisasi) | E2E Chrome desktop + HP 390px; persistence setelah restart | ✅ PASS (32/32 + persistence 3/3) |
| 4 | Docker Compose satu perintah (API, DB, Web) | `compose.yaml`, `backend/Dockerfile` (target build/migrate/runtime), `frontend/Dockerfile`, `frontend/nginx.conf`, `.env.example` | `docker compose up -d --build --wait` dari salinan bersih, build tanpa cache | ✅ PASS (stack `sfp-clean`; lihat test-report §0) |
| 5 | Automated test (unit + integration): kalkulasi performa, rekonsiliasi, konkurensi approval | `backend/src/**/*.spec.ts`, `backend/test/integration/`, `frontend/src/**/*.test.ts(x)`, `frontend/e2e/` | Lihat tabel hasil di test-report | ✅ PASS (unit 155, integration 184, E2E 32 + 3) |
| 6 | Fixture & expected results | `samples/test-data/` (tidak diubah) | `validate_fixtures.py` PASS, crosscheck 48/48 | ✅ PASS |
| 7 | README.md: setup, migrasi, test | [README.md](../README.md) | Diikuti langkah demi langkah pada salinan bersih | ✅ PASS (stack `sfp-clean`; lihat test-report §0) |
| 8 | PRODUCT_MEMO.md | [PRODUCT_MEMO.md](../PRODUCT_MEMO.md) | Konsisten dengan business-rules & test-report | ✅ Ditinjau |
| 9 | Presentation deck 5–7 slide | [Support-Function-Platform.pptx](Support-Function-Platform.pptx) (7 slide 16:9, grafik native, catatan presenter di Notes) | Dirender di Microsoft PowerPoint & diperiksa per slide: tanpa teks meluap/terpotong; validasi format OOXML lulus; angka test dari run terakhir | ✅ Tersedia |
| 10 | Persiapan sesi 45 menit (presentasi + code defense) | [demo-script.md](demo-script.md); catatan presenter per slide di Notes deck | Langkah demo sesuai perilaku yang diuji E2E | ✅ Tersedia |
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
- Isi paket: 255 file (`git ls-files -co --exclude-standard`); `.env`, `requirements/`, `node_modules`, artefak test tidak termasuk.
- Commit & push dilakukan oleh pemilik repository:
  ```bash
  git add -A
  git commit -m "docs: hasil final Phase 07, Swagger, dan deck presentasi"
  git push
  ```
- Pastikan repository dapat diakses penilai (public, atau undang akun penilai).
