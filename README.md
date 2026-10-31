# Support Function Platform

Satu platform internal untuk tiga fungsi pendukung, dengan satu model akses (peran + cakupan unit organisasi) dan audit yang sama:

| Modul | Untuk siapa | Yang dikerjakan |
|---|---|---|
| **A — Talent & Performance** | HR, Manager | KPI karyawan berbobot; KPI revenue terhubung ke *revenue terverifikasi* hasil rekonsiliasi; finalisasi review menjadi snapshot; Revenue per Employee (RPE) per cabang dan benchmark divisi |
| **B — Financial Reconciliation** | Finance, Manager (ringkasan) | Import CSV internal & eksternal per cabang/akun, matching deterministik (Matched/Mismatched/Missing), idempoten, ringkasan anomali |
| **C — Approval & Access** | Pengaju, Manager, Finance, Admin | Persetujuan anggaran bertingkat dari konfigurasi database (≤ Rp10 jt Manager; > Rp10 jt Manager → Finance), kunci baris untuk keputusan bersamaan, delegasi, audit append-only |

Status: seluruh requirement wajib (A-1..C-3) **DONE** dan dapat diselesaikan lewat UI. Bukti eksekusi: [docs/test-report.md](docs/test-report.md). Peta deliverable: [docs/SUBMISSION_CHECKLIST.md](docs/SUBMISSION_CHECKLIST.md).

## Dokumen
| Dokumen | Isi |
|---|---|
| [PRODUCT_MEMO.md](PRODUCT_MEMO.md) | Masalah bisnis, scope MVP, asumsi, definisi revenue/KPI/RPE, trade-off, roadmap |
| [docs/architecture.md](docs/architecture.md) | Diagram deployment & modul, ERD final, alur Finance → HR, transaksi approval & audit, data scoping |
| [docs/api.md](docs/api.md) | Kontrak API aktual |
| [docs/business-rules.md](docs/business-rules.md) | Aturan bisnis final (formula, matching, akses, workflow) |
| [docs/requirements-matrix.md](docs/requirements-matrix.md) | Requirement PDF → fitur → test → bukti |
| [docs/test-report.md](docs/test-report.md) | Hasil regression final + histori test per phase |
| [docs/demo-script.md](docs/demo-script.md) | Urutan demo, akun, fixture, expected result, stack gladi |
| [docs/presentation/](docs/presentation/) | Deck 7 slide (PDF + HTML) dan catatan presenter |
| [docs/SUBMISSION_CHECKLIST.md](docs/SUBMISSION_CHECKLIST.md) | Deliverable wajib → file → status verifikasi |

## Stack
NestJS 11 + TypeScript 5.9 · Prisma 6.19 (+ migration SQL untuk constraint/role/trigger) · PostgreSQL 16 · React 19 + Vite 7 + Tailwind 4 · Jest 29 + Supertest · Vitest 3 + Testing Library · Playwright (Google Chrome) · pnpm 10 workspace · Docker Compose.

```
backend/      NestJS API; prisma/ (schema + migrations); src/database/seed; test/integration (PostgreSQL nyata)
frontend/     React + Vite; e2e/ (Playwright); nginx.conf untuk container web
docs/         dokumen deliverable + presentation/
docker/       init script PostgreSQL (role & database), impor server pgAdmin
samples/      fixture test-data + expected results (tidak diubah)
scripts/      E2E terisolasi, penyiapan data demo, crosscheck fixture
compose.yaml  db → migrate → api → web
```

## Prasyarat
| Untuk | Butuh |
|---|---|
| Menjalankan aplikasi | Docker Desktop (atau Docker Engine) dengan Compose v2, `openssl` untuk membuat secret |
| Menjalankan test di host | Node **22.23.4** (lihat [.nvmrc](.nvmrc); minimum `>=22.12 <23` di `package.json`) dan pnpm **10.13.1** (`packageManager`) |
| E2E browser | Google Chrome terpasang |
| Validator fixture | Python 3 |

Node yang sesuai tanpa mengubah instalasi global: `nvm install && nvm use` (membaca `.nvmrc`), lalu `corepack enable` agar pnpm mengikuti `packageManager`. Dependency dikunci di [pnpm-lock.yaml](pnpm-lock.yaml) (`pnpm install --frozen-lockfile`).

