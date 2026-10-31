# Aturan bisnis implementasi

Status: **dikunci di Phase 00** (2026-10-31). Perubahan berikutnya wajib dicatat di `PROGRESS.md` → Catatan keputusan.

Sumber: PDF soal (requirement), `samples/test-data/` (fixture & expected results), `ARCHITECTURE.md` (desain awal).
Label sumber: **[PDF]** requirement wajib, **[FX]** kontrak fixture, **[ASM]** asumsi/keputusan desain (wajib disebut di PRODUCT_MEMO).

## 0. Konvensi umum
| ID | Aturan | Sumber |
|---|---|---|
| R-GEN-01 | Semua nominal, bobot, persentase memakai Decimal (API: string desimal; DB: `NUMERIC`). Float dilarang di domain. | FX, ASM |
| R-GEN-02 | Tidak ada pembulatan antara. Presisi kalkulasi 34 digit signifikan (decimal.js); hasil non-terminating (mis. 2/3) disimpan pada presisi itu. Tampilan: HALF_UP 2 desimal. API mengembalikan nilai penuh **dan** nilai `display` 2 desimal untuk metrik turunan. | FX, ASM |
| R-GEN-03 | Tanggal transaksi dan penempatan adalah *business date* (`DATE`), bukan timestamp; tidak dikonversi timezone. Periode memakai `[start_date, end_date_exclusive)` dengan timezone label `Asia/Jakarta`. | FX |
| R-GEN-04 | ID fixture (`ORG-1`, `BR-A`, `I1`, …) disimpan sebagai `external_key` unik per organisasi; PK internal UUID. API memakai camelCase, CSV memakai snake_case dengan adapter eksplisit. | FX, ASM |
| R-GEN-05 | Mata uang MVP hanya `IDR`; tipe transaksi hanya `REVENUE` dengan amount > 0. | FX |

## 1. Akses, role, dan scope (Modul C)
### 1.1 Model
- Grant = (user, role, organization, unit nullable, include_descendants). `unit = null` berarti seluruh organisasi. Role dan scope terikat dalam satu grant; permission user = gabungan grant, **tidak** boleh memakai role dari grant A dengan scope grant B. [FX, ASM]
- Hierarki: Organization → Division → Branch → Cost Center (`org_units.parent_id`, parent wajib satu organisasi). [PDF, FX]
- Default-deny: tanpa grant yang cocok untuk (aksi, unit resource) maka ditolak. [PDF]

### 1.2 Matriks permission (MVP)
| Aksi | ADMIN | HR | FINANCE | MANAGER | REQUESTER |
|---|:-:|:-:|:-:|:-:|:-:|
| Baca org unit & karyawan dalam scope | ✓ | ✓ | ✓ | ✓ | – |
| Kelola periode review, KPI, kalkulasi & finalisasi review | – | ✓ | – | – | – |
| Baca review & analitik performa/RPE | ✓ | ✓ | ✓ (RPE saja) | ✓ | – |
| Import dataset, jalankan rekonsiliasi | – | – | ✓ | – | – |
| Baca dataset, hasil & ringkasan rekonsiliasi | ✓ | – | ✓ | ✓ (ringkasan) | – |
| Buat & submit approval request | – | – | – | – | ✓ |
| Approve/reject/delegate step | – | – | sesuai step | sesuai step | – |
| Baca approval request & audit | ✓ (oversight, tersubmit, baca saja) | – | ✓ (reviewer langkah dalam scope) | ✓ (reviewer langkah dalam scope) | ✓ (milik sendiri) |

ADMIN tidak mengambil keputusan bisnis (pemisahan tugas) dan tidak pernah membaca organisasi lain. [ASM]

### 1.3 Urutan pemeriksaan & status HTTP
1. Token tidak ada/invalid/kedaluwarsa → **401** `UNAUTHENTICATED`. [FX TOKEN]
2. User tidak punya permission untuk aksi di mana pun → **403** `FORBIDDEN`. [FX NO-GRANT, ROLE]
3. Resource/target di luar scope actor → **404** `NOT_FOUND` (tidak membedakan "ada tapi terlarang" dan "tidak ada"). [FX CROSS-BRANCH, CROSS-ORG]
4. Input tidak valid → **400** `VALIDATION_ERROR` + detail field/baris.
5. State tidak mengizinkan (step sudah diputus, review final, konflik idempoten) → **409** `CONFLICT`.
6. Actor dalam scope tetapi tidak berhak atas tindakan spesifik (self-approval, bukan assignee, target delegasi tidak eligible) → **403**. [FX SELF, INVALID-DELEGATE]

