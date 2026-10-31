# Test report

Dokumen ini memuat (1) bukti eksekusi nyata per phase dan (2) rencana test. Hanya hasil yang benar-benar dijalankan yang ditulis sebagai PASS/FAIL; yang belum dijalankan berstatus PLANNED, yang tidak bisa dijalankan BLOCKED.

## 0. Hasil final Phase 07 — revisi yang diserahkan (2026-10-31)
Bagian ini adalah hasil untuk **revisi terakhir**. Bagian §1 di bawahnya adalah **histori** per phase (angka di sana berlaku untuk revisi saat itu).

**Revisi yang diuji**: isi paket = `git ls-files -co --exclude-standard` (255 file; `.env`, `requirements/`, `node_modules`, artefak test tidak termasuk). Sidik SHA-256 gabungan isi paket: `41ce0051664ff100`. Perubahan Phase 07 belum di-commit saat diuji; commit dibuat oleh pemilik repository.

### Ringkasan
| Pemeriksaan | Runtime | Hasil |
|---|---|---|
| Lint · typecheck · production build (backend `nest build` + frontend Vite) | Node 22.23.4 (container `node:22.23.4-alpine`), instal bersih `pnpm install --frozen-lockfile` | Host Node 22.9.0: lint PASS · typecheck PASS · build PASS (revisi akhir). Container Node 22.23.4: run container masih berjalan saat dokumen ini difinalkan — tidak diklaim (run sebelumnya pada revisi sebelum Swagger: lint/typecheck/build PASS) |
| Unit backend (Jest) | Node 22.23.4 container · Node 22.9.0 host | Host: 85/85 PASS (container: run container masih berjalan saat dokumen ini difinalkan — tidak diklaim) |
| Unit frontend (Vitest) | Node 22.23.4 container · Node 22.9.0 host | Host: 70/70 PASS (container: run container masih berjalan saat dokumen ini difinalkan — tidak diklaim) |
| Integration PostgreSQL 16.15 (scope, idempotensi, D-42, snapshot, concurrency approval 2 instance, audit privileges, riwayat > 100 run, Swagger) | Node 22.23.4 container · Node 22.9.0 host | Host: 184/184 PASS, 12 suite (container: run container masih berjalan saat dokumen ini difinalkan — tidak diklaim) |
| E2E Chrome terisolasi `pnpm test:e2e` (desktop 1280px + HP 390px), lalu restart api/web + persistence | Host Node 22.9.0 (Playwright), image dari Dockerfile final | 32/32 PASS → 3/3 PASS |
| Validator fixture · crosscheck | Python 3.10.13 | PASS · 48/48 PASS |
| Checkout bersih (stack `sfp-clean`, port 8099/3009/5439) | Docker, `--no-cache --pull` | PASS (rincian di bawah) |

Node 22.9.0 di laptop pengembang berada di bawah `engines` (`>=22.12.0 <23`); pnpm menampilkan peringatan engine. Runtime yang ditetapkan proyek (`.nvmrc` 22.23.4) dipakai untuk verifikasi toolchain final di container; instalasi global pengguna tidak diubah.

### Riwayat rekonsiliasi: paginasi & filter di server
- API: urutan `created_at DESC, id DESC` (stabil antar halaman); UI memakai `unitId`, `page`, `pageSize` dari API existing — tidak lagi memfilter 100 run terbaru di browser.
- `reconciliation-history.int-spec.ts` (5 test, PostgreSQL nyata, 112 run; BR-B hanya punya 1 run yang lebih tua dari 110 run BR-A): halaman 1 (100) tanpa BR-B, halaman 2 memuatnya; `unitId=BR-B` → total 1; paginasi 12 × 10 tanpa duplikat walau 10 run ber-`created_at` sama; deep link run lama 200; Manager A filter BR-B → 404, Manager B hanya BR-B; `pageSize=101` → 400. Satu ekspektasi test keliru (`'6000000.00'`) dikoreksi ke format API yang benar `'6000000'` (format string desimal API konsisten di seluruh endpoint).
- UI: filter mengosongkan halaman & run terpilih; respons lama diabaikan (nomor urut request). Test komponen mensimulasikan respons halaman 2 yang terlambat setelah filter berganti; **mutation check**: menghapus penjaga membuat test gagal, penjaga dikembalikan. Tautan ke run di luar halaman aktif dibuka lewat `GET /reconciliation-runs/:id`; di luar akses → pesan "tidak ditemukan dalam akses Anda" (E2E Manager B).

### Investigasi `GET /approval-requests/options` yang pernah menggantung
| Aspek | Temuan |
|---|---|
| Kondisi kejadian | Sekali, Phase 05, run E2E pertama tepat setelah `docker compose up --build`. Trace Playwright: request options status −1 (tidak pernah dijawab) sampai test timeout 30 dtk; di trace yang sama `POST /auth/login` 4,2 dtk, `/health/ready` 1,5 dtk, `/auth/me` 0,9 dtk (normalnya < 200 ms). Log API stack E2E ikut terhapus bersama volume; API belum punya log akses per request. |
| Pemeriksaan | Kode endpoint (2 query + resolusi scope, tanpa lock/transaksi panjang); nginx tanpa keepalive upstream; Prisma pool timeout akan menghasilkan error, bukan hang. Uji beban di stack sekali pakai: 1.000 request (40 paralel) campuran options/list/health/me → normal p99 options 116 ms; **8 core CPU dijenuhkan** → p99 485 ms, max 556 ms; **0 gagal/timeout**, log akses mencatat 500 respons options 200. |
| Kesimpulan | Hipotesis pool habis, kontensi request paralel, dan CPU jenuh **tidak terbukti**. Akar masalah **belum diketahui** (tidak tereproduksi) — bukan "sudah diperbaiki". |
| Dampak bila terulang | Form pengajuan baru tidak terisi; tidak ada data yang rusak. |
| Mitigasi | Timeout 10 dtk + "Coba lagi" (Phase 05). **Diuji deterministik**: unit (fake timer: belum batal di 9,9 dtk, batal di 10,1 dtk, Coba lagi memuat) dan E2E (request pertama ditahan tanpa jawaban → pesan setelah 10 dtk → Coba lagi memuat form). |
| Observabilitas baru | Log akses API per request (`requestId method path status durasi`, peringatan ≥ 2 dtk dan koneksi ditutup klien) + `scripts/e2e-isolated.sh` menyimpan log api/web/db ke `frontend/test-results/stack-logs.txt` sebelum stack dihapus bila test gagal (terbukti bekerja pada kegagalan test HP). |

### Smoke test HP 390px & desktop
`e2e/mobile.e2e.ts` (4 test) — Rekonsiliasi (Finance: drawer, unggah 3 langkah, hasil, tombol panduan), Performa (HR: analitik, review, dialog finalisasi dibuka lalu dibatalkan), Persetujuan (pengaju: form baru; Manager: dialog Setujui dibuka lalu dibatalkan), Beranda & Organisasi. Run pertama menemukan **dua bug nyata**: halaman melebar 150 px (hasil rekonsiliasi) dan 265 px (review karyawan) karena elemen `sr-only` (absolute) lolos dari wadah `overflow-x-auto` yang tidak `relative`, dan grid tanpa `minmax(0,…)` pada layar sempit. Diperbaiki (semua wadah tabel `relative`, `grid-cols-1`). Dua kegagalan berikutnya karena data test (karyawan tanpa KPI; Manager tanpa pengajuan terkirim) — test diubah menyiapkan datanya sendiri. Desktop 1280px: tanpa scroll horizontal di 6 halaman (`integration.e2e.ts`).

### Environment & image
- `.nvmrc` 22.23.4; `engines.node` `>=22.12.0 <23`; `packageManager` pnpm@10.13.1; lockfile `pnpm-lock.yaml` (`--frozen-lockfile` di host, container, dan Docker).
- Image yang diuji: `node:22.23.4-alpine` (build API & web), `postgres:16.15-alpine` (PostgreSQL 16.15), `nginx:1.27.5-alpine` (nginx 1.27.5).
- `backend/Dockerfile` tiga target: `build`, `migrate` (Prisma CLI, migration + seed), `runtime` (dependency produksi `--frozen-lockfile --prod --offline` + Prisma Client hasil generate). Image API 851 MB → 655 MB; `prisma`/`jest`/`typescript`/`tsx`/`eslint` tidak dapat di-resolve di runtime (`prisma` & `typescript` tersisa hanya sebagai peer `@prisma/client`).
- Ditemukan saat verifikasi bersih: (1) `pnpm deploy --legacy` me-resolve ulang dari registry dan macet > 10 menit → diganti instalasi offline dari lockfile; (2) di checkout baru Prisma Client tidak ter-generate (postinstall `@prisma/client` berjalan dari root workspace) → `backend` mendapat `postinstall: prisma generate`.

