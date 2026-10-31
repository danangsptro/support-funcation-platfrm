# Requirements matrix

Sumber requirement: `Technical Assignment - Product Engineer Support Function.pdf` (3 halaman, berupa gambar; dibaca visual per halaman pada Phase 00).
Aturan detail: [business-rules.md](business-rules.md). Rencana & bukti test: [test-report.md](test-report.md).

Status kolom terakhir: `PLANNED` (belum diimplementasi), `IN_PROGRESS`, `DONE` (test lulus + bukti tercatat). Per Phase 07: seluruh requirement modul A-1..C-3 **DONE**; deliverable D-1..D-8 tercantum di bawah dengan buktinya (lihat juga [SUBMISSION_CHECKLIST.md](SUBMISSION_CHECKLIST.md)).

## 1. Requirement wajib dari PDF
| ID | Hal. | Requirement PDF | Fitur / keputusan | Endpoint / UI | Test ID | Bukti demo | Phase | Status |
|---|---|---|---|---|---|---|---|---|
| A-1 | 1 | Model data performa yang menghubungkan target KPI/OKR karyawan dengan pencapaian pendapatan unit secara berkala | `review_periods`, `kpi_assignments` (source `VERIFIED_UNIT_REVENUE` → unit), actual revenue diambil dari verified revenue unit/periode (R-3.1, R-3.3) | `GET/POST /review-periods`; `POST/PATCH /kpi-assignments`; UI Performance | T-HR-01, T-HR-02, T-HR-07 | KPI-1 EMP-1 actual 15.000.000 dari BR-A | 04 | DONE (Phase 04: unit + integration + E2E, lihat test-report) |
| A-2 | 1 | Modul kalkulasi evaluasi performa: siklus review berkala, pembobotan skor, otomasi RPE per tim/cabang | Calculate/finalize review, cap 120%, Σ bobot 100, snapshot immutable; RPE = verified revenue / avg headcount | `POST /reviews/calculate`; `POST /reviews/:id/finalize`; `GET /reviews`; `GET /analytics/revenue-per-employee` | T-HR-01..06, T-HR-08..10 | Skor EMP-1 = 85; RPE BR-A 7,5 jt, BR-B 4 jt, DIV-1 6 jt, BR-ZERO N/A | 04 | DONE (Phase 04: unit + integration + E2E, lihat test-report) |
| A-3 | 1 | Metrik analitik distribusi talenta & kesenjangan produktivitas lintas cabang secara transparan | Bucket skor per unit; RPE cabang vs induk (selisih, indeks, max−min); recorded vs verified revenue ditampilkan terpisah (R-3.4) | `GET /analytics/performance`; `GET /analytics/revenue-per-employee`; UI dashboard HR | T-HR-11, T-HR-12, T-SEC-04 | Dashboard HR DIV-1 menampilkan gap BR-A vs BR-B | 04, 06 | DONE (Phase 04: unit + integration + E2E, lihat test-report) |
| B-1 | 2 | Rekonsiliasi otomatis dua himpunan transaksi berbasis kunci referensi, toleransi tanggal, nilai nominal | Import CSV tervalidasi, matching kunci org+unit+account+currency+reference, toleransi v1 ±1 hari / nominal 0 (R-2.1, R-2.4) | `POST /datasets/import`; `GET /datasets`; `POST /reconciliation-runs`; UI Finance | T-REC-01..03, T-REC-10..16 | Import scoped BR-A → run v1 → 7 grup | 03 | DONE (Phase 03: unit + integration + E2E, lihat test-report) |
| B-2 | 2 | Klasifikasi deterministik: Matched, Mismatched, Missing in Internal, Missing in External | Prioritas duplicate → missing → amount → date → matched; reason code | `GET /reconciliation-runs/:id/results` | T-REC-01, T-REC-02, T-REC-04 | Tabel hasil BR-A sesuai expected-results.json | 03 | DONE (Phase 03: unit + integration + E2E, lihat test-report) |
| B-3 | 2 | Idempoten: eksekusi ulang dataset sama tidak menduplikasi status / mengotori kalkulasi | Fingerprint dataset, identitas transaksi sumber, run unik (pasangan, versi), run canonical per transaksi (R-2.2, R-2.3, R-2.6) | idem B-1 | T-REC-05..09, T-REC-17 | Import 2× & run 2× → ID sama; v2 → 17 jt, bukan 32 jt | 03 | DONE (Phase 03: unit + integration + E2E, lihat test-report) |
| B-4 | 2 | Endpoint ringkasan analitik real-time: rasio keberhasilan & rincian total nilai transaksi anomali | Dihitung on-request dari hasil tersimpan: rasio, total anomali internal/eksternal, selisih pasangan unik, hitungan per status/reason (R-2.5) | `GET /reconciliation-runs/:id/summary` | T-REC-03, T-SEC-04 | Ringkasan BR-A: 28.57%, 7,9 jt / 6,4 jt / 100 rb | 03 | DONE (Phase 03: unit + integration + E2E, lihat test-report) |
| C-1 | 2 | Mesin persetujuan bertingkat (sekuensial/kondisional) dengan kontrol konkurensi DB mencegah double-approval & konflik paralel | Workflow snapshot saat submit; row lock `FOR UPDATE`, unique decision per step, 409 stale (R-4.1, R-4.2) | `POST/GET /approval-requests`; `POST /approval-requests/:id/submit`; `POST …/steps/:stepId/{approve,reject}`; UI Approval | T-APR-01..07 | Demo REQ-HIGH 2 step; test race 200/409 | 05 | DONE (Phase 05: integration + concurrency tumpang tindih + E2E) |
| C-2 | 2 | Row-level data scoping berbasis hierarki organisasi (Org, Divisi, Cabang, Cost Center), default-deny | Grant (role+scope+descendants); scope filter di service/query untuk list, detail, mutasi, agregasi, audit; 404 di luar scope (R-1) | Semua endpoint; `GET /auth/me`; `GET /org-units`; `GET /employees` | T-SEC-01..08 | Login MANAGER-A hanya melihat BR-A (15 jt), tidak 6 jt/9 jt | 02 (+ tiap modul) | DONE (diterapkan di master, rekonsiliasi, performa/D-42, approval; Phase 02–05) |
| C-3 | 2 | Audit trail immutable untuk riwayat persetujuan, penolakan, delegasi | `audit_events` append-only; privilege DB runtime SELECT/INSERT; trigger; atomik dengan keputusan (R-4.4) | `POST …/steps/:stepId/delegate`; `GET /approval-requests/:id/audit` | T-APR-08..11 | Timeline audit REQ-DELEGATE; UPDATE audit → permission denied | 05 | DONE (Phase 05: audit atomik, append-only diuji UPDATE/DELETE/TRUNCATE) |