Image yang diverifikasi: `node:22.23.4-alpine` (build API & web), `postgres:16.15-alpine`, `nginx:1.27.5-alpine`.

## Menjalankan dengan Docker
### 1. Konfigurasi environment
```bash
cp .env.example .env
```
Ganti setiap nilai `change-me` di `.env` (nilai URL-safe, karena dipakai di URL koneksi):
```bash
openssl rand -hex 16   # POSTGRES_SUPERUSER_PASSWORD, APP_OWNER_PASSWORD, APP_RUNTIME_PASSWORD, DEMO_PASSWORD
openssl rand -hex 32   # JWT_SECRET (min. 32 karakter)
```
Di bagian bawah `.env`, ganti `<runtime>`/`<owner>` dengan password di atas (dipakai test & pengembangan di host). `.env` di-ignore git dan tidak boleh di-commit.

### 2. Satu perintah
```bash
docker compose up -d --build --wait
docker compose ps        # db, api, web healthy; migrate Exited (0)
```
Urutan: `db` healthy → `migrate` (`prisma migrate deploy` + seed, role owner) → `api` (hanya bila migrate sukses; role runtime) → `web` (nginx, `/api` diteruskan ke API). Buka **http://localhost:8080**.

Image: service `migrate` memakai target `migrate` (punya Prisma CLI), service `api` memakai target `runtime` (dependency produksi + Prisma Client, tanpa devDependencies), keduanya dari [backend/Dockerfile](backend/Dockerfile).

### 3. Akun demo
Semua akun memakai password = nilai `DEMO_PASSWORD` di `.env` (di-hash saat seed; tidak tersimpan di repo). Halaman login punya panel **Akun demo untuk presentasi** untuk mengisi email sekali klik.

| Email | Peran · cakupan |
|---|---|
| `admin@example.test` | Admin Demo Nusantara (seluruh organisasi; approval hanya baca) |
| `hr@example.test` | HR Divisi 1 |
| `finance@example.test` | Finance Divisi 1 |
| `manager-a@example.test`, `manager-a2@example.test` | Manager cabang BR-A |
| `manager-b@example.test` | Manager cabang BR-B |
| `employee-a@example.test` | Pengaju anggaran BR-A |
| `outsider@example.test` | Admin organisasi lain (Demo Sejahtera) |
| `no-grant@example.test` | Bisa login, tanpa izin |

Mengganti password demo: ubah `DEMO_PASSWORD` di `.env`. Seed tidak menimpa user yang sudah ada, jadi password baru berlaku untuk database baru (atau stack disposable baru).

### Migration dan seed
Dijalankan otomatis oleh `migrate`. Manual (aman diulang, tidak menggandakan data):
```bash
docker compose run --rm migrate
```
Seed membaca [samples/test-data/](samples/test-data/) dan memetakan ID fixture ke UUID deterministik (v5). Dua role database: `app_owner` (migration/seed) dan `app_runtime` (API; bukan owner, tidak bisa UPDATE/DELETE/TRUNCATE `audit_events`).

### Menyiapkan data demo rekonsiliasi BR-A/BR-B tanpa merusak data
Seed hanya berisi master data. Revenue terverifikasi (dan RPE) baru ada setelah Finance mencocokkan file. Pilih salah satu:
- Lewat UI sebagai Finance: **Rekonsiliasi → Rekonsiliasi baru**, unggah `samples/test-data/reconciliation/scoped/ORG-1-BR-A-*.csv` lalu `ORG-1-BR-B-*.csv` (langkah di [docs/demo-script.md](docs/demo-script.md)).
- Lewat API dengan skrip yang sama efeknya:
  ```bash
  set -a; . ./.env; set +a
  node scripts/prepare-demo-recon.mjs            # default http://localhost:${WEB_HOST_PORT:-8080}
  ```
Keduanya idempoten: file yang sudah diimpor dikenali, run dengan dataset + rule yang sama mengembalikan run lama, dan tidak ada data yang dihapus.