### Checkout bersih (stack disposable `sfp-clean`)
| Langkah | Hasil |
|---|---|
| Salin isi paket saja; `cp .env.example .env` + secret `openssl rand` | Tanpa `node_modules`/`.env` lama |
| `docker compose -p sfp-clean build --no-cache --pull` | PASS, 5 mnt 31 dtk |
| `up -d --wait` (volume kosong) | PASS 17 dtk; migrate: 4 migration + seed; api/db/web healthy |
| `node scripts/prepare-demo-recon.mjs` 2× | Run 1: import BR-A/BR-B + run v1 (28,57% · Rp15 jt; 100% · Rp6 jt); run 2: semua "sudah ada (idempoten)"; tx=15, datasets=4, runs=2 tetap |
| Seed ulang `docker compose run --rm migrate` | Jumlah data tidak berubah |
| E2E penuh terhadap stack bersih | 32/32 PASS |
| `restart db api web` (volume tetap) → persistence | 3/3 PASS |
| `APP_OWNER_PASSWORD` salah → `up` | migrate exit 1 (P1000), api/web tidak start, API tidak menjawab; password benar → pulih, data utuh |

Catatan: dua perubahan Dockerfile terakhir (urutan `COPY prisma` + postinstall, dan `nest build` untuk Swagger) dibuat **setelah** langkah clean-room di atas. Keduanya diverifikasi lewat build image ulang pada `pnpm test:e2e` final (32/32 + 3/3) dan rebuild stack demo (healthy, data utuh); build `--no-cache` tidak diulang.

### Kejadian selama verifikasi
- Docker Desktop (memori 4 GB) kehabisan memori saat instal + test di container berjalan bersamaan dengan build & E2E: semua container berhenti, termasuk stack demo. Volume tidak dihapus; demo dipulihkan dengan `docker compose up -d --wait` dan berisi 6 pengajuan, 2 run, 0 review, 15 audit (diukur setelah pemulihan dan lagi setelah rebuild Swagger — sama; jumlah tepat sebelum kejadian tidak diukur). Hasil run yang terganggu itu **tidak dipakai**; semua verifikasi final dijalankan berurutan.

### Keterbatasan & yang belum dijalankan
- Smoke manual oleh manusia dan gladi presentasi belum dilakukan (E2E otomatis + screenshot sebagai pengganti).
- HP hanya diuji di 390px (Chrome emulasi), bukan perangkat fisik.
- Tidak ada CI; semua run lokal.
- Akar masalah hang options belum diketahui (lihat di atas).
- Build `--no-cache` tidak diulang setelah dua perubahan Dockerfile terakhir (lihat catatan).

## 1. Bukti eksekusi

### Loading pindah halaman — 2026-10-31 (D-56)
| Perintah | Hasil |
|---|---|
| `pnpm --filter web typecheck` / `lint` | PASS |
| `pnpm --filter web test` | 67/67 PASS (+1 `api.test.ts`: penghitung request naik ke 2 saat dua request berjalan dan kembali 0 setelah selesai, termasuk request yang gagal) |
| `pnpm test:e2e` | 27/27 PASS → restart api/web → 3/3 PASS |
| `docker compose up -d --build --wait web` | PASS (database demo tidak disentuh). Screenshot keadaan memuat diambil dengan API diperlambat 1,5 dtk lewat `page.route` di browser: progress bar, spinner, dan skeleton tampil. Percobaan pertama script screenshot gagal karena selector link ambigu (sidebar + kartu beranda), bukan karena aplikasi |

### Layout dashboard bersidebar — 2026-10-31 (D-55)
| Perintah | Hasil |
|---|---|
| `pnpm --filter web typecheck` / `lint` | PASS |
| `pnpm --filter web test` | 66/66 PASS |
| `pnpm test:e2e` | 27/27 PASS → restart api/web → 3/3 PASS. Test HP 390px diubah: sidebar desktop tersembunyi, tanpa scroll horizontal, "Buka menu" → drawer `Navigasi utama (seluler)` → klik Rekonsiliasi → pindah halaman dan drawer tertutup. Test desktop 1280px (tanpa scroll horizontal di 6 halaman) tetap lulus dengan sidebar 256px |
| `docker compose up -d --build --wait web` | PASS (database demo tidak disentuh); screenshot beranda & persetujuan 1440px serta drawer 390px diperiksa visual |

### Halaman Organisasi — 2026-10-31 (D-54)
| Perintah | Hasil |
|---|---|
| `pnpm --filter web typecheck` / `lint` | PASS |
| `pnpm --filter web test` | 66/66 PASS (+1: urutan pohon BR-A → └CC-A → BR-B dengan induk di luar cakupan sebagai akar; penempatan berjalan bertanda Aktif, yang lama tidak) |
| `pnpm test:e2e` | 27/27 PASS → restart api/web → 3/3 PASS (isolasi Manager A/B di Organisasi tetap: sel kode `BR-A`/`BR-B` exact) |
| `docker compose up -d --build --wait web` | PASS (database demo tidak disentuh); screenshot Admin diperiksa visual |

### Riwayat pencocokan rekonsiliasi — 2026-10-31 (D-53)
| Perintah | Hasil |
|---|---|
| `pnpm --filter web typecheck` / `lint` | PASS. Lint sempat gagal karena file screenshot sementara `frontend/shot3.tmp.mjs` tertinggal; file dihapus, bukan bagian dari kode |
| `pnpm --filter web test` | 65/65 PASS (+2 `RunHistory.test.tsx`: chip cabang berjumlah & penyaringan; "Sedang ditampilkan" vs "Lihat hasil", klik tombol/baris) |
| `pnpm test:e2e` | 27/27 PASS → restart api/web → 3/3 PASS (persistence memakai chip "BR-A") |
| `docker compose up -d --build --wait web` | PASS (database demo tidak disentuh); screenshot diperiksa visual |

### Tombol "Tampilkan transaksi" rekonsiliasi — 2026-10-31 (D-52)
Akar masalah: filter tabel sudah berjalan, tetapi tabel Rincian transaksi berada di bawah layar dan halaman tidak bergulir, jadi yang berubah hanya label tombol.
| Perintah | Hasil |
|---|---|
| `pnpm --filter web typecheck` / `lint` | PASS |
| `pnpm --filter web test` | 63/63 PASS; test RunDetail memeriksa `scrollIntoView({ behavior: 'smooth', block: 'start' })` dan filter `reason=DUPLICATE_REFERENCE` |
| `pnpm test:e2e e2e/reconciliation.e2e.ts` | 3/3 PASS; setelah klik, grup "Filter status" tabel `toBeInViewport`, tabel hanya berisi REF-007 |
| `docker compose up -d --build --wait web` | PASS (database demo tidak disentuh); screenshot sebelum/sesudah klik diperiksa visual |

### Penyegaran tampilan Persetujuan — 2026-10-31 (D-51, setelah review Phase 06)
| Perintah | Hasil |
|---|---|
| `pnpm --filter web typecheck` / `lint` | PASS |
| `pnpm --filter web test` | 63/63 PASS. Test daftar persetujuan diubah dari dropdown ke kartu filter: jumlah per kartu dari server, tidak ada Draf di tab Semua, `aria-pressed`, query `status` & `page` |
| `pnpm test:e2e` (run 1) | 26/27 — **FAIL** `manipulasi URL`: selector `button "Setujui"` (substring, tidak peka huruf) ikut cocok dengan kartu filter "Disetujui". Bukan kebocoran; selector diubah ke `exact: true` |
| `pnpm test:e2e` (run 2) | 27/27 PASS → restart api/web → 3/3 PASS |
| `docker compose up -d --build --wait web` | PASS; hanya container web yang dibangun ulang, database demo tidak disentuh. Screenshot demo (Employee A & Finance) diperiksa visual |

### Phase 06 — 2026-10-31 (integrasi UI dan alur end-to-end)
Semua E2E berjalan di Google Chrome headless terhadap stack Docker terisolasi `sfp-e2e` (port 8096/3006/5436, volume dihapus setelah selesai) lewat `pnpm test:e2e`. Database demo tidak disentuh. Screenshot di `frontend/test-results/screens/` (40–44, 50–51 baru).

**Gate Phase 06**
| Pemeriksaan | Test | Hasil |
|---|---|---|
| Finance E2E | `reconciliation.e2e.ts` "Finance: beranda → Mulai rekonsiliasi → 3 langkah → hasil…" | PASS — login Finance, import CSV scoped BR-A (7 & 6 transaksi), run v1, 28,57% · "2 dari 7 grup referensi cocok", ringkasan & panduan, filter REF-007 |
| HR E2E | `performance.e2e.ts` "HR: review EMP-1 = 85…" | PASS — KPI, skor 85,00 (45 + 40), finalisasi dengan konfirmasi, snapshot final + provenance revenue BR-A |
| Approval E2E | `approval.e2e.ts` "alur penuh…" | PASS — pengaju submit Rp15 jt (HIGH) → Manager BR-A → Finance → Disetujui; jejak audit Diajukan + 2× Disetujui dilihat pengaju |
| Isolation UI/API | `integration.e2e.ts` › isolasi Manager B (3 test) | PASS — UI Organisasi/Rekonsiliasi/Performa/Persetujuan tanpa BR-A; deep link `?run=<BR-A>` tidak menampilkan BR-A, `?id=<pengajuan BR-A>` → "Pengajuan tidak ditemukan dalam akses Anda." tanpa tombol keputusan; API: GET run 404, GET results 403 (permission `reconciliation.read` dicek sebelum scope), GET pengajuan 404, POST approve ditolak, status tetap PENDING |
| Session/refresh | `integration.e2e.ts` refresh deep link + 2 test token kedaluwarsa; `auth.e2e.ts` cookie dicabut | PASS — reload `/organization`, `/performance?tab=review`, `/approvals?tab=all&status=APPROVED` mempertahankan URL & filter; rute tak dikenal → halaman tidak ditemukan; JWT sah ber-`exp` lampau → 401, kembali ke login dengan "Sesi Anda telah berakhir" (saat membuka halaman maupun saat navigasi di tengah pemakaian), login ulang kembali ke `/reconciliation?tab=hasil` |
| Persistence | `persistence.e2e.ts` (`@setelah-restart`) setelah `docker compose -p sfp-e2e restart api web` | PASS — review EMP-1 tetap Final 85,00; pengajuan Rp15 jt tetap Disetujui dengan audit lengkap; run BR-A tetap 28,57% |
| Error API | `integration.e2e.ts` error API | PASS — 500 pada daftar persetujuan → alert "Daftar pengajuan gagal dimuat." + Coba lagi memulihkan tanpa reload |
| Overflow desktop | `integration.e2e.ts` desktop 1280px | PASS — `scrollWidth ≤ clientWidth` di beranda, organisasi, performa (analitik & review), rekonsiliasi hasil, persetujuan |

