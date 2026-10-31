# Product memo — Support Function Platform

Status: **final (Phase 07)**. Klaim di memo ini hanya untuk perilaku yang sudah diuji ([docs/test-report.md](docs/test-report.md)). Aturan lengkap: [docs/business-rules.md](docs/business-rules.md). Nomor keputusan D-xx merujuk catatan pengembangan internal yang tidak disertakan di repository; isi keputusannya sudah tertuang di dokumen ini dan di business-rules.

## 1. Masalah bisnis dan pengguna
Fungsi pendukung (HR, Finance, Manager cabang) bekerja dengan data yang sama — cabang, karyawan, transaksi — tetapi di alat terpisah. Akibatnya: produktivitas karyawan diukur dari revenue yang belum dicocokkan, selisih bank ditemukan terlambat, dan persetujuan anggaran rawan keputusan ganda serta akses data lintas cabang.

| Pengguna | Kebutuhan | Yang disediakan |
|---|---|---|
| Finance | Mencocokkan catatan internal dengan mutasi bank dan tahu apa yang harus ditindaklanjuti | Import tervalidasi per cabang/akun, matching deterministik, ringkasan anomali dengan panduan, aman diulang |
| HR | Menilai karyawan terhadap revenue yang nyata | KPI berbobot, KPI revenue dari revenue terverifikasi, finalisasi snapshot, RPE & distribusi skor |
| Manager cabang | Memutuskan anggaran cabangnya dan melihat data cabangnya saja | Inbox persetujuan, keputusan aman dari race, delegasi, ringkasan cabang |
| Pengaju | Mengajukan anggaran dan tahu statusnya | Form dengan pratinjau jalur persetujuan, riwayat & jejak audit |
| Admin organisasi | Tata kelola | Pengawasan approval (baca saja), master unit, audit |

Benang merah: **RPE hanya bermakna bila revenue-nya sudah direkonsiliasi.** Modul Performa memakai revenue terverifikasi dari Modul Rekonsiliasi, bukan angka mentah.

## 2. Scope MVP dan asumsi
**Dalam scope**: tiga modul wajib (A Talent & Performance, B Financial Reconciliation, C Approval & Access) lewat UI dan API; satu model akses (peran + cakupan unit hierarki); audit; Docker Compose satu perintah; fixture September 2026.

**Asumsi** (perlu konfirmasi stakeholder sebelum produksi):
1. Hanya IDR dan transaksi REVENUE positif; periode bulanan zona Asia/Jakarta, tanggal akhir eksklusif.
2. KPI higher-is-better, capaian dibatasi 120%, total bobot tepat 100% saat finalisasi (boleh ≠ 100 saat menyusun).
3. Unit rumah karyawan pindahan = penempatan primer terakhir yang beririsan dengan periode (lihat §4).
4. Workflow anggaran demo: ≤ Rp10 juta → Manager; > Rp10 juta → Manager lalu Finance (dari tabel konfigurasi). Nominal tepat Rp10.000.000 cukup satu langkah.
5. Fixture tidak menghubungkan user ke employee; larangan self-approval dicek per user (pengaju = pemutus).

**Di luar scope** (roadmap §9): integrasi API bank, notifikasi, editor workflow, multi-mata uang, SSO.

## 3. Revenue terverifikasi — definisi dan batas makna
**Definisi**: jumlah nominal transaksi **internal** REVENUE yang berstatus **Matched** pada **run canonical** untuk transaksi tersebut, dengan tanggal dalam periode, per unit (dan turunannya bila diminta).

- *Canonical* = run terbaru yang mencakup transaksi itu. Mengganti aturan (v1 → v2) tidak menjumlahkan keduanya: fixture RULE-V2 menghasilkan 17 jt, bukan v1 + v2.
- *Revenue tercatat* (semua transaksi internal) ditampilkan berdampingan agar terlihat berapa yang belum terverifikasi.

**Batas makna**: ini metrik operasional "uangnya terlihat di kedua sisi", **bukan** pengakuan pendapatan akuntansi (tanpa akrual, retur, pajak, atau tutup buku). Transaksi Mismatched/Missing tidak dihitung sampai dicocokkan ulang. Total anomali internal, eksternal, dan selisih pasangan ditampilkan terpisah dan **tidak** dijumlahkan sebagai kerugian.