## Port
| Service | Default | Variabel `.env` | Catatan |
|---|---|---|---|
| Web | http://localhost:8080 | `WEB_HOST_PORT` | Satu-satunya pintu untuk browser |
| API | http://127.0.0.1:3000/api/v1 | `API_HOST_PORT` | Hanya localhost; `/health/live`, `/health/ready` |
| PostgreSQL | 127.0.0.1:5433 | `DB_HOST_PORT` | Hanya localhost; 5432 sengaja dihindari |
| E2E terisolasi | 8096 / 3006 / 5436 | — | Project `sfp-e2e`, dibuat & dihapus oleh `pnpm test:e2e` |
| Gladi demo (disarankan) | 8097 / 3007 / 5437 | — | Project `sfp-gladi` (lihat demo script) |

## Menjalankan test
```bash
nvm use && corepack enable && pnpm install --frozen-lockfile
set -a; . ./.env; set +a      # DATABASE_URL_TEST, MIGRATION_DATABASE_URL_TEST, DEMO_PASSWORD
pnpm lint && pnpm typecheck && pnpm build
pnpm test                     # unit: backend (Jest) + frontend (Vitest), tanpa database
docker compose up -d db
pnpm test:integration         # PostgreSQL nyata, HANYA database support_test (di-reset; guard menolak nama tanpa _test)
pnpm test:e2e                 # Chrome + stack Docker terisolasi sfp-e2e, lalu restart api/web + uji persistence
python3 -I samples/test-data/validate_fixtures.py && python3 -I scripts/phase00_crosscheck.py
```
`pnpm test:e2e` membangun stack terpisah (volume sendiri), mengisi baseline BR-A & BR-B v1 lewat API, menjalankan Playwright, me-restart `api` + `web` lalu menjalankan `e2e/persistence.e2e.ts`, kemudian menghapus stack itu. Database demo tidak tersentuh. Bila gagal, log `api/web/db` (dengan `x-request-id` dan durasi per request) disimpan ke `frontend/test-results/stack-logs.txt` sebelum stack dihapus. Argumen diteruskan ke Playwright tanpa tahap restart, mis. `pnpm test:e2e e2e/mobile.e2e.ts`.

## Troubleshooting
| Gejala | Penyebab & solusi |
|---|---|
| `isi di .env` saat `docker compose up` | `.env` belum dibuat atau variabel kosong → langkah 1 |
| `migrate` Exited (1), `api` tidak start | Disengaja: API tidak jalan bila migration gagal. Lihat `docker compose logs migrate` (biasanya password owner tidak cocok dengan volume lama) |
| Login selalu "Email atau kata sandi salah" | `DEMO_PASSWORD` diganti setelah seed; seed tidak menimpa user lama |
| Port sudah dipakai | Ubah `WEB_HOST_PORT`/`API_HOST_PORT`/`DB_HOST_PORT` |
| `pnpm` memperingatkan engine Node | Node host di luar `>=22.12 <23` → `nvm install && nvm use` |
| `pnpm test:integration` ditolak | URL test harus ke database berakhiran `_test` (guard) |
| E2E: Chrome tidak ada | `pnpm --filter web exec playwright install chromium`, hapus `channel: 'chrome'` di `frontend/playwright.config.ts` |
| Login berulang ditolak 429 | Batas percobaan login (5/15 mnt per IP+email); tunggu atau restart `api` |

## Reset (hanya environment disposable)
`docker compose down -v` **menghapus seluruh data** project tersebut. Gunakan hanya untuk stack disposable, selalu dengan nama project eksplisit:
```bash
docker compose -p sfp-gladi down -v     # stack gladi
docker compose -p sfp-e2e down -v       # stack E2E (biasanya dihapus otomatis)
```
Jangan menjalankan `down -v` tanpa `-p` pada stack demo kecuali memang ingin kehilangan semua data demo. Untuk mengulang demo tanpa menyentuh data yang ada, pakai stack gladi ([docs/demo-script.md §6](docs/demo-script.md)).

## Pengembangan lokal (opsional)
```bash
docker compose up -d db
set -a; . ./.env; set +a
pnpm --filter api dev        # API :3000 (DATABASE_URL = role runtime)
pnpm --filter web dev        # Vite :5173, proxy /api → :3000
```

## pgAdmin 4 (opsional)
**Tools → Import/Export Servers** → impor [docker/pgadmin/servers.json](docker/pgadmin/servers.json). Koneksi: `support` (owner/runtime) dan `support_test` di `localhost:5433`; password dari `.env`. Role runtime ditolak saat UPDATE/DELETE `audit_events`.