**Perintah**
| Perintah | Hasil |
|---|---|
| `pnpm lint` / `pnpm typecheck` | PASS |
| `pnpm build` | PASS; peringatan `Unsupported engine … node v22.9.0` dan Vite "requires 20.19+ or 22.12+" tetap muncul (risiko terbuka) |
| `pnpm --filter api test` | 83/83 PASS (backend tidak berubah di Phase 06) |
| `pnpm test:integration` | 178/178 PASS, 11 suite |
| `pnpm --filter web test` | 63/63 PASS (+1: daftar persetujuan gagal → Coba lagi; filter status & halaman dikirim ke server; status Draf tidak ada di tab Semua) |
| `pnpm test:e2e` (run 1) | 26/27 — **FAIL** pada `manipulasi request`: test mengharapkan 404 untuk `GET /reconciliation-runs/:id/results` oleh Manager B, backend menjawab 403 karena Manager tidak punya `reconciliation.read` (dicek sebelum scope). Perilaku backend benar dan tidak membocorkan data; ekspektasi test diperbaiki menjadi 403. Tahap restart tidak dijalankan pada run ini karena tahap 1 gagal |
| `pnpm test:e2e` (run 2) | **27/27 PASS** → `restart api web` (log: Restarting → Started → Healthy) → **3/3 PASS** `@setelah-restart` |
| `docker compose up -d --build --wait` (demo) | PASS, tanpa `down -v`; data `support` tetap: 5 approval_requests, 1 reconciliation_run, 0 performance_review, 4 migration; `GET /approvals` → 200 |

**Batas verifikasi**
- Smoke manual oleh manusia belum dilakukan. Bukti berupa E2E browser otomatis dan screenshot; langkah manual yang bisa direproduksi ada di `docs/demo-script.md`.
- Halaman modul hanya diverifikasi di 1280px. Mobile 390px hanya diverifikasi untuk login dan beranda (Phase 02).
- Hang `GET /approval-requests/options` dari Phase 05 tidak muncul lagi di kedua run, tetapi akar masalahnya tetap belum diketahui.

### Phase 05 — 2026-10-31 (workflow approval, concurrency, audit)
**Pemeriksaan awal (perbaikan Phase 04)** — Gate D-42 diperiksa ulang: `performance-source-scope.int-spec.ts` ditambah blok regresi "snapshot menyimpan seluruh cakupan sumber, termasuk unit tanpa transaksi" (periode Oktober; revenue KPI EMP-1 hanya di BR-A, CC-A tanpa transaksi). Hasil: `provenance.revenueSources[].unitIds` = [BR-A, CC-A] (berasal dari pohon organisasi, bukan dari unit yang punya matched revenue), `verifiedRevenue` '0' untuk CC-A, MGR-EXACT 404 & tidak di list, MANAGER-A 200. **15/15 PASS** → tidak ada celah nyata, lanjut ke Phase 05.

**Pengujian wajib** (PostgreSQL nyata, database `*_test`; test concurrency memakai dua instance aplikasi dengan pool Prisma terpisah, hook `HoldBeforeCommit` menahan transaksi pertama sebelum commit dan `pg_locks` memastikan transaksi kedua benar-benar menunggu lock sebelum dilepas; state akhir diperiksa langsung di database)
| # | Pengujian | Test | Hasil |
|---|---|---|---|
| 1 | LOW & BOUNDARY (Rp10.000.000) selesai setelah Manager | approval.int-spec | PASS — 1 langkah, APPROVED |
| 2 | HIGH: Manager lalu Finance | approval.int-spec | PASS — 2 langkah, PENDING → APPROVED |
| 3 | Langkah 2 tidak bisa mendahului langkah 1 | approval.int-spec | PASS — Finance pada langkah WAITING → 409 `STEP_NOT_ACTIVE`, state tetap |
| 4 | Self-approval | approval.int-spec (grant REQUESTER khusus test untuk MANAGER-A, D-04) | PASS — 403 `SELF_APPROVAL_FORBIDDEN` |
| 5 | Lintas cabang / organisasi / HR / tanpa grant | approval.int-spec | PASS — 404 detail, tidak di list/inbox, 403 tanpa permission |
| 6 | Approve vs approve paralel | approval-concurrency | PASS — [200, 409 `STEP_NOT_ACTIVE`], 1 action, langkah 2 ACTIVE; stress 6 approve paralel → 1 sukses |
| 7 | Approve vs reject paralel | approval-concurrency (approve menang & reject menang) | PASS — tepat 1 keputusan terminal, kalah 409 `REQUEST_NOT_PENDING`/`STEP_NOT_ACTIVE`, status konsisten |
| 8 | Submit paralel | approval-concurrency | PASS — [200, 409 `REQUEST_ALREADY_SUBMITTED`], 1 snapshot, 1 set langkah, 1 audit SUBMITTED |
| 9 | stepId lama | approval.int-spec | PASS — 409, langkah berikutnya tidak tersentuh |
| 10 | Delegasi sah; penerima tidak aktif / di luar scope / role salah / pengaju / diri sendiri | approval.int-spec (DELEGATE, INVALID-DELEGATE) | PASS — 200; lainnya 403 `INVALID_DELEGATE`; grant tidak bertambah |
| 11 | Approver lama setelah delegasi | approval.int-spec | PASS — 403 `NOT_ASSIGNEE`; penerima yang grant-nya dipindah → 404, dihapus → 403 (validasi ulang saat bertindak) |
| 12 | Delegate vs approve paralel | approval-concurrency (dua urutan) | PASS — delegasi menang → approve 403 `NOT_ASSIGNEE`; approve menang → delegasi 409; state konsisten |
| 13 | Failure sebelum commit | approval-concurrency (APPROVE/REJECT/DELEGATE/SUBMIT) | PASS — keputusan, status, langkah, dan audit tidak tersimpan |
| 14 | Audit append-only dengan `app_runtime` | approval.int-spec | PASS — UPDATE/DELETE/TRUNCATE permission denied; role bukan superuser/owner; isi audit utuh |
| 15 | Ubah konfigurasi workflow setelah submit | approval.int-spec | PASS — pengajuan tersubmit tetap memakai snapshot (langkah & `applies` tidak berubah) |
| 16 | Regresi D-42, HR, rekonsiliasi | `pnpm test:integration` | PASS — seluruh suite lama tetap lulus |

**Perintah aktual**
| Perintah | Hasil |
|---|---|
| `pnpm lint`, `pnpm typecheck`, `pnpm build` | PASS; peringatan Node 22.9 < 22.12 **masih muncul** |
| `pnpm --filter api test` | **83/83** PASS (permissions, workflow snapshot) |
| `pnpm test:integration` | **178/178** PASS (approval 18, approval-concurrency 11; suite concurrency diulang 3× stabil) |
| `pnpm --filter web test` | **62/62** PASS (approvals 9, termasuk timeout/coba lagi form) |
| `pnpm test:e2e` (stack terisolasi `sfp-e2e`, volume dihapus) | **19/19** PASS (approval 3: alur penuh Manager→Finance, konflik 409 di UI + muat ulang, delegasi). File approval diulang 3× lulus; satu ulangan lambat (45,8 dtk). Screenshot 30–33 |
| `docker compose up -d --build --wait` (demo, tanpa `down -v`) | Semua service healthy; `/api/v1/health/ready` 200 via :8080; migration `20261031000300_approval_workflow` terpasang (3 → 4); data demo tidak berubah (requests 5, runs 1, reviews 0 sebelum & sesudah); `dist/modules/approvals/*` dan `review-access.policy.js` (D-42) ada di container api; `GET /approval-requests/options` untuk employee-a → unit [BR-A, CC-A], WF-BUDGET v1 |

**Kegagalan yang ditemukan & diperbaiki**: (a) test validasi ulang mengharapkan `NOT_ELIGIBLE` padahal grant dihapus → guard menolak lebih dulu (403 `FORBIDDEN`); test dipecah: grant dipindah (404) lalu dihapus (403). (b) deteksi lock waiter lewat `pg_stat_activity` tidak terlihat untuk role non-superuser → diganti `pg_locks`; hold selalu dilepas lewat `try/finally`. (c) E2E: logout berpacu dengan navigasi `/login` dan login menunggu heading beranda padahal aplikasi kembali ke halaman asal → helper menunggu kondisi yang tepat.