## 2. Deliverable wajib dari PDF
| ID | Hal. | Deliverable | Rencana | Verifikasi | Phase | Status |
|---|---|---|---|---|---|---|
| D-1 | 2 | Source code backend API, skema migrasi DB relasional, UI internal tools sederhana | NestJS API, Prisma migrations + custom SQL, React/Vite UI | Build + test lulus di Node 22.23.4; E2E desktop & HP | 01–07 | __D1__ |
| D-2 | 2 | Docker Compose: API, DB, Web jalan dengan satu perintah | `compose.yaml` (db, migrate, api, web); image `migrate` & `runtime` terpisah | Salinan bersih: build tanpa cache, `up -d --build --wait`, seed ulang, restart, migration gagal → API tidak start | 01, 07 | __D2__ |
| D-3 | 2 | Automated test suite (unit + integration): kalkulasi performa, rekonsiliasi, pencegahan konkurensi approval | Jest unit + Supertest integration pada PostgreSQL test DB terpisah; race dengan dua instance aplikasi | test-report "Hasil final Phase 07" | 01–07 | __D3__ |
| D-4 | 2 | Presentation deck 5–7 slide (PDF/interaktif), cakupan: (1) arsitektur & ERD, (2) kalkulasi performa & RPE, (3) mesin rekonsiliasi & idempotensi, (4) konkurensi approval & RBAC, (5) trade-off produk & roadmap | Deck 7 slide (PDF) disimpan presenter di luar repository atas keputusan pengguna | Dirender & diperiksa (tanpa teks meluap/terpotong); klaim vs test-report | 07 | DONE (di luar repo) |
| D-5 | 2 | README.md: setup lokal, menjalankan migrasi DB, eksekusi automated test | [README.md](../README.md) | Diikuti pada salinan bersih (env, compose, seed, data demo, test di container Node 22.23.4) | 00–07 | __D5__ |
| D-6 | 2 | PRODUCT_MEMO.md: keputusan teknis, asumsi bisnis, trade-off arsitektur, kemudahan pakai staf operasional/HR/Finance | [PRODUCT_MEMO.md](../PRODUCT_MEMO.md) | Angka contoh dicocokkan dengan fixture; konsisten dengan business-rules | 00–07 | DONE |
| D-7 | 1 | Format penyerahan: repositori Git | Repo ini; file paket = `git ls-files -co --exclude-standard` (belum di-commit; commit/push atas instruksi pengguna) | git status, pemindaian rahasia | 07 | IN_PROGRESS (menunggu commit oleh pemilik) |
| D-8 | 1 | Sesi 45 menit presentasi + technical code defense | [demo-script.md](demo-script.md) (stack gladi); catatan presenter disimpan di luar repository | Langkah demo = perilaku yang diuji E2E; dry run oleh presenter belum dilakukan | 07 | DONE (dokumen); dry run manusia belum |