Body error: `{ code, message, requestId, details? }` tanpa stack/secret. Organization/unit pada body request **bukan** bukti kewenangan; selalu dicek terhadap grant. Agregasi (analitik, ringkasan) memfilter dengan scope tepercaya dari actor, bukan dari parameter. [ASM, FX AGGREGATE]

### 1.4 Autentikasi
Password di-hash (argon2/bcrypt); seed mengambil `DEMO_PASSWORD` dari environment. JWT HS256 kedaluwarsa 1 jam, secret dari environment; tanpa refresh token (roadmap). User nonaktif ditolak 401. [FX, ASM]

### 1.4a Implementasi (Phase 02)
- Token JWT HS256 hanya berisi `sub` + `typ`; algoritme dikunci saat verifikasi. Role & grant dimuat ulang dari DB setiap request, sehingga perubahan grant/penonaktifan berlaku seketika (token lama user nonaktif → 401).
- Scope dihitung **per permission** dari grant yang role-nya memberi permission tersebut (contoh: FINANCE@BR-A + MANAGER@BR-B → `dataset.import` hanya BR-A). Descendant via recursive CTE.
- Visibilitas karyawan: grant seluruh organisasi melihat semua karyawan organisasi; selain itu karyawan yang pernah/sedang ditempatkan di unit dalam scope. Riwayat penempatan di unit luar scope disembunyikan.
- Unit induk di luar scope tidak dibocorkan (`parentId: null`).
- Filter klien (`organizationId`, `parentId`, `unitId`) hanya mempersempit; nilai di luar scope → 404. Parameter tak dikenal → 400.
- Login gagal memakai satu pesan untuk email tak terdaftar / sandi salah / akun nonaktif, dengan perbandingan bcrypt tiruan agar waktu respons serupa.
- Sesi browser memakai cookie httpOnly `sfp_session` (`SameSite=Strict`, `Path=/api`, `Secure` bila `COOKIE_SECURE=true`), tidak terbaca JavaScript. Request mengubah data via cookie wajib header `X-Requested-With: sfp-web` (403 `CSRF_CHECK_FAILED`). Bearer header tetap diterima untuk klien API/CLI.
- Rate limit login: 5 gagal per (IP + email) atau 30 gagal per IP dalam jendela 15 menit → 429 `TOO_MANY_ATTEMPTS` + `Retry-After`, termasuk bila sandi benar. Kunci IP+email (bukan email saja) agar penyerang dari IP lain tidak bisa mengunci akun korban. Login sukses mereset hitungan IP+email. IP klien dibaca dari `X-Forwarded-For` hanya bila datang dari proxy tepercaya (`TRUST_PROXY`, default jaringan privat); port API & DB di Compose hanya terbuka untuk `127.0.0.1`.
- Batas: penyimpanan hitungan in-memory per proses API (hilang saat restart, tidak dibagi antar instance) — perlu Redis/DB bila diskalakan. Logout menghapus cookie, tetapi token tidak dicabut di server sampai kedaluwarsa (maks. 1 jam).

### 1.5 Pagination
Default `pageSize=20`, maksimum 100; nilai di atas maksimum → 400. [ASM]