**Teramati, belum terjelaskan (risiko terbuka)**: satu kali run E2E alur penuh, request `GET /approval-requests/options` tidak mendapat respons (form macet di "memuat"). Tidak dapat direproduksi (curl 6× 5–20 ms, 3 rerun lulus). Mitigasi: timeout 10 dtk + tombol "Coba lagi" + unit test. Akar masalah diselidiki Phase 07.

### Perbaikan celah otorisasi sumber KPI (review Phase 04) — 2026-10-31
Celah: grant tanpa `include_descendants` yang boleh membaca/mengelola review dapat melihat revenue KPI unit turunan (actual KPI revenue = unit + seluruh turunan; pengecekan lama hanya memeriksa unit rumah review / unit KPI itu sendiri). Gate keamanan Phase 04 diubah ke IN_PROGRESS selama perbaikan.

**1. Reproduksi dulu** — `test/integration/performance-source-scope.int-spec.ts` (actor khusus test: `MGR-EXACT` = MANAGER BR-A `include_descendants=false`, `HR-EXACT` = HR BR-A `include_descendants=false`; CC-A diberi revenue matched 2 jt lewat import+run v1; fixture & grant seed tidak diubah). Sebelum perbaikan: **7 gagal / 7 lulus dari 14** — MGR-EXACT melihat EMP-1 di list & detail (actual 17 jt termasuk CC-A); HR-EXACT bisa preview, finalisasi, ubah KPI, dan membuat KPI revenue BR-A yang mencakup CC-A; review FINAL EMP-2 terbaca & terhitung di distribusi. Analitik RPE sudah aman (subtotal `PARTIAL_SCOPE`).

**2. Perbaikan** — `ReviewAccessPolicy` (business-rules §3.6): unit rumah **dan seluruh** unit sumber KPI (draf: unit KPI + turunan; final: `provenance.revenueSources[].unitIds`) wajib dalam scope permission terkait, dihitung server dari grant. Diterapkan pada list (dikecualikan), detail/preview/finalisasi/KPI create & update (404), distribusi skor (tidak dihitung); finalisasi mengecek ulang setelah KPI terkunci; KPI revenue baru mensyaratkan seluruh subtree dalam scope.

**3. Bukti setelah perbaikan**
| Pemeriksaan | Perintah | Hasil |
|---|---|---|
| Test reproduksi | `jest … performance-source-scope.int-spec.ts` | **14/14 PASS** |
| `include_descendants=false` tidak membuka turunan | MGR-EXACT: EMP-1/EMP-2 tidak di list, detail 404 (respons tanpa 17 jt/20 jt/totalScore), distribusi count 0; RPE BR-A own 15 jt, subtotal null; HR-EXACT: preview/finalisasi/PATCH KPI 404 dan data tidak berubah (status DRAFT, actual KPI-2 tetap 10), KPI revenue BR-A 404, KPI manual 201 | PASS |
| `include_descendants=true` tetap lengkap | MANAGER-A: detail EMP-1 17 jt / skor 91, RPE BR-A subtotal 17 jt, list EMP-1 & EMP-2, distribusi count 1; HR penuh memfinalisasi EMP-1 & EMP-2 (91), provenance mencakup BR-A + CC-A | PASS |
| Snapshot FINAL tidak bocor | EMP-2 final dengan sumber CC-A: MGR-EXACT detail 404, list kosong, distribusi tanpa skor | PASS |
| Karyawan pindahan | MGR-EXACT tidak melihat EMP-3 (unit rumah BR-B) | PASS |
| Baseline & regresi | `pnpm --filter api test` **77/77** (+ `review-access.policy.spec` 2); `pnpm test:integration` **148/148** (termasuk suite Phase 04: EMP-1 = 85, seluruh RPE fixture, finalisasi bersamaan, akses) | PASS |
| Lint / typecheck / build | `pnpm lint`, `pnpm typecheck`, `pnpm build` | PASS; peringatan Node 22.9 < 22.12 **masih muncul** (risiko terbuka) |
| Frontend & E2E | `pnpm --filter web test` 54/54; `pnpm test:e2e e2e/performance.e2e.ts` 3/3 (stack terisolasi) | PASS |
| Database demo | `select count(*) from performance_reviews` | 0 — tidak diubah/di-reset; stack demo **belum** di-rebuild dengan perbaikan ini |

### Perbaikan UX ubah nama unit (Admin) — 2026-10-31
Permintaan pengguna: ubah nama kurang ramah, tombol Simpan/Batal terlalu datar. Hanya frontend.

| Perubahan | Bukti |
|---|---|
| Input kecil di dalam baris tabel diganti **dialog modal** (`components/Dialog.tsx`, `RenameUnitDialog.tsx`): judul + konteks (kode · jenis · organisasi), nama saat ini, isian "Nama baru" dengan penghitung karakter & teks bantu, catatan audit | Test komponen Organisasi (4) |
| Tombol tegas: **Batal** (bergaris, latar putih, bayangan) & **Simpan perubahan** (biru solid, ikon centang, spinner saat menyimpan, nonaktif bila nama belum berubah/kosong); tombol pemicu "Ubah nama" berikon pensil | Screenshot `05-admin-ubah-nama.png` |
| Aksesibilitas: `role=dialog` + `aria-modal`, Esc/klik latar menutup, fokus tidak keluar dialog, fokus kembali ke tombol pemicu; notifikasi sukses bisa ditutup | Test komponen + E2E admin |

Perintah & hasil: `pnpm --filter web lint`/`typecheck` PASS; `pnpm --filter web test` **54/54**; `pnpm test:e2e e2e/auth.e2e.ts` **10/10** (stack terisolasi); `docker compose up -d --build --wait` (demo diperbarui). Backend tidak berubah.

Kegagalan selama perbaikan (diperbaiki): test menemukan **bug fokus** — dialog mencatat elemen pemicu setelah `autoFocus` memindahkan fokus (sehingga fokus tidak kembali ke tombol), dan effect bergantung pada `onClose` yang berganti tiap render induk (bisa mencuri fokus dari input). Diperbaiki dengan mencatat pemicu saat render pertama dan menyimpan `onClose` di ref. Catatan audit di footer terpotong di layar 1280 px → dipindah ke badan dialog.

### Phase 04 — 2026-10-31 (talent, review, revenue per employee)
Pemeriksaan sebelum implementasi: bukti gate Phase 03 ada (integration 104/104 termasuk RULE-V2 & overlap); kontrak `RevenueService` = canonical + MATCHED + REVENUE + `transaction_date` dalam `[from, to)` + unit eksplisit (organisasi lewat FK komposit). Baseline test HR dibangun dari fixture di `support_test` (helper `reconciliationBaseline`: import BR-A & BR-B scoped + run v1 lewat API), bukan sisa E2E.

| # | Pemeriksaan | Perintah | Hasil |
|---|---|---|---|
| 1 | Lint / typecheck / build | `pnpm lint`, `pnpm typecheck`, `pnpm build` | PASS. Peringatan Vite "Node.js 22.9.0 … requires 22.12+" **masih muncul** (risiko terbuka) |
| 2 | Unit backend | `pnpm --filter api test` | PASS — **75/75** (`calc.spec` 17: skor EMP-1 vs `hr/expected-results.json`, cap, bobot, presisi, employee-days masuk/keluar/lintas batas/1 hari/non-primer, unit rumah, RPE & divisi vs expected, band, median) |
| 3 | Integration | `pnpm test:integration` | PASS — **134/134** (performance 30 + regresi auth, scope, sesi, rekonsiliasi, constraint, seed, health) |
| 4 | Unit + komponen frontend | `pnpm --filter web test` | PASS — **53/53** (analitik 3, panel review 3, format 2) |
| 5 | E2E Chrome, stack terisolasi | `pnpm test:e2e` | PASS — **16/16** (performa 3: analitik HR, review EMP-1 85 → finalisasi, MANAGER-A). Database demo: `performance_reviews` tetap 0 setelah E2E |
| 6 | Guard E2E | `playwright test` langsung | Ditolak: "Jalankan lewat `pnpm test:e2e` (stack terisolasi)" |
| 7 | Fixture & secret | `diff -r` dengan zip asli; pencarian nilai `.env` | Identik; tidak ada kebocoran |
| 8 | Migration demo | `docker compose up -d --build --wait` | `20261031000200_performance_review_unit` diterapkan; `_prisma_migrations` = 3 |

