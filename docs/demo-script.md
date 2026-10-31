# Demo script — Support Function Platform

Durasi ±15 menit dalam sesi 45 menit (sisanya presentasi & code defense). Semua langkah lewat UI. Angka expected berasal dari fixture `samples/test-data/` dan diverifikasi otomatis oleh integration test & E2E ([test-report.md](test-report.md)).

> **Pakai stack gladi terpisah.** Finalisasi review dan keputusan approval **tidak bisa dibatalkan**. Jangan memakai database demo harian untuk gladi; skrip ini tidak mengisi database apa pun secara otomatis.

## 0. Persiapan (±5 menit sebelum sesi)

### Stack gladi
```bash
# dari root repo, .env sudah terisi (README langkah 1)
DB_HOST_PORT=5437 API_HOST_PORT=3007 WEB_HOST_PORT=8097 docker compose -p sfp-gladi up -d --build --wait
docker compose -p sfp-gladi ps          # db/api/web healthy, migrate Exited (0)
```
Buka **http://localhost:8097**. Semua akun memakai password `DEMO_PASSWORD` dari `.env`; panel **Akun demo untuk presentasi** di halaman login mengisi email sekali klik. Siapkan dua jendela browser (biasa + private) untuk dua akun bersamaan.

Kondisi awal stack gladi (hasil seed): 5 draf pengajuan milik `employee-a` (REQ-LOW, REQ-BOUNDARY, REQ-HIGH, REQ-RACE, REQ-DELEGATE), belum ada rekonsiliasi, belum ada review final.

Selesai demo: `docker compose -p sfp-gladi down -v` (hanya menghapus volume project `sfp-gladi`).

### Akun
| Akun | Peran | Dipakai untuk |
|---|---|---|
| `finance@example.test` | FINANCE (Divisi 1) | Import & rekonsiliasi, approver langkah 2 |
| `hr@example.test` | HR (Divisi 1) | KPI, review, finalisasi, RPE |
| `employee-a@example.test` | REQUESTER (BR-A) | Mengajukan anggaran |
| `manager-a@example.test` | MANAGER (BR-A) | Approver langkah 1 |
| `manager-a2@example.test` | MANAGER (BR-A) | Approver kedua (konflik 409, delegasi) |
| `manager-b@example.test` | MANAGER (BR-B) | Bukti isolasi antar-cabang |
| `admin@example.test` | ADMIN | Pengawasan (baca saja) |

### Fixture
| File | Untuk |
|---|---|
| `samples/test-data/reconciliation/scoped/ORG-1-BR-A-internal.csv` (7 baris) / `…-external.csv` (6 baris) | Rekonsiliasi BR-A |
| `samples/test-data/reconciliation/scoped/ORG-1-BR-B-internal.csv` / `…-external.csv` | Rekonsiliasi BR-B (agar RPE BR-B terisi) |
| `samples/test-data/invalid/BAD-3.csv` | Contoh file salah |
| Seed approval `REQ-HIGH`, `REQ-RACE`, `REQ-DELEGATE` | Alur approval |

## 1. Finance — rekonsiliasi & retry idempoten (±4 menit)
| # | Langkah | Expected result |
|---|---|---|
| 1.1 | Login `finance@example.test` → **Rekonsiliasi** (sidebar) | Tab "Rekonsiliasi baru", alur 3 langkah |
| 1.2 | Cabang **BR-A**, akun `ACC-1`; unggah internal BR-A lalu eksternal BR-A | "7 transaksi siap", "6 transaksi siap"; toleransi **Standar (±1 hari)** terpilih |
| 1.3 | **Cocokkan sekarang** | "Pencocokan selesai"; **28,57%** · "2 dari 7 grup referensi cocok"; revenue terverifikasi **Rp15.000.000,00** |
| 1.4 | Di "Yang perlu ditindaklanjuti" → baris **Nomor referensi ganda** → **Tampilkan 1 transaksi ↓** | Halaman bergulir ke tabel; hanya **REF-007**; chip "Hanya: Referensi ganda — tinjau manual" |
| 1.5 | **Retry idempoten**: tab Rekonsiliasi baru → ulangi 1.2–1.3 dengan file yang sama | Pesan "sudah pernah dicocokkan — hasil sebelumnya ditampilkan, tidak ada hasil ganda"; jumlah di "Riwayat & hasil" tidak bertambah |
| 1.6 | Ulangi untuk **BR-B** (`ORG-1-BR-B-*.csv`) | Run BR-B muncul; chip **Cabang** di riwayat (Semua · BR-A · BR-B) memfilter di server |
| 1.7 | (opsional) Unggah `invalid/BAD-3.csv` | Alert "Tidak ada data yang disimpan" + "Baris 2 (BAD-3)" |

Alternatif cepat untuk 1.2–1.6 di stack gladi: `node scripts/prepare-demo-recon.mjs http://localhost:8097` (idempoten; langkah 1.5 tetap bisa didemokan lewat UI).

## 2. HR — RPE & snapshot review (±3 menit)
Prasyarat: run BR-A dan BR-B (langkah 1).