## 2. Rekonsiliasi keuangan (Modul B)
### 2.1 Import dataset
- Request import menyatakan scope dataset: `organizationId, unitId, accountId, side (INTERNAL|EXTERNAL)`. Actor wajib FINANCE dengan scope mencakup unit → kalau tidak punya permission import sama sekali 403, unit di luar scope 404. [FX ROLE, ASM]
- Header CSV wajib persis: `transaction_id,organization_id,unit_id,account_id,reference,transaction_date,amount,currency,transaction_type`. [FX]
- Validasi seluruh file sebelum commit; satu baris gagal → seluruh import ditolak **400**, nol baris tersimpan. Respons memuat daftar error per baris (maks. 100). [FX invalid/expected.json]
- Urutan validasi per baris (menentukan reason tunggal per baris):
  1. `INVALID_AMOUNT` — bukan desimal valid.
  2. `INVALID_DATE` — bukan tanggal ISO kalender valid (mis. 2026-02-30).
  3. `REQUIRED_REFERENCE` — reference kosong setelah trim. Field wajib lain kosong → `REQUIRED_FIELD`.
  4. `UNSUPPORTED_CURRENCY` — selain IDR.
  5. `UNSUPPORTED_TRANSACTION_TYPE` — selain REVENUE.
  6. `UNKNOWN_UNIT` — unit tidak ada.
  7. `UNIT_ORG_MISMATCH` — unit milik organisasi lain dari `organization_id` baris/dataset.
  8. `ROW_SCOPE_MISMATCH` — baris valid tetapi unit/account berbeda dari scope dataset (mis. file gabungan multi-scope). File gabungan **tidak** diimpor; gunakan file `scoped/`.
  9. `NEGATIVE_REVENUE` — amount ≤ 0 (nol juga ditolak dengan kode ini).
  10. `DUPLICATE_TRANSACTION_ID` — transaction_id ganda dalam satu file.
- Batas: 5000 baris dan 1 MiB per file (melebihi baris → 400 `TOO_MANY_ROWS`; melebihi byte → 413). [ASM]
- **Implementasi (Phase 03):** format nominal `^-?\d{1,18}(\.\d{1,2})?$` (tanpa pemisah ribuan/eksponen, maks. 2 desimal) → selain itu `INVALID_AMOUNT`. Jumlah kolom salah → `COLUMN_COUNT`. Akhir baris CRLF/LF/CR campuran diterima; BOM diabaikan. Respons 400 berkode `IMPORT_REJECTED` dengan `details.errors[] = { line, transactionId, code, message }` (maks. 100) dan `details.totalErrors`; error tingkat file memakai kode sendiri (`INVALID_HEADER`, `EMPTY_FILE`, `TOO_MANY_ROWS`, `INVALID_CSV`). Hanya file `.csv`. Organisasi dataset diturunkan dari unit yang dipilih (bukan dari klien). Baris harus persis unit & akun dataset (bukan descendant). Import baru 201, file identik 200 `created:false`.
- Catatan risiko: `UNKNOWN_UNIT` vs `UNIT_ORG_MISMATCH` mengungkap keberadaan unit di organisasi lain; diterima karena kontrak fixture, dicatat sebagai trade-off. [FX]

### 2.2 Identitas transaksi & dataset (idempotensi)
- Identitas transaksi sumber = (organization, side/source system, account, source `transaction_id`). Transaksi canonical disimpan sekali; dataset menyimpan *membership* (`dataset_transactions`). [ASM]
- ID sama dengan payload sama di import lain → dipakai ulang (tidak menambah baris). ID sama dengan payload berbeda → **409** `TRANSACTION_CONFLICT`; koreksi memerlukan versi data eksplisit (roadmap). [ASM]
- Duplikat referensi dengan `transaction_id` berbeda **tidak** dihapus (multiplicity dipertahankan). [FX]
- Fingerprint dataset = SHA-256 dari: scope (org/unit/account) + side + baris canonical terurut. Baris canonical = `transaction_id | trim(reference) | ISO date | amount canonical (tanpa trailing zero) | currency | type`. Reorder baris/format nominal setara → fingerprint sama. Unique `(organization_id, fingerprint)` → import ulang mengembalikan dataset yang sama (200, `created=false`). [FX IMPORT-TWICE, REORDER]
- CSV immutable setelah import. [FX]