## 3. Kriteria evaluasi (hal. 3) → bukti yang disiapkan
| Dimensi | Bobot | Bukti utama |
|---|---:|---|
| Logika bisnis & metrik produktivitas | 25% | A-1..A-3, T-HR-*, angka fixture HR |
| Rekonsiliasi keuangan & idempotensi | 25% | B-1..B-4, T-REC-* termasuk paralel & rollback |
| Integritas transaksi & konkurensi | 20% | C-1, T-APR-03..05 (2 koneksi PostgreSQL nyata), T-REC-08 |
| Arsitektur kode, RBAC & testing | 20% | C-2, struktur modular, T-SEC-*, test edge case |
| Presentasi & pertahanan solusi | 10% | D-4, D-8, PRODUCT_MEMO |

Petunjuk tambahan PDF: bebas memilih bahasa/framework; penilaian menekankan ketahanan terhadap transaksi nyata, akurasi finansial/SDM, dan tata kelola akses.

## 4. Asumsi desain (bukan requirement PDF)
Asumsi berasal dari `ARCHITECTURE.md` dan fixture; tidak boleh diklaim sebagai permintaan PDF. Detail di business-rules.

| ID | Asumsi | Asal | Dampak |
|---|---|---|---|
| ASM-01 | Stack NestJS + React/Vite + PostgreSQL + Prisma + Decimal | ARCH | Seluruh phase |
| ASM-02 | Definisi verified revenue = internal REVENUE Matched pada run canonical; metrik operasional | ARCH | RPE, KPI revenue |
| ASM-03 | Avg headcount = employee-days / hari kalender periode; agregasi induk = total/total | ARCH, FX | RPE |
| ASM-04 | KPI higher-is-better, cap 120%, Σ bobot 100 saat finalisasi | ARCH, FX | Skor review |
| ASM-05 | Kunci matching org+unit+account+currency+reference; toleransi v1 ±1 hari, nominal 0; one-to-one | ARCH, FX | Rekonsiliasi |
| ASM-06 | Duplicate reference = satu grup Mismatched, tidak dipasangkan | FX | Rekonsiliasi |
| ASM-07 | Run canonical per transaksi, run baru otomatis canonical, overlap ditolak | ARCH (dirinci Phase 00) | Analitik |
| ASM-08 | Workflow demo ≤10 jt manager; >10 jt manager → Finance | ARCH, FX | Approval |
| ASM-09 | Status HTTP 400/401/403/404/409 dan urutan pengecekan | ARCH, FX (dirinci Phase 00) | Semua API |
| ASM-10 | Distribusi talenta = bucket skor; gap = RPE cabang vs induk | Phase 00 | A-3 |
| ASM-11 | Batas 5000 baris / 1 MiB, proses sinkron | ARCH | Import |
| ASM-12 | ADMIN tanpa keputusan bisnis (pemisahan tugas) | Phase 00 | RBAC |

## 5. Pemetaan skenario fixture → test ID
| Fixture | Skenario | Test ID |
|---|---|---|
| reconciliation/expected-results.json | BR-A 7 grup + summary | T-REC-01, T-REC-03 |
| reconciliation/expected-results.json `other_scopes` | BR-B, ORG-2 Matched | T-REC-04 |
| reconciliation/idempotency-scenarios.json | IMPORT-TWICE, REORDER, RUN-TWICE, PARALLEL, RULE-V2, ROLLBACK | T-REC-05, -06, -07, -08, -09, -17 |
| invalid/expected.json | BAD-1..7 | T-REC-10..16 |
| hr/expected-results.json | BR-A, BR-B, BR-ZERO, DIV-1, EMP-1 | T-HR-01, T-HR-08..10 |
| hr/edge-cases.json | KPI-CAP, KPI-ZERO, KPI-NEGATIVE, BAD-WEIGHTS, SNAPSHOT | T-HR-03..06, T-HR-07 |
| approval/test-scenarios.json | LOW, BOUNDARY, HIGH, RACE, RACE-REJECT, STALE-STEP, DELEGATE, INVALID-DELEGATE, SELF, AUDIT | T-APR-01..11 |
| security/test-scenarios.json | CROSS-BRANCH, CROSS-ORG, NO-GRANT, AGGREGATE, ROLE, TOKEN | T-SEC-01..06 |