## 4. KPI, RPE, dan karyawan pindahan
- **Skor KPI** = Σ (min(aktual ÷ target, 120%) × bobot). KPI revenue mengambil aktual dari revenue terverifikasi unit rumah + turunannya. Contoh fixture EMP-1 (BR-A): revenue 15 jt terhadap target 20 jt → 75% × bobot 60 = **45**; KPI "pekerjaan selesai" 10/10 → 100% × 40 = **40**; total **85,00**.
- **Finalisasi** menyimpan snapshot: skor, setiap item, dan provenance (run canonical + unit sumber). Transaksi atau run baru tidak mengubah skor final.
- **RPE** = revenue terverifikasi ÷ rata-rata karyawan, dengan rata-rata = employee-days ÷ hari periode. Agregat divisi = total revenue ÷ total rata-rata karyawan (bukan rata-rata RPE cabang). Contoh September: BR-A 15 jt ÷ 2 = **Rp7,5 jt**; BR-B 6 jt ÷ 1,5 = **Rp4 jt** (EMP-3 pindah ke BR-B 16 Sep → dihitung proporsional); BR-ZERO tanpa karyawan = **N/A**; DIV-1 21 jt ÷ 3,5 = **Rp6 jt**.
- **Karyawan pindahan**: headcount RPE proporsional per hari di setiap cabang; **review** dinilai oleh unit rumah = penempatan terakhir di periode (EMP-3 → BR-B), sehingga Manager BR-A tidak melihat review EMP-3. Ini asumsi MVP; alternatif: unit dengan hari terbanyak, atau review per penempatan.
- Revenue unit adalah sasaran bersama, bukan klaim kontribusi individu. Band skor (< 60, 60–< 80, 80–< 100, ≥ 100) hanya alat baca distribusi, bukan keputusan kompensasi.

## 5. Rekonsiliasi: matching, idempotensi, canonical run
- **Matching** satu-ke-satu dalam organisasi + unit + akun + mata uang + referensi. v1: nominal sama persis, tanggal ±1 hari (inklusif); v2: ±2 hari. Hasil: Matched / Mismatched (nominal atau tanggal berbeda) / Missing in Internal / Missing in External. Referensi ganda **tidak** ditebak pasangannya — ditandai untuk tinjau manual. Fixture BR-A v1: 2 dari 7 grup cocok = **28,57%**.
- **Import**: satu file = satu unit + akun + sisi; seluruh file divalidasi dulu, satu baris salah → tidak ada yang disimpan, dengan daftar baris dan kode error.
- **Idempotensi**: transaksi disimpan sekali per identitas sumber (org, sisi, akun, ID transaksi) + hash isi; dataset per fingerprint. Import ulang file yang sama → dataset yang sama; transaksi ber-ID sama dengan isi berbeda → 409. Run dengan dataset + aturan yang sama → run lama dikembalikan ("sudah pernah dicocokkan"), juga saat dikirim paralel (advisory lock + unique).
- **Canonical**: run baru menjadi canonical secara atomik; dataset yang tumpang tindih dengan pasangan lain ditolak 409 agar revenue tidak terhitung dua kali.

## 6. Approval: locking dan delegasi
- Submit menyimpan **snapshot workflow** (langkah sesuai nominal). Status: DRAFT → PENDING → APPROVED/REJECTED; nominal/unit/alasan terkunci setelah submit.
- Setiap keputusan berjalan dalam **satu transaksi**: kunci baris request lalu langkah (`FOR UPDATE`), baca ulang state, validasi aktor (bukan pengaju, peran & cakupan langkah, penerima delegasi), simpan aksi, majukan langkah, tulis audit, commit. Dua keputusan bersamaan → satu berhasil, yang lain 409 dan UI memuat ulang status. Unique "satu langkah aktif" dan "satu keputusan terminal per langkah" menjadi jaring kedua.
- **Delegasi** mengganti penerima langkah aktif kepada pengguna aktif dengan peran & cakupan yang sama; tidak menambah grant; dicek ulang saat penerima bertindak. Tanpa eskalasi/batas waktu (MVP).
- Admin hanya mengawasi (baca), tidak memutuskan — pemisahan tugas.