### 2.3 Run rekonsiliasi
- Input: dataset internal + eksternal dengan scope identik (MVP) + versi aturan. Scope beda → 400 `DATASET_SCOPE_MISMATCH`. [ASM]
- Aturan versi: `v1` = toleransi tanggal ±1 hari, toleransi nominal 0. `v2` = ±2 hari, nominal 0. Toleransi inklusif: `|Δhari| ≤ toleransi`. [FX]
- Identitas run unik `(internal_dataset_id, external_dataset_id, rule_version)`. Run ulang → run yang sama, tanpa hasil baru. Run paralel → satu commit (unique constraint + `INSERT … ON CONFLICT`/advisory lock), pemanggil kedua menerima run yang sama. Run dibuat dan hasilnya ditulis dalam satu transaksi; gagal → rollback penuh, retry boleh. [FX RUN-TWICE, PARALLEL, ROLLBACK]
- Proses sinkron. [ASM]
- **Implementasi (Phase 03):** `pg_advisory_xact_lock(hashtextextended(key))` di awal transaksi + cek ulang identitas; request identik berikutnya menunggu lalu menerima run yang sama (200 `created:false`). Run, hasil, item, canonical, dan audit `RECONCILIATION_RUN_COMPLETED` ditulis dalam satu transaksi. Run baru 201.

### 2.4 Matching & klasifikasi
- Kunci grup: `organization + unit + account + currency + trim(reference)`. Referensi sama di organisasi berbeda adalah grup berbeda. [FX]
- One-to-one. Prioritas klasifikasi per grup: **duplicate → missing → amount → date → matched**:

| Kondisi grup | Status | Reason |
|---|---|---|
| >1 baris di salah satu sisi | Mismatched | DUPLICATE_REFERENCE (semua ID disertakan, tidak dipasangkan) |
| hanya eksternal | Missing in Internal | NO_INTERNAL |
| hanya internal | Missing in External | NO_EXTERNAL |
| 1:1, nominal beda > toleransi | Mismatched | AMOUNT_DIFFERENCE |
| 1:1, tanggal di luar toleransi | Mismatched | DATE_OUTSIDE_TOLERANCE |
| 1:1, memenuhi semua | Matched | null |

- Satu grup = satu baris hasil, sehingga jumlah grup ≠ jumlah baris transaksi. [FX]

### 2.5 Ringkasan analitik (real-time)
Dihitung saat request dari hasil tersimpan (tanpa cache), difilter scope actor. [PDF, ASM]
- `matchedRatio = matched groups / all groups` (BR-A: 2/7 → 28.57%). Run tanpa grup → null.
- `anomalousInternalTotal` = Σ amount internal di grup non-Matched (BR-A 7.900.000).
- `anomalousExternalTotal` = Σ amount eksternal di grup non-Matched (BR-A 6.400.000).
- `uniquePairAmountDifferenceTotal` = Σ |internal − eksternal| hanya untuk grup Mismatched 1:1 (BR-A 100.000); missing & duplicate tidak dihitung.
- Ketiga angka anomali ditampilkan terpisah, **tidak** dijumlahkan sebagai "kerugian". [FX]
- Hitungan per status & per reason.

### 2.6 Run canonical untuk analitik
- Setiap transaksi internal memiliki paling banyak satu hasil rekonsiliasi canonical (`canonical_reconciliations`, PK = internal transaction). [ASM]
- Run yang **baru dibuat** dan selesai otomatis menjadi canonical untuk transaksi internal di dalamnya, dalam transaksi yang sama (pergantian atomik). Run yang dikembalikan secara idempoten tidak mengubah canonical.
- Pergantian hanya boleh menggantikan canonical milik run dengan pasangan dataset yang sama (mis. v1 → v2). Bila transaksi sudah canonical di run dengan pasangan dataset lain → **409** `CANONICAL_OVERLAP`. [ASM]
- Hasil v1 dan v2 tidak pernah dijumlahkan. Setelah v2, verified revenue BR-A = 17.000.000. [FX RULE-V2]
- **Implementasi (Phase 03):** konflik overlap → 409 `CANONICAL_OVERLAP` dan **seluruh run dibatalkan** (tidak ada run/hasil tersimpan), dengan `details.conflictingRunIds`. Run lama tetap bisa dibaca; ringkasannya menandai `isCanonical: false`. Service `RevenueService.verifiedByUnit/recordedByUnit` menghitung revenue dari canonical untuk Phase 04 (unitIds wajib dari scope).