Pengujian wajib (integration `performance.int-spec.ts`, PostgreSQL nyata):
| # | Pengujian | Bukti | Hasil |
|---|---|---|---|
| 1 | Angka baseline | HR: BR-A 15 jt/60 hari/2/7,5 jt; BR-B 6 jt/45/1,5/4 jt; BR-ZERO 0/0/null; DIV-1 subtotal 21 jt/105 hari/3,5/6 jt; benchmark BR-A indeks 1,25; EMP-1 lewat API 75/45 + 100/40 = **85** (dibanding `hr/expected-results.json`) | PASS |
| 2 | Target nol/negatif, actual negatif | 400 `VALIDATION_ERROR` (juga bobot 0, >100, 3 desimal, number bukan string) | PASS |
| 3 | Bobot ≠ 100 | EMP-2 60+30 → preview `WEIGHT_TOTAL_NOT_100`, finalisasi 409 `FINALIZE_REJECTED`, status tetap DRAFT; setelah 60+40 bisa | PASS |
| 4 | Cap 120% | EMP-4 15/10 → capaian 150, ber-cap 120, skor 120 | PASS |
| 5 | Masuk/keluar/pindah | Unit test 6 kasus + fixture (EMP-2 masuk 16 Sep, EMP-3 pindah) → BR-A 60, BR-B 45; Oktober BR-A 62 & BR-B 62 hari | PASS |
| 6 | Di luar periode | REF-021 (30 Sep) masuk September (16 jt), REF-020 (5 Okt) hanya Oktober (1 jt, RPE 500 rb) | PASS |
| 7 | Unmatched & organisasi lain | BR-A verified ≠ recorded (I3–I7 tidak masuk); BR-X 9 jt hanya untuk ORG-2 (RPE null, tanpa karyawan); total ORG-1 tanpa 9 jt | PASS |
| 8 | Canonical v1 → v2 | Setelah v2: BR-A 18 jt (bukan 15 + 17), RPE 9 jt; DIV-1 24 jt / 3,5 | PASS |
| 9 | Snapshot stabil | EMP-1 final 85 (provenance run v1, revenue 15 jt) tetap 85 setelah REF-021 & v2; preview ulang mengembalikan snapshot; KPI review final → 409 | PASS |
| 10 | Akses tidak bocor | MANAGER-A: daftar review EMP-1 & EMP-2 saja, detail EMP-3 404 (MANAGER-B 200), EMP-3 tetap ada di master karyawan (D-21 ≠ izin review); analitik hanya BR-A & CC-A, benchmark `PARENT_OUT_OF_SCOPE`, tanpa angka 21 jt/6 jt/4 jt/ID DIV-1; filter unit di luar scope 404; Finance boleh RPE tapi review 403; periode ORG lain 404 | PASS |
| 11 | Finalisasi bersamaan | 6 finalisasi serentak dari 2 instance API → `[200, 409×5]`, 1 review, 1 set item, 1 audit; finalisasi ∥ PATCH KPI → item snapshot = nilai KPI tersimpan; finalisasi ∥ run v2 → revenue snapshot utuh dari salah satu keadaan (16 jt + run v1 **atau** 18 jt + run v2) | PASS |
| 12 | Regresi | Seluruh suite integration 134/134, E2E 16/16 | PASS |

Kegagalan selama phase (sudah diperbaiki):
- **Bug nyata:** filter `unitId` pada analitik RPE untuk HR → 500, karena subtotal induk (benchmark) tidak ikut di-query bila induk tersaring. Diperbaiki & test regresi ditambahkan.
- Test: urutan awal membuat skor EMP-1 menjadi 88 (REF-021 sudah masuk) → finalisasi EMP-1 dipindah ke tahap baseline agar fixture 85 & stabilitas snapshot terbukti lewat API. Lint `require()` di test. Test beranda (urutan kartu berubah).
- E2E: selector `getByLabel('Periode')` ambigu dengan label batang "…di periode ini…" — lulus di run pertama, gagal di run kedua (bergantung urutan muat) → `exact: true`. Run guard sempat menghapus folder screenshot → file performa dijalankan ulang.
- Tampilan: kolom nama KPI terlalu sempit, label band terpotong, "Hr" → "HR".

### Penyegaran header & beranda — 2026-10-31
Permintaan pengguna: header dan beranda "kurang menarik". Hanya frontend; API tidak berubah.

| Perubahan | Bukti |
|---|---|
| Header gelap (senada halaman login): logo, menu berikon dalam satu baris, menu aktif berbentuk pil; di layar kecil menu pindah ke baris kedua yang bisa digeser | E2E HP 390 px tanpa scroll horizontal; screenshot 08, 09 |
| Menu akun: avatar inisial + titik status sistem; dibuka untuk melihat nama, email, peran, status, dan **Keluar**; tutup dengan Escape/klik di luar | E2E "menu akun" (screenshot 14); E2E logout lewat menu |
| Beranda: sapaan sesuai jam Jakarta + tanggal + peran; kartu **Rekonsiliasi terakhir** berisi angka nyata dari run canonical terbaru + tautan detail; kartu tindakan berikon (yang belum tersedia diredupkan); "Akses Anda" | Test `HomePage` (3), `people` (2: nama/inisial, sapaan per jam) |
| Komponen `HealthBadge` diganti titik status di menu akun | typecheck |

Perintah & hasil: `pnpm lint`/`typecheck`/`build` PASS; `pnpm test` backend 58/58, frontend **45/45**; `pnpm test:integration` 104/104; `pnpm test:e2e` **13/13**. Screenshot diperiksa visual (desktop 1280 px & HP 390 px).

Kegagalan: test beranda awalnya ikut menghitung item daftar "Akses Anda" → dibatasi ke region tindakan. Menu akun Finance menampilkan "Finance / Finance" → baris kedua memakai email bila nama sama dengan peran.

### Perapian tampilan untuk staf Finance — 2026-10-31
Permintaan pengguna sebelum Phase 04 ("tampilan masih acak-acakan, saya bingung sebagai Finance"). Hanya frontend; API tidak berubah.

| Perubahan | Bukti |
|---|---|
| Halaman Rekonsiliasi dipecah menjadi tab **Rekonsiliasi baru** (Finance) dan **Riwayat & hasil**; tab & hasil terpilih tersimpan di URL | Test komponen `ReconciliationPage` (2): Finance melihat 3 langkah, Manager langsung riwayat |
| Alur 3 langkah bernomor: cabang & akun → dua kartu unggah berdampingan (sisi sudah tetap, seret-lepas, atau pakai data yang sudah diunggah) → toleransi "Standar ±1 hari (disarankan)" / "Longgar ±2 hari" | `UploadCard` (5), `NewReconciliation` (3): tombol nonaktif sampai kedua data siap, ganti cabang mereset pilihan, v2 terkirim saat "Longgar" dipilih, overlap dijelaskan tanpa istilah teknis |
| Hasil: kartu utama (tingkat kecocokan, revenue terverifikasi, jumlah yang perlu ditindaklanjuti) + **"Yang perlu ditindaklanjuti"** berisi penjelasan & saran per jenis anomali, tombol "Tampilkan transaksinya" memfilter tabel | `RunDetail` (5) |
| Bantuan format CSV dilipat + **Unduh contoh file** | E2E & tampilan |
| Beranda: kartu **"Apa yang bisa Anda lakukan"** sesuai izin (rekonsiliasi paling depan); menu & halaman yang belum tersedia diberi label "Segera" tanpa istilah "Phase" | `HomePage` (2) |
| Header dua baris yang rapi (akun di kanan atas, menu sebagai tab di bawah; bisa digeser di layar kecil) | Screenshot E2E |

Perintah & hasil: `pnpm lint`/`typecheck`/`build` PASS; `pnpm test` backend 58/58, frontend **42/42**; `pnpm test:integration` 104/104; `docker compose up --build -d --wait` + `pnpm test:e2e` **11/11** (alur Finance: beranda → Mulai rekonsiliasi → unggah 2 file → Cocokkan → hasil → filter referensi ganda). Screenshot `frontend/test-results/screens/09–13` diperiksa visual.

Kegagalan selama perapian: selector E2E lama `link "Organisasi"` menjadi ambigu dengan kartu "Lihat organisasi" → memakai nama persis. Header patah tidak rapi di 1280 px terdeteksi dari screenshot → disusun ulang.

### Phase 03 — 2026-10-31 (rekonsiliasi keuangan & idempotensi)
| # | Pemeriksaan | Perintah | Hasil |
|---|---|---|---|
| 1 | Lint / typecheck / build | `pnpm lint`, `pnpm typecheck`, `pnpm build` | PASS |
| 2 | Unit backend | `pnpm --filter api test` | PASS — 58/58 (inti rekonsiliasi 29: matcher vs `expected-results.json`, batas tanggal/nominal, prioritas, determinisme, 7 file invalid, file gabungan, akhir baris campuran, format nominal, fingerprint) |
| 3 | Unit + komponen frontend | `pnpm --filter web test` | PASS — 32/32 (panel import 4, detail run 3) |
| 4 | Integration (PostgreSQL nyata) | `pnpm test:integration` | PASS — **104/104** (rekonsiliasi 29); suite rekonsiliasi diulang 3× → 29/29 setiap kali |
| 5 | E2E Chrome | `docker compose up --build -d --wait` + `pnpm test:e2e` | PASS — **11/11**, diulang 3× stabil (rekonsiliasi 3: import → run v1 → ringkasan; import file salah; tampilan Manager) |
| 6 | Fixture tidak berubah | `diff -r` dengan ekstrak zip asli; `validate_fixtures.py` | PASS — identik |
| 7 | Secret | cari nilai `.env` di repo | PASS |