## 7. Permission dan data scoping
- Permission per peran (mis. `reconciliation.run` Finance, `review.manage` HR, `approval.decide` Manager/Finance, `approval.oversight` Admin). Default-deny: tanpa permission → 403.
- **Scope** dihitung server dari grant (unit + turunan bila `include_descendants`, atau seluruh organisasi) dan diterapkan **di query aplikasi** — PostgreSQL RLS tidak dipakai. Data di luar cakupan → 404 (keberadaannya tidak dibocorkan), sama untuk list, detail, mutasi, dan agregat. Agregat divisi/benchmark hanya muncul bila seluruh subtree dalam cakupan.
- Review: pembaca harus berwenang atas unit rumah **dan seluruh** unit sumber revenue KPI.
- Sesi: cookie httpOnly `SameSite=Strict` + header CSRF; peran & grant dibaca ulang dari DB setiap request sehingga pencabutan akses langsung berlaku.

## 8. Kemudahan pakai
- Dashboard bersidebar (drawer di HP); menu hanya berisi modul yang boleh diakses; beranda menjelaskan "Akses Anda" dalam kalimat biasa.
- Finance: alur 3 langkah, error import per baris, panduan tindak lanjut per jenis anomali dengan tombol yang memfilter tabel.
- HR: skor sementara seketika, pesan bobot yang jelas, finalisasi dengan konfirmasi, snapshot menampilkan sumber revenue.
- Approval: pratinjau jalur di form, kartu status berjumlah, "Menunggu keputusan dari …", konflik 409 dijelaskan lalu status dimuat ulang.
- Semua daftar: loading, kosong, error + "Coba lagi", paginasi; nominal format Rupiah (HALF_UP); URL menyimpan tab/filter sehingga refresh & tautan langsung bekerja. Desktop 1280px dan HP 390px diuji untuk Rekonsiliasi, Performa, Persetujuan, Organisasi, dan Beranda.

## 9. Trade-off, keterbatasan yang diterima, roadmap
| Keputusan | Alasan | Konsekuensi yang diterima |
|---|---|---|
| Modular monolith NestJS + satu PostgreSQL | Transaksi ACID lintas modul sederhana; cepat dibangun | Skala per modul tidak independen |
| Scope di query aplikasi (bukan RLS) | Satu tempat logika, mudah diuji end-to-end | Keamanan baris bergantung pada disiplin `ScopeService` di setiap query (dijaga test isolasi) |
| Lock baris + unique constraint untuk approval | Dua lapis pengaman | Keputusan per pengajuan diserialkan (wajar untuk volume approval) |
| Run & import sinkron, CSV ≤ 1 MiB / 5.000 baris di memori | Mudah diuji, cukup untuk MVP | File besar perlu worker async |
| Overlap canonical ditolak total | Tidak ada double count | Koreksi data butuh versi dataset (roadmap) |
| Audit append-only lewat privilege + trigger | Aplikasi tidak bisa mengubah jejak | Owner/administrator database tetap bisa; perlu log eksternal/WORM bila diwajibkan |
| Cookie sesi JWT 1 jam tanpa revocation list | Sederhana, aman dari XSS | Token yang bocor berlaku sampai kedaluwarsa; rate limit login in-memory per instance |
| Unit rumah = penempatan terakhir | Deterministik | Perlu konfirmasi kebijakan HR |

**Keterbatasan lain yang diterima**: daftar dipaginasi server tetapi tanpa pencarian teks; delegasi tanpa eskalasi/SLA; kode error import `UNKNOWN_UNIT` vs `UNIT_ORG_MISMATCH` (mengikuti fixture) dapat menyiratkan keberadaan unit organisasi lain; satu kejadian `GET /approval-requests/options` menggantung di E2E Phase 05 belum terjelaskan (tidak tereproduksi; dimitigasi timeout + Coba lagi; kini terlacak lewat log akses).

**Roadmap**: worker async + antrean untuk import/run besar; versi dataset & koreksi transaksi; integrasi API bank; notifikasi & eskalasi delegasi; editor workflow; RLS PostgreSQL sebagai lapisan kedua; rate limit & pencabutan token terdistribusi (Redis), SSO; export laporan; multi-mata uang.