## 3. Performa & revenue per employee (Modul A)
### 3.1 Revenue
- **Verified revenue** (unit, periode) = Σ amount transaksi internal REVENUE berstatus Matched pada hasil canonical, dengan `transaction_date` dalam periode, unit dalam subtree scope. Metrik operasional, **bukan** pengakuan revenue akuntansi. [ARCH, ASM]
- **Recorded revenue** = Σ amount transaksi internal (identitas unik) di unit/periode, terlepas status rekonsiliasi; ditampilkan terpisah (BR-A 22.900.000). [ASM]
- Revenue unit bukan klaim kontribusi individual. [ASM]

### 3.2 Headcount & RPE
- Hanya penempatan primer; per karyawan penempatan primer tidak boleh overlap (exclusion constraint). [ARCH]
- `employee_days(unit subtree, periode)` = Σ hari irisan penempatan dengan periode. `average_headcount = employee_days / jumlah hari kalender periode` (September = 30). [FX]
- `RPE = verified_revenue / average_headcount`; headcount 0 → `null` (UI "N/A"). [FX BR-ZERO]
- Agregasi induk (divisi/organisasi) = total verified revenue subtree / total headcount subtree, **bukan** rata-rata RPE cabang. DIV-1 = 21.000.000 / 3,5 = 6.000.000. [FX]

| Scope | Verified revenue | Avg headcount | RPE |
|---|---:|---:|---:|
| BR-A | 15.000.000 | 2 | 7.500.000 |
| BR-B | 6.000.000 | 1,5 | 4.000.000 |
| BR-ZERO | 0 | 0 | null |
| DIV-1 | 21.000.000 | 3,5 | 6.000.000 |

### 3.3 KPI & skor review
- KPI higher-is-better. `target > 0` (else 400 VALIDATION_ERROR), `actual ≥ 0`, `0 < weight ≤ 100`. [FX KPI-ZERO, KPI-NEGATIVE]
- Sumber actual: `VERIFIED_UNIT_REVENUE` (wajib `unitId`, actual = verified revenue unit tersebut pada periode) atau `MANUAL` (actual tervalidasi disimpan). [FX]
- `achievement = actual / target × 100`; `capped = min(achievement, 120)`; `weighted = capped × weight / 100`; `score = Σ weighted`. [FX KPI-CAP]
- EMP-1: KPI-1 75% × 60% = 45; KPI-2 100% × 40% = 40; total **85**. [FX]
- Siklus review: `DRAFT` (calculate boleh diulang) → `FINALIZED` (immutable). Finalisasi mensyaratkan Σ bobot = 100 tepat dan semua KPI MANUAL punya actual; jika tidak → **409** `FINALIZE_REJECTED` (reason `WEIGHT_TOTAL_NOT_100` / `MISSING_ACTUAL`). Operasi pada review FINALIZED → 409. [FX BAD-WEIGHTS]
- Revenue KPI tanpa data canonical → actual 0 dengan flag `revenueSource=NO_CANONICAL_RUN` agar terlihat di UI. [ASM]
- Snapshot final menyimpan: formula version (`kpi-v1`), actual, achievement, weighted, total, waktu, actor, provenance (run ID canonical yang dipakai). Transaksi/run baru tidak mengubah snapshot final; analitik live boleh berubah. [FX SNAPSHOT]

### 3.4 Analitik talenta (distribusi & kesenjangan)
- **Distribusi talenta**: jumlah review FINALIZED per unit per bucket skor: `<60`, `60–<80`, `80–<100`, `≥100`; plus rata-rata & median skor. [PDF, ASM]
- **Kesenjangan produktivitas**: per cabang dalam scope: RPE, selisih terhadap RPE induk, indeks `RPE cabang / RPE induk`, serta RPE tertinggi−terendah. Cabang RPE null dikecualikan dari min/max dan ditandai. [PDF, ASM]