Gate Phase 03:
| Pemeriksaan | Bukti | Hasil |
|---|---|---|
| BR-A v1: 2/3/1/1, 7 grup, revenue 15.000.000 | Unit (matcher vs expected JSON) + integration (`/results` & `/summary` dibandingkan dengan `expected-results.json`) + E2E | PASS |
| Nominal anomali 7.900.000 / 6.400.000 / 100.000 | Unit + integration + E2E (kartu ringkasan) | PASS |
| Boundary tanggal ±1 diterima, ±2 ditolak v1; nominal exact decimal | Unit (7 kasus tanggal, termasuk lintas bulan; 1000 = 1000.00, 1000 ≠ 1000.01) | PASS |
| Duplikat REF-007 satu grup, seluruh ID, tanpa pairing | Unit + integration (`reason=DUPLICATE_REFERENCE` → I6, I7, E6, `amountDifference: null`) | PASS |
| Idempotensi import ulang / reorder / run ulang | Integration: jumlah tx, dataset, membership, run, hasil, canonical identik sebelum/sesudah; E2E diulang 3× | PASS |
| Concurrency | 6 request serentak dari **dua instance API (dua pool koneksi PostgreSQL)** → statuses `[200×5, 201]`, satu run, 1 hasil | PASS |
| Rollback | Hook gagal sebelum commit → 500 tanpa pesan internal; semua hitungan tabel tidak berubah; retry 201 | PASS |
| Rule v2 → 17.000.000, bukan 32.000.000 | Integration: summary v2 17 jt, `RevenueService.verifiedByUnit` 17 jt, run v1 `isCanonical:false`, canonical BR-A = 7 baris | PASS |
| Overlap & scope | Dataset kedua memuat I1 + I10 → hanya 1 transaksi baru, recorded 26.900.000 (I1 tidak ganda); run overlap 409 tanpa sisa; MANAGER-A hanya run BR-A, ringkasan BR-B 404, rincian 403; OUTSIDER kosong; FINANCE ke BR-X 404; MANAGER import 403 (T-SEC-05) | PASS |
| File invalid BAD-1..7 & gabungan | Integration: 400 dengan reason sesuai `invalid/expected.json`, nol baris tersimpan | PASS |

Kegagalan selama phase (sudah diperbaiki):
- **Bug nyata:** parser CSV menolak file dengan akhir baris campuran (header CRLF fixture + baris LF) karena csv-parse mengunci delimiter dari baris pertama → kini menerima CRLF/LF/CR; test regresi ditambahkan.
- **Bug nyata:** `pg_advisory_xact_lock` mengembalikan `void` yang tidak bisa dideserialisasi `$queryRaw` → 500 pada setiap run; diganti `$executeRaw`. Ditemukan lewat opsi baru `TEST_LOG=1`.
- Test: ekspektasi I9 keliru (seharusnya `ROW_SCOPE_MISMATCH`); karakter BOM literal di kode test; selector E2E Rp100.000 muncul dua kali (kartu & tabel).
- `apiFetch` memasang `Content-Type: application/json` untuk FormData → diperbaiki sebelum dipakai (test komponen memverifikasi).

Catatan: test PARALLEL memakai dua instance aplikasi agar request benar-benar lewat koneksi berbeda; serialisasi dijamin advisory lock, unique constraint sebagai jaring kedua.

### Perbaikan risiko Phase 02 — 2026-10-31
Atas permintaan pengguna sebelum Phase 03.

| Risiko | Perbaikan | Bukti |
|---|---|---|
| 1. Tanpa rate limiting login | 5 gagal per IP+email / 30 per IP per 15 menit → 429 `TOO_MANY_ATTEMPTS` + `Retry-After`; IP dari `X-Forwarded-For` hanya via proxy tepercaya; port API/DB di-bind `127.0.0.1` | Unit `login-throttle.spec` (4); integration `session-security` rate limit (4): blokir walau sandi benar, IP lain tidak terkunci, batas per IP lintas email, sukses mereset |
| 2. Token di sessionStorage | Cookie httpOnly `SameSite=Strict` `Path=/api`; header CSRF wajib untuk mutasi via cookie; `POST /auth/logout`; frontend tidak menyimpan token | Integration (5): atribut cookie, GET via cookie, PATCH tanpa CSRF 403 & data tidak berubah, Bearer tanpa CSRF OK, logout → 401. Test komponen: token tidak ada di sessionStorage/localStorage, header CSRF terkirim. E2E: `document.cookie` tidak memuat `sfp_session`, cookie `httpOnly: true` |
| 3. Endpoint tambahan di luar kontrak | `PATCH /org-units/:id` dan `POST /auth/logout` diresmikan di docs/architecture.md §6 & docs/api.md; dipakai UI (tombol "Ubah nama" Admin) | Test komponen Organisasi (3): tombol hanya untuk `org.manage`, PATCH + CSRF + pesan sukses, validasi & 403 |
| 4. Halaman setelah login belum dicoba di browser | Playwright di Google Chrome 156 terhadap stack Docker | `pnpm test:e2e` → **8/8 PASS**; screenshot di `frontend/test-results/screens/` (01–07) |

Perintah & hasil: `pnpm lint`/`typecheck`/`build` PASS; `pnpm test` backend 29/29, frontend 25/25; `pnpm test:integration` **75/75**; `docker compose build` 67 detik (sebelumnya macet >10 menit pada `RUN chown -R` yang menduplikasi `node_modules`; diganti `COPY --chown`); `pnpm test:e2e` 8/8.

Kegagalan selama perbaikan (sudah diperbaiki): konfigurasi Playwright memakai `__dirname` di ES module; selector E2E "Manager Cabang A (" ambigu dengan "Manager Cabang A (2)"; satu asersi test komponen salah karena nama aksesibel baris tabel ikut memuat isi input.