| # | Langkah | Expected result |
|---|---|---|
| 2.1 | Login `hr@example.test` → **Performa** → Periode **PERIOD-SEP · 1 Sep 2026 – 30 Sep 2026** | Tab Analitik |
| 2.2 | Lihat RPE | BR-A **Rp7,5 jt** (15 jt ÷ 2), BR-B **Rp4 jt** (6 jt ÷ 1,5 — EMP-3 pindah 16 Sep), BR-ZERO **N/A**, benchmark DIV-1 **Rp6 jt** |
| 2.3 | Tab **Review karyawan** → **Karyawan Demo 1** | Skor sementara **85,00** (Revenue cabang 75% × 60 = 45,00 + Pekerjaan selesai 40,00) |
| 2.4 | **Finalisasi review** → **Ya, finalisasi** | "Skor final"; "Revenue BR-A: Rp15.000.000,00 dari pencocokan v1"; baris berstatus **Final** |
| 2.5 | **Snapshot tidak berubah**: refresh (F5) | URL `?tab=review…` bertahan; skor final & sumber revenue sama |

## 3. Approval dua langkah, konflik, delegasi, audit (±4 menit)
| # | Langkah | Expected result |
|---|---|---|
| 3.1 | Login `employee-a@example.test` → **Persetujuan** → draf **REQ-HIGH** (Rp15 jt) | Status Draf; jalur 1. Manager → 2. Finance |
| 3.2 | **Ajukan** → **Ya, ajukan** | "Menunggu keputusan dari Manager BR-A" |
| 3.3 | Jendela lain: `manager-a@example.test` → tab **Perlu tindakan saya** → REQ-HIGH → **Setujui** → **Ya, setujui** | "Langkah disetujui."; menunggu **Finance BR-A** |
| 3.4 | `finance@example.test` → Persetujuan → REQ-HIGH → **Setujui** | Status **Disetujui** |
| 3.5 | Kembali sebagai `employee-a` → kartu status **Disetujui** → REQ-HIGH | Jejak audit: Diajukan → Disetujui (langkah 1) → Disetujui (langkah 2), aktor & waktu |
| 3.6 | **Konflik**: `employee-a` ajukan **REQ-RACE**; buka REQ-RACE di jendela `manager-a` dan `manager-a2`; keduanya klik **Setujui** hampir bersamaan | Satu berhasil; yang lain melihat "Status terbaru sudah dimuat ulang" (409), tombol hilang, tidak ada keputusan ganda |
| 3.7 | **Delegasi**: `employee-a` ajukan **REQ-DELEGATE**; `manager-a` → **Delegasikan** ke Manager A (2) | Hilang dari inbox A, muncul di inbox A2; audit "Didelegasikan" |
| 3.8 | `admin@example.test` → Persetujuan | "Semua pengajuan" tanpa tombol Setujui/Tolak (pengawasan) |

## 4. Akses antar-cabang (±2 menit)
| # | Langkah | Expected result |
|---|---|---|
| 4.1 | Login `manager-b@example.test` → Organisasi, Rekonsiliasi, Performa, Persetujuan | Hanya BR-B; tidak ada data BR-A; benchmark divisi tidak ditampilkan |
| 4.2 | Salin URL detail REQ-HIGH dari jendela Manager A (`/approvals?tab=all&id=…`) → buka di jendela Manager B | "Pengajuan tidak ditemukan dalam akses Anda."; tanpa tombol keputusan |
| 4.3 | Salin URL hasil run BR-A (`/reconciliation?tab=hasil&run=…`) → buka sebagai Manager B | "Hasil pencocokan dari tautan tidak ditemukan dalam akses Anda." |
| 4.4 | (DevTools/curl) `GET /api/v1/approval-requests/<id REQ-HIGH>` dengan cookie Manager B | **404**; `GET /api/v1/reconciliation-runs/<id run BR-A>` → **404** |

## 5. Sesi & ketahanan (±1 menit)
| # | Langkah | Expected result |
|---|---|---|
| 5.1 | Buka tautan langsung (mis. `/reconciliation?tab=hasil`) saat belum login | Ke login, lalu kembali ke tautan tadi setelah masuk |
| 5.2 | Menu akun → **Keluar** | Ke login; cookie sesi dihapus server |
| 5.3 | `docker compose -p sfp-gladi restart api web` lalu refresh | Run, review final, approval, dan audit tetap (dibaca dari PostgreSQL) |

## 6. Reset aman
- **Stack gladi**: `docker compose -p sfp-gladi down -v` lalu ulangi §0. Hanya volume project `sfp-gladi` yang terhapus.
- **Verifikasi otomatis** tanpa demo manual: `pnpm test:e2e` (project `sfp-e2e`, dihapus otomatis).
- **Stack demo harian** (`support-function-platform`): jangan di-reset untuk gladi. Menyiapkan data BR-A/BR-B tanpa menghapus apa pun: `node scripts/prepare-demo-recon.mjs` (idempoten). `docker compose down -v` tanpa `-p` menghapus seluruh data demo — hanya bila memang diinginkan.

## Batasan yang disampaikan saat demo
- Scope diterapkan di query aplikasi (bukan PostgreSQL RLS).
- Audit append-only membatasi role aplikasi `app_runtime`, bukan owner/administrator database.
- Rekonsiliasi & import sinkron (≤ 1 MiB / 5.000 baris).
- Satu kejadian request form approval menggantung di E2E Phase 05 belum terjelaskan; dimitigasi timeout 10 dtk + "Coba lagi" dan kini terlacak lewat log akses.