### 3.5 Implementasi (Phase 04)
- **Revenue**: `verified` = transaksi internal REVENUE yang MATCHED pada hasil canonical, `transaction_date` dalam `[start, end_exclusive)` periode, unit dalam kelompok yang diminta. Organisasi dijamin FK komposit unit↔organisasi; ORG-2 tidak pernah masuk ORG-1. Seluruh kelompok dihitung dalam **satu statement SQL** (`RevenueService.verifiedForGroups`) sehingga pergantian canonical v1→v2 terbaca utuh, tidak campuran. `recorded` = seluruh transaksi internal REVENUE di periode.
- **Unit rumah karyawan per periode** = penempatan primer terakhir (tanggal mulai paling akhir) yang beririsan dengan periode. EMP-3 (BR-A s.d. 16 Sep, lalu BR-B) → BR-B untuk September. Review & KPI di-scope berdasarkan unit ini, **bukan** riwayat penempatan: D-21 (karyawan terlihat di master bila pernah di unit dalam scope) tidak memberi izin membaca review.
- Review menyimpan `unit_id` (unit rumah). Draf mengikuti unit rumah terkini; review final memakai unit saat finalisasi.
- **KPI revenue** wajib menunjuk unit rumah karyawan atau turunannya dan dalam scope HR (400 `KPI_UNIT_OUT_OF_RANGE`); actual dihitung dari revenue terverifikasi **unit + turunannya** dan tidak bisa diisi manual. KPI manual tanpa unit.
- Validasi input (400 `VALIDATION_ERROR`): string desimal; target > 0 (maks. 4 desimal); actual ≥ 0 (maks. 4 desimal, boleh kosong sampai finalisasi); bobot (0, 100] maks. 2 desimal. Total bobot boleh ≠ 100 saat menyusun; finalisasi mensyaratkan tepat 100.
- **Preview** (`POST /reviews/calculate`) membuat baris review DRAFT bila belum ada (tanpa skor tersimpan) dan menghitung langsung dari KPI & revenue saat ini; review FINAL selalu mengembalikan snapshot.
- **Finalisasi** dalam satu transaksi READ COMMITTED: `SELECT … FOR UPDATE` baris review → tolak bila FINAL (409 `REVIEW_ALREADY_FINALIZED`) → `FOR UPDATE` baris KPI → validasi (409 `FINALIZE_REJECTED`, `details.problems`: `NO_KPI`, `WEIGHT_TOTAL_NOT_100`, `MISSING_ACTUAL`) → revenue satu statement → simpan item snapshot (bobot, target, actual, capaian, capaian ber-cap, skor tertimbang, unit sumber), skor total, `formula_version = kpi-v1`, provenance (periode, revenue per KPI, ID run canonical & versi aturannya), audit `REVIEW_FINALIZED`. Unique `(employee, period)` + CHECK `FINAL ⇔ total_score NOT NULL`.
- Perubahan KPI (`POST/PATCH /kpi-assignments`) mengunci baris review yang sama terlebih dulu (urutan kunci sama dengan finalisasi); setelah FINAL → 409 `REVIEW_FINALIZED`.
- **Agregat & benchmark**: `subtotal` unit = unit + seluruh turunan, hanya bila **seluruh** turunan dalam scope pembaca; selain itu `null` + `PARTIAL_SCOPE`. Benchmark induk hanya bila subtotal induk tersedia bagi pembaca; selain itu `null` + `PARENT_OUT_OF_SCOPE`, dan `parentId` tidak diungkap. Total organisasi hanya untuk grant seluruh organisasi. Agregat parsial tidak pernah disebut total divisi.
- RPE dihitung `revenue × hari periode / employee-days` (setara revenue / avg headcount, tanpa pembagian berulang). Indeks gap = RPE cabang / RPE induk; selisih = RPE cabang − RPE induk.
- **Band skor** (distribusi review FINAL, unit = unit review): `< 60`, `60 – < 80`, `80 – < 100`, `≥ 100` (≥100 hanya mungkin karena cap 120%). Ringkasan: jumlah, rata-rata, median — label UI "dalam cakupan Anda", bukan total organisasi.

### 3.6 Akses sumber KPI (default-deny, perbaikan setelah review Phase 04)
Izin melihat/mengelola review **tidak** otomatis memberi akses ke seluruh subtree unit. Untuk setiap operasi review, server menghitung scope dari grant actor untuk permission yang relevan (`analytics.performance.read` untuk baca/agregat, `review.manage` untuk preview, finalisasi, dan perubahan KPI) dan mensyaratkan:
1. unit rumah review ada dalam scope; **dan**
2. **seluruh** unit sumber revenue KPI ada dalam scope:
   - DRAFT/preview: unit KPI revenue **beserta seluruh turunannya** (cara actual dihitung);
   - FINAL: daftar unit yang benar-benar dijumlahkan, sesuai `provenance.revenueSources[].unitIds` snapshot.