### Phase 02 — 2026-10-31 (authentication, RBAC, data scoping, login UI)
| # | Pemeriksaan | Perintah | Hasil |
|---|---|---|---|
| 1 | Lint / typecheck / build | `pnpm lint`, `pnpm typecheck`, `pnpm build` | PASS (backend, frontend) |
| 2 | Unit backend | `pnpm --filter api test` | PASS — 6 suite / 25 test (matriks permission, env JWT, tanggal Asia/Jakarta, guard reset, filter error, seed helper) |
| 3 | Unit + komponen frontend | `pnpm --filter web test` (Vitest + jsdom + Testing Library) | PASS — 3 file / 19 test: validasi form, pesan error per status, label akses, kedaluwarsa sesi, dan perilaku halaman login (fokus awal, error per field yang hilang saat diperbaiki, tampil/sembunyi sandi, akun demo mengisi email & memindah fokus, 401 → pesan + sandi dikosongkan + fokus ke alert, gangguan jaringan, status "Sedang masuk…", redirect ke halaman asal) |
| 4 | Integration | `pnpm test:integration` | PASS — 5 suite / **66 test** (Phase 01 24 + auth 14 + scope 28) |
| 5 | Docker end-to-end via nginx :8080 | `docker compose up --build -d` + `curl` | PASS — login salah 401 `INVALID_CREDENTIALS`; login MANAGER-A → `/org-units` = `[BR-A, CC-A]`; tanpa token 401 |
| 6 | Tampilan login | Chrome headless screenshot 1440×900 dan iframe 390px / 320px | PASS secara visual: dua kolom di desktop, satu kolom tanpa terpotong di HP. Interaksi diuji lewat test komponen (#3), bukan klik manual |
| 7 | Secret | cari nilai password/secret `.env` di repo | PASS — tidak ditemukan |

Cakupan gate Phase 02 (integration, PostgreSQL nyata):
| Gate | Test | Hasil |
|---|---|---|
| Login | benar 200 + profil tanpa hash; sandi salah / email tak terdaftar / user nonaktif 401 dengan pesan sama; input invalid 400; field tambahan `role` 400; token tanpa/invalid/`Basic` 401 (T-SEC-06); kedaluwarsa 401 (T-SEC-07); secret lain 401; user dinonaktifkan setelah login → 401 | PASS |
| Tanpa grant | NO-GRANT & REQUESTER `GET /org-units`, `/employees` → 403 (T-SEC-03); `/auth/me` NO-GRANT 200 dengan grant kosong | PASS |
| Lintas cabang | MANAGER-A list = BR-A, CC-A; detail BR-B 404 (T-SEC-01); EMP-4 404; riwayat BR-B EMP-3 disembunyikan; induk DIV-1 tidak dibocorkan | PASS |
| Lintas organisasi | ADMIN ORG-1 detail BR-X 404 (T-SEC-02), filter `organizationId=ORG-2` 404, PATCH BR-X 404 dan data tidak berubah; OUTSIDER tidak melihat karyawan ORG-1 | PASS |
| Grant terikat | user test FINANCE@BR-A + MANAGER@BR-B: scope `dataset.import` = subtree BR-A saja; `approval.decide` = BR-A ∪ BR-B; `review.manage` kosong | PASS |
| Manipulasi input | payload token berisi `role: ADMIN` diabaikan (403); filter `unitId`/`parentId` luar scope 404; `scope=all` 400; `pageSize=1000`/`page=0` 400; body `organizationId` sisipan 400 | PASS |
| Agregat ber-scope | `/employees/summary` MANAGER-A 2026-09-10 = BR-A 2, CC-A 0; ADMIN 2026-09-20 = BR-A 2, BR-B 2, total 4 | PASS |
| Mutasi + audit | ADMIN rename BR-A 200 + audit `ORG_UNIT_RENAMED` dengan traceId; MANAGER-A/HR 403 | PASS |

Kegagalan selama phase (diperbaiki): 2 test auth gagal karena **pola test** `http().get().set(await loginAs())` membuat dua request supertest berbagi server sementara; header kini diambil lebih dulu. Kode aplikasi tidak diubah untuk itu.

Belum diverifikasi: klik manual login → beranda → halaman Organisasi di browser sungguhan (halaman setelah login belum di-screenshot); rate limiting login (belum dibuat).

### Phase 01 — 2026-10-31 (fondasi, migration, Docker)
Semua perintah dijalankan di macOS arm64, Node 22.9.0 (host), Docker Desktop 28.5.2.

| # | Pemeriksaan | Perintah | Hasil |
|---|---|---|---|
| 1 | Lint | `pnpm lint` | PASS (api, web) |
| 2 | Typecheck | `pnpm typecheck` | PASS (api, web) |
| 3 | Build | `pnpm build` | PASS. Peringatan Vite: Node host 22.9.0 < 22.12 yang disyaratkan; build tetap sukses. Image Docker memakai node:22-alpine terbaru. |
| 4 | Unit test | `pnpm test` | PASS — API 3 suite / 16 test (guard reset DB T-INF-03, format error, helper seed); Web 1 file / 3 test (format HALF_UP/Rupiah) |
| 5 | Fresh start | `docker compose up --build -d` dari volume kosong | PASS — db healthy → migrate `Exited (0)`: 2 migration diterapkan, seed `{organizations:2, orgUnits:6, users:9, grants:8, employees:4, assignments:5, periods:1, kpis:2, workflows:1, workflowSteps:2, requests:5}` → api healthy → web up. Image API `arm64`. (T-INF-01) |
| 6 | Endpoint | `curl` ke :3000 dan :8080 | `/health/ready` 200 `{status:ok, database:up}` + header `x-request-id`; `/health/live` 200; via nginx :8080 `/api/v1/health/ready` 200; `/` dan `/performance` (SPA fallback) 200; rute tak dikenal 404 `{code:NOT_FOUND, message, requestId}` |
| 7 | Seed kedua kali | `docker compose run --rm migrate` | PASS — "No pending migrations"; jumlah entity sebelum = sesudah (`2|6|9|8|5|5`, 2 baris `_prisma_migrations`). Juga dari host: `pnpm db:migrate` + `pnpm db:seed` → jumlah sama. (T-INF-02) |
| 8 | Restart / persistensi | insert baris penanda → `docker compose down` (tanpa `-v`) → `up -d` | PASS — penanda (1 baris) dan 9 user tetap ada |
| 9 | Readiness saat DB mati | `docker compose stop db` lalu `curl` | PASS — `/health/ready` 503 `{code:NOT_READY, details:{checks:{database:down}}, requestId}`; `/health/live` tetap 200; setelah `docker compose start db` kembali 200 |
| 10 | Migration gagal menghentikan startup | override Compose sementara (project `sfp-failcheck`, password owner salah) | PASS — migrate `Exited (1)` (P1000 auth failed); `api` & `web` tetap `Created`, tidak start; stack uji dihapus (`down -v` hanya project uji) |
| 11 | Integration test | `docker compose up -d db` + `pnpm test:integration` | PASS — 3 suite / 24 test pada `support_test`: seed idempotent & hash password (T-INF-02), role runtime bukan superuser/owner + hak audit SELECT/INSERT saja (T-INF-04), UPDATE/DELETE audit ditolak untuk runtime (permission denied) dan owner (trigger) (lapisan DB T-APR-10), FK komposit organisasi, overlap penempatan primer ditolak (T-HR-13), CHECK target/amount, satu keputusan terminal per step, health 200/503 |
| 12 | Dev server host | `PORT=3101 pnpm --filter api dev` (sebelum restrukturisasi) | PASS — `/health/ready` 200, proses dihentikan setelahnya |
| 13 | Secret | cari nilai password `.env` di seluruh file repo | PASS — tidak ditemukan; `.env` di-gitignore |

Kegagalan selama phase (sudah diperbaiki, dicatat untuk transparansi):
- Integration test "penempatan ke unit organisasi lain" awalnya gagal karena **test**-nya memakai penempatan primer EMP-4 yang overlap sehingga exclusion constraint terpicu lebih dulu; test diubah memakai `isPrimary: false`. Constraint tidak diubah.
- Filter error awalnya menyembunyikan `details` untuk semua 5xx; diubah agar hanya 5xx tak terduga yang disanitasi (503 `NOT_READY` tetap informatif). Unit test ditambahkan.

**Re-run setelah restrukturisasi folder** (permintaan pengguna: rencana, `backend/`, `frontend/` dipisah):

| # | Pemeriksaan | Hasil |
|---|---|---|
| R1 | `pnpm install`, `prisma generate`, `pnpm lint`, `pnpm typecheck`, `pnpm build` | PASS (backend, frontend) |
| R2 | `pnpm test` | PASS — backend 16/16, frontend 3/3 |
| R3 | `docker compose up --build -d` (volume lama dipertahankan) | PASS — migrate "No pending migrations", seed jumlah sama; api healthy; `:8080/api/v1/health/ready` 200; web `/` 200. Sekaligus bukti persistensi lintas rebuild image |
| R4 | `pnpm test:integration` | PASS — 3 suite / 24 test |
| R5 | Koneksi host seperti pgAdmin: `psql -h localhost -p 5433 -U app_owner -d support` | PASS — `app_owner|support|9 users|6 org_units`. pgAdmin GUI sendiri belum diuji oleh saya |

Belum diverifikasi pada Phase 01: tampilan UI di browser (hanya HTTP 200 dan build), Vite dev server (`pnpm --filter web dev`).

### Phase 00 — 2026-10-31 (review dokumen & konsistensi fixture)
Belum ada kode aplikasi; **tidak ada** test aplikasi, Docker, atau browser yang dijalankan pada phase ini.

| # | Pemeriksaan | Perintah / metode | Hasil |
|---|---|---|---|
| 1 | Validator bawaan fixture | `python3 -I samples/test-data/validate_fixtures.py` | PASS — "references, matching outcomes, anomaly totals, headcount, RPE, KPI and approval fixtures." exit 0 |
| 2 | Cross-check aturan tertulis vs fixture (v2, divisi, rasio HALF_UP, edge KPI, invalid CSV, routing approval, file scoped, fingerprint, grant) | `python3 -I scripts/phase00_crosscheck.py` | PASS — 48/48 cek, exit 0 |
| 3 | Cakupan requirement PDF | Review manual 3 halaman PDF vs [requirements-matrix.md](requirements-matrix.md) | PASS — 10 requirement modul (A-1..C-3) + 8 deliverable (D-1..D-8) terpetakan |
| 4 | Konsistensi angka ARCHITECTURE.md vs fixture | Review manual tabel RPE, skor EMP-1, ringkasan BR-A, v2 | PASS — tidak ada konflik angka; lihat §3 |
| 5 | Environment | `node -v`, `pnpm -v`, `docker compose version`, `docker info`, `pg_isready`, `psql --version`, cek aplikasi browser | Dicatat di §2 |

Catatan: cek #2 adalah model referensi Python dari aturan di business-rules, **bukan** bukti bahwa implementasi aplikasi benar. Fixture tidak membuktikan locking/keamanan aplikasi.

## 2. Environment (Phase 00)
| Tool | Status | Detail |
|---|---|---|
| OS / arsitektur | Tersedia | macOS 15.3.1, arm64 (Apple Silicon) |
| Node.js | Tersedia | v22.9.0 (nvm), npm 11.7.0. **Catatan Phase 01:** Vite 7 mensyaratkan ≥ 22.12 (peringatan saja); disarankan `nvm install 22` |
| pnpm | Tersedia | 10.13.1 |
| Docker | Tersedia, daemon jalan | Docker 28.5.2 (Docker Desktop, aarch64), Compose v2.40.3 |
| PostgreSQL client | Tersedia | psql 14.19 (Homebrew) |
| PostgreSQL server lokal | Jalan di `/tmp:5432` | **Konsekuensi:** Compose tidak boleh bind host port 5432; gunakan 5433 (dev) / 5434 (test) atau tanpa publish. Test DB wajib database terpisah. |
| Python | Tersedia | 3.13.3 (hanya untuk validator fixture) |
| Browser | Tersedia | Google Chrome, Safari terpasang. Playwright **belum** terpasang. Belum ada uji browser. |
| Render PDF | Terbatas | `pdftotext`/`pdftoppm` tidak ada; PDF dirender via PDFKit (swift) lalu dibaca visual |

## 3. Review konsistensi (Phase 00)
| Item | Fixture | ARCHITECTURE / business-rules | Hasil |
|---|---|---|---|
| BR-A grup & status | 7 grup: 2 M, 3 MM, 1 MI, 1 ME | sama | Konsisten |
| Rasio | 2/7 = 28.57 | HALF_UP 2 desimal hanya di output | Konsisten |
| Anomali | int 7.900.000; ext 6.400.000; selisih pasangan 100.000 | sama, tidak dijumlahkan | Konsisten |
| v2 | REF-004 Matched; 17.000.000 | toleransi inklusif ±2 | Konsisten (Δ REF-004 = 2 hari) |
| Toleransi tanggal | REF-002 Δ1 hari Matched; REF-004 Δ2 hari Mismatched di v1 | `|Δ| ≤ toleransi` | Konsisten; aturan inklusif dikunci |
| Headcount | BR-A 60/30=2; BR-B 45/30=1.5; BR-ZERO 0 | interval `[start, end_exclusive)` | Konsisten (EMP-3 pindah 16 Sep, tidak terhitung ganda) |
| RPE divisi | 21.000.000 / 3,5 = 6.000.000 | total/total | Konsisten; rata-rata RPE cabang (5.750.000) ditolak |
| Skor EMP-1 | 85 | cap 120, bobot 60/40 | Konsisten |
| KPI-CAP | 120 | cap 120% × 100% | Konsisten |
| Approval BOUNDARY | 10.000.000 → 1 step | `amount > 10.000.000` → Finance | Konsisten |
| Kode error import | 7 reason | urutan validasi R-2.1 | Konsisten (cek #2) |

Celah / adaptasi yang dicatat (bukan konflik angka; fixture **tidak** diubah):
1. **SELF**: MANAGER-A tidak punya grant REQUESTER di seed. Test SELF menambah grant REQUESTER BR-A khusus di setup test tersebut.
2. **INVALID-DELEGATE** mengharapkan 403 (bukan 404): request berada dalam scope actor; yang tidak eligible adalah target → 403 sesuai urutan R-1.3.
3. Fixture tidak memiliki relasi user ↔ employee; requester adalah user. Self-approval dibandingkan per user ID.
4. File gabungan reconciliation memuat 3 scope; import satu dataset harus per scope (file `scoped/`). File gabungan → 400 `ROW_SCOPE_MISMATCH`.
5. Kode `UNKNOWN_UNIT` vs `UNIT_ORG_MISMATCH` dapat mengungkap keberadaan unit organisasi lain (diterima, dicatat sebagai trade-off).

## 4. Rencana test
Level: **U** unit (tanpa DB), **I** integration (API + PostgreSQL test DB nyata), **C** concurrency (≥2 koneksi PostgreSQL nyata, start disinkronkan), **E** end-to-end UI.

### Infrastruktur
| ID | Lvl | Skenario | Expected | Phase |
|---|---|---|---|---|
| T-INF-01 | I | `docker compose up --build` | db, api, web sehat; `/api/v1/health` 200 | 01 |
| T-INF-02 | I | migrate + seed dari DB kosong 2× | Reproducible, data identik | 01 |
| T-INF-03 | U | Reset DB menolak target yang bukan database test | Error, tidak ada drop | 01 |
| T-INF-04 | I | Runtime role bukan owner/superuser | `rolsuper=false`, bukan owner tabel | 01/05 |

### Security & scope
| ID | Lvl | Fixture | Expected | Phase |
|---|---|---|---|---|
| T-SEC-01 ✅ | I | CROSS-BRANCH | MANAGER-A detail resource BR-B → 404 | 02 |
| T-SEC-02 ✅ | I | CROSS-ORG | ADMIN detail ORG-2 → 404 | 02 |
| T-SEC-03 ✅ | I | NO-GRANT | operasi terlindungi → 403 | 02 |
| T-SEC-04 ✅ | I | AGGREGATE | MANAGER-A verified revenue 15.000.000; respons tidak memuat 6.000.000/9.000.000 | 03/04 |
| T-SEC-05 ✅ | I | ROLE | MANAGER-A import dataset → 403 | 03 |
| T-SEC-06 ✅ | I | TOKEN | token invalid → 401 | 02 |
| T-SEC-07 ✅ | I | — | token kedaluwarsa / user nonaktif → 401 | 02 |
| T-SEC-08 | I | — | list + pagination + audit endpoint hanya berisi data dalam scope; pageSize > 100 → 400 | 02–05 |

### Rekonsiliasi
| ID | Lvl | Fixture | Expected | Phase |
|---|---|---|---|---|
| T-REC-01 ✅ | I | expected-results BR-A | 7 grup identik (status, reason, ID) | 03 |
| T-REC-02 ✅ | U | — | prioritas klasifikasi; batas toleransi inklusif; trim reference; nominal 1000 vs 1000.00 sama | 03 |
| T-REC-03 ✅ | I | summary BR-A | rasio 28.57; 7.900.000; 6.400.000; 100.000; counts | 03 |
| T-REC-04 ✅ | I | other_scopes | BR-B & BR-X Matched; terisolasi per organisasi | 03 |
| T-REC-05 ✅ | I | IMPORT-TWICE | dataset ID sama; jumlah transaksi tetap | 03 |
| T-REC-06 ✅ | I | REORDER | fingerprint & dataset sama | 03 |
| T-REC-07 ✅ | I | RUN-TWICE | run ID sama; 7 grup | 03 |
| T-REC-08 ✅ | C | PARALLEL | satu run committed; tanpa hasil ganda | 03 |
| T-REC-09 ✅ | I | RULE-V2 | run baru; REF-004 Matched; verified BR-A 17.000.000 (bukan 32.000.000) | 03/04 |
| T-REC-10..16 ✅ | I | BAD-1..BAD-7 | 400 dengan reason sesuai; 0 baris tersimpan | 03 |
| T-REC-17 ✅ | I | ROLLBACK | kegagalan diinjeksi sebelum commit → tidak ada hasil parsial; retry sukses | 03 |
| T-REC-18 ✅ | I | — | ID transaksi sama, payload beda → 409 TRANSACTION_CONFLICT | 03 |
| T-REC-19 ✅ | I | — | overlap canonical dengan pasangan dataset lain → 409 | 03 |
| T-REC-20 ✅ | I | file gabungan | 400 ROW_SCOPE_MISMATCH | 03 |

### HR / performa
| ID | Lvl | Fixture | Expected | Phase |
|---|---|---|---|---|
| T-HR-01 ✅ | I | EMP-1 | KPI-1 75/45, KPI-2 100/40, total 85 | 04 |
| T-HR-02 ✅ | U | — | formula skor Decimal tanpa pembulatan antara; tampilan HALF_UP | 04 |
| T-HR-03 ✅ | U | KPI-CAP | 120 | 04 |
| T-HR-04 ✅ | I | KPI-ZERO | 400 VALIDATION_ERROR | 04 |
| T-HR-05 ✅ | I | KPI-NEGATIVE | 400 VALIDATION_ERROR | 04 |
| T-HR-06 ✅ | I | BAD-WEIGHTS | finalize 409 FINALIZE_REJECTED | 04 |
| T-HR-07 ✅ | I | SNAPSHOT | finalize lalu run v2 → skor final tetap 85; analitik live berubah | 04 |
| T-HR-08 ✅ | I | BR-A, BR-B | headcount 2 / 1.5; RPE 7.500.000 / 4.000.000 | 04 |
| T-HR-09 ✅ | I | BR-ZERO | RPE null | 04 |
| T-HR-10 ✅ | I | DIV-1 | 21.000.000 / 3.5 = 6.000.000; ORG-2 tidak ikut | 04 |
| T-HR-11 ✅ | I | — | distribusi bucket skor review final per unit | 04 |
| T-HR-12 ✅ | I | — | gap RPE cabang vs induk; cabang null dikecualikan dari min/max | 04 |
| T-HR-13 ✅ | I | — | penempatan primer overlap ditolak constraint DB | 01/04 |

### Approval & audit
| ID | Lvl | Fixture | Expected | Phase |
|---|---|---|---|---|
| T-APR-01 ✅ | I | LOW | APPROVED setelah step 1 | 05 |
| T-APR-02 ✅ | I | BOUNDARY | 1 step; APPROVED | 05 |
| T-APR-03 ✅ | C | RACE | HTTP [200, 409]; 1 keputusan step 1; PENDING step 2 | 05 |
| T-APR-04 ✅ | C | RACE-REJECT | HTTP [200, 409]; 1 keputusan; PENDING step 2 atau REJECTED | 05 |
| T-APR-05 ✅ | I | STALE-STEP | 409 | 05 |
| T-APR-06 ✅ | I | HIGH | 2 step; APPROVED | 05 |
| T-APR-07 ✅ | I | SELF | 403 | 05 |
| T-APR-08 ✅ | I | DELEGATE | PENDING step 2; audit SUBMITTED, DELEGATED, APPROVED; MANAGER-A tak bisa bertindak lagi | 05 |
| T-APR-09 ✅ | I | INVALID-DELEGATE | 403 | 05 |
| T-APR-10 ✅ | I | AUDIT | UPDATE/DELETE audit_events dengan role runtime → permission denied; data tetap | 05 |
| T-APR-11 ✅ | I | — | kegagalan setelah keputusan sebelum commit → tidak ada keputusan maupun audit | 05 |

### UI
| ID | Lvl | Skenario | Phase |
|---|---|---|---|
| T-E2E-01 | E | Login per role; menu sesuai permission | 06 |
| T-E2E-02 | E | Finance: import scoped BR-A → run → hasil & ringkasan | 06 |
| T-E2E-03 | E | HR: hitung & finalisasi EMP-1; dashboard RPE/gap | 06 |
| T-E2E-04 | E | Approval: submit REQ-HIGH → manager → Finance; timeline audit | 06 |