Bila tidak terpenuhi: detail, preview, finalisasi, dan perubahan/penambahan KPI → **404** (sama dengan resource di luar scope); list → karyawan **dikecualikan seluruhnya**; distribusi skor → review **tidak dihitung** (jumlah, band, rata-rata, median). Tidak ada actual, target, kontribusi skor, total, atau provenance parsial yang dikirim, dan angka tidak pernah diganti dengan subtotal parsial. Membuat KPI revenue mensyaratkan seluruh subtree unit KPI dalam scope `review.manage`. Grant dengan `include_descendants=false` hanya mencakup unit itu sendiri. Scope selalu berasal dari grant di server (role terikat scope), tidak dari `unitId` kiriman frontend. Analitik RPE sudah mengikuti aturan setara: subtotal hanya bila seluruh subtree dalam scope (`PARTIAL_SCOPE`).

Implementasi: `ReviewAccessPolicy` (backend/src/modules/performance/review-access.policy.ts), dipakai `ReviewsService` & `PerformanceAnalyticsService`; finalisasi mengecek ulang setelah baris KPI terkunci.

## 4. Workflow approval & audit (Modul C)
### 4.1 Workflow
- Definisi demo `WF-BUDGET` v1: step 1 MANAGER (selalu), step 2 FINANCE bila `amount > 10.000.000`. REQ-BOUNDARY (10.000.000) → 1 step. [FX]
- Saat submit, step yang berlaku disnapshot ke `approval_steps` dengan ID eksplisit (workflow version + role + order). Perubahan definisi tidak memengaruhi request yang sudah disubmit. [FX]
- State request: `DRAFT → PENDING → APPROVED | REJECTED`. Step: `WAITING → ACTIVE → APPROVED | REJECTED`; reject di step mana pun → request REJECTED. Approve step terakhir → APPROVED. [FX]
- Amount > 0, IDR. Requester = user dengan grant REQUESTER yang mencakup unit request.

### 4.2 Keputusan
- Approver eligible step = user aktif dengan grant role step yang mencakup unit request, bukan requester. Setelah delegasi, **hanya** assignee step yang boleh bertindak. [FX]
- Self-approval dilarang → 403. [FX SELF]
- Urutan dalam satu transaksi DB: lock `approval_requests` (`SELECT … FOR UPDATE`) → baca ulang state & step aktif → cek scope (404) → step bukan aktif/sudah diputus → 409 `STEP_NOT_ACTIVE` → cek eligibility/self (403) → insert keputusan → majukan state → insert audit → commit. Lock ordering: request lalu step. [ARCH, FX RACE, STALE-STEP]
- Unique partial index "satu keputusan terminal per step" sebagai lapis kedua. [ARCH]
- Race approve/approve atau approve/reject: tepat satu 200, satu 409; satu keputusan tersimpan. [FX RACE, RACE-REJECT]

### 4.3 Delegasi
- Hanya approver eligible (atau assignee saat ini) pada step ACTIVE yang boleh mendelegasikan.
- Target: user aktif, punya grant role step yang mencakup unit request, bukan requester, bukan diri sendiri; selain itu → 403 `INVALID_DELEGATE` (MANAGER-B → 403). [FX INVALID-DELEGATE]
- Delegasi tidak menambah grant dan bukan keputusan terminal; step tetap ACTIVE dengan `assignee = target`. [ARCH]

### 4.4 Audit
- Event: `CREATED, SUBMITTED, APPROVED, REJECTED, DELEGATED` (+ actor, step, waktu, payload ringkas, requestId). DELEGATE scenario wajib berurutan `SUBMITTED, DELEGATED, APPROVED`. [FX]
- Ditulis dalam transaksi yang sama dengan perubahan bisnis.
- Append-only: role DB runtime hanya `SELECT, INSERT` pada `audit_events`; trigger menolak UPDATE/DELETE sebagai lapis tambahan; migration memakai credential terpisah (owner). Runtime role bukan owner/superuser. DBA tetap berkuasa — dicatat sebagai batas. [FX AUDIT, ARCH]

### 4.5 Implementasi (Phase 05)
**Permission** (menggantikan `approval.read`/`audit.read` yang ambigu):
| Permission | Role | Arti |
|---|---|---|
| `approval.request.create` | REQUESTER | Membuat draf, mengubah draf, submit; membaca pengajuan **sendiri** (selama grant pengaju masih mencakup unitnya) |
| `approval.decide` | MANAGER, FINANCE | Inbox, approve, reject, delegasi — hanya pada langkah yang role-nya sama dengan grant actor dan scope grant role itu mencakup unit |
| `approval.oversight` | ADMIN | Izin **eksplisit** membaca semua pengajuan tersubmit + audit dalam scope; **tanpa** hak memutuskan |

**Visibilitas** (list, detail, audit, calon delegasi): pengaju sendiri; oversight (tersubmit); atau reviewer = pengajuan tersubmit yang memiliki langkah ber-role R dan scope grant R actor mencakup unitnya. Draf orang lain tidak pernah terlihat. Di luar visibilitas → 404 / tidak tampil. Inbox = PENDING dengan langkah ACTIVE yang bisa diputuskan actor (role+scope, bukan pengaju, belum didelegasikan ke orang lain).

**Workflow**: definisi aktif per organisasi & tipe `BUDGET` (unique "satu versi aktif"). Saat submit, langkah yang kondisinya terpenuhi disalin ke `approval_steps` dan seluruh definisi (versi, langkah, kondisi, `applies`) disimpan di `workflow_snapshot`; perubahan konfigurasi sesudahnya tidak memengaruhi pengajuan tersubmit. ≤ Rp10.000.000 → Manager; > Rp10.000.000 → Manager lalu Finance.

**State**: `DRAFT → PENDING → APPROVED | REJECTED`. Draf boleh diubah pengajunya (`PATCH`); setelah submit nominal/unit/alasan/judul terkunci (409 `REQUEST_NOT_DRAFT`). CHECK: DRAFT ⇔ belum ada `submitted_at`; tersubmit wajib snapshot; PENDING ⇔ ada `current_step_order`; status akhir ⇔ `decided_at`. Unique: satu langkah ACTIVE per pengajuan; satu keputusan terminal per langkah.

**Transaksi keputusan** (approve/reject/delegate, satu transaksi): `SELECT … FOR UPDATE` request → `FOR UPDATE` langkah (urutan request → langkah) → baca ulang → visibilitas (404) → stepId milik request (404) → request PENDING (409 `REQUEST_NOT_PENDING`) → langkah ACTIVE (409 `STEP_NOT_ACTIVE`: stepId lama atau langkah belum aktif) → kelayakan (403: `SELF_APPROVAL_FORBIDDEN`, `NOT_ASSIGNEE`, `NOT_ELIGIBLE`) → simpan action → majukan langkah / status akhir → audit → commit. Raw SQL berparameter. Submit memakai lock yang sama; submit paralel → 409 `REQUEST_ALREADY_SUBMITTED`.

**Delegasi**: hanya actor yang berhak bertindak sekarang; penerima harus aktif, punya grant role langkah yang scope-nya mencakup unit, bukan pengaju, bukan diri sendiri, bukan penerima saat ini (403 `INVALID_DELEGATE`). Langkah tetap ACTIVE dengan `assignee` = penerima; delegasi tidak menambah grant. Kelayakan penerima divalidasi ulang dari grant saat ia bertindak.

**Audit**: `CREATED`, `DRAFT_UPDATED` (before/after), `SUBMITTED`, `APPROVED`, `REJECTED`, `DELEGATED` — actor, request, langkah (id/urutan/role), status asal/tujuan, komentar, penerima delegasi, waktu, `traceId` (x-request-id); ditulis di transaksi yang sama. `app_runtime` bukan owner/superuser dan tidak bisa UPDATE/DELETE/TRUNCATE `audit_events` (privilege + trigger). Perlindungan ini **tidak** membatasi administrator database / owner.

## 5. Batas scope MVP
Satu mata uang (IDR), hanya REVENUE, rekonsiliasi sinkron ≤5000 baris, run hanya untuk pasangan dataset satu scope, workflow tanpa editor visual, UI sederhana, seed master dari fixture. Roadmap: worker async, notifikasi, integrasi bank API, export, visual workflow builder, koreksi transaksi berversi, refresh token.
