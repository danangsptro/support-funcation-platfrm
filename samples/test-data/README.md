# Test data - Support Function Platform
Semua identitas dan transaksi sintetis. Periode: September 2026, Asia/Jakarta.

## Pemakaian
1. Salin folder ini ke `samples/test-data/` di project.
2. Seed organizations, org-units (parent dahulu), users, access-grants, employees, employee-assignments.
3. Seed periode, KPI, workflow, dan requests. ID simbolis adalah external fixture keys: petakan ke UUID bila schema memakai UUID.
4. Import CSV reconciliation sesuai scope. File gabungan memuat ORG-1/BR-A, ORG-1/BR-B, ORG-2/BR-X. Pisahkan/filter sesuai scope akun. Jangan mengimpor lintas organisasi lewat akun biasa. File per scope tersedia di reconciliation/scoped/.
5. Jalankan rekonsiliasi v1 tiap scope, lalu bandingkan expected-results.json dan HR expected-results.json.
6. Jalankan skenario approval/security/idempotency melalui test runner aplikasi. Reset state tiap test independen.
7. File invalid dipakai satu per satu. Jangan masuk seed normal.

## Kontrak data
UTF-8, CSV comma delimiter, nominal desimal tanpa pemisah ribuan, tanggal ISO. Kosong = null hanya untuk field nullable. JSON money/weight memakai string desimal. Tanggal penempatan memakai interval [start_date, end_date_exclusive). Semua unit yang dirujuk wajib memiliki organisasi yang sesuai.
Nomor referensi sama boleh muncul di organisasi berbeda. Kunci pencocokan mencakup organization, unit, account, currency, reference. Transaksi hanya REVENUE positif untuk MVP.
Normalisasi fingerprint: trim referensi, tanggal ISO, nominal decimal canonical, urutkan baris; pertahankan multiplicity (jangan hapus duplikat). CSV transaksi immutable setelah import.
Referensi ganda menghasilkan satu grup Mismatched dengan seluruh ID terkait dan alasan DUPLICATE_REFERENCE. Jumlah grup berbeda dari jumlah baris.
Rasio sukses = matched groups / all result groups. Nominal anomali internal dan eksternal dihitung terpisah; jangan dijumlahkan sebagai kerugian. Selisih pasangan unik tidak memasukkan missing atau duplicate groups.

## Ekspektasi utama
BR-A: 2 Matched, 3 Mismatched, 1 Missing in Internal, 1 Missing in External. Revenue terverifikasi Rp15 juta; RPE Rp7,5 juta; skor EMP-1 = 85.
BR-B: revenue Rp6 juta; headcount 1,5; RPE Rp4 juta. Divisi: Rp21 juta / 3,5 = Rp6 juta.
ORG-2 tidak masuk agregat ORG-1. BR-ZERO menghasilkan RPE null/N/A.
KPI cap 120%, target > 0, bobot finalisasi tepat 100%. Gunakan Decimal dan pembulatan HALF_UP hanya di output.

## Auth dan workflow
Email example.test adalah dummy. Password tidak disimpan: seed mengambil DEMO_PASSWORD dari environment lalu hash. REQUESTER adalah permission tambahan untuk pengajuan; sesuaikan enum role implementasi.
Setelah submit, step 1 dapat diproses manager dalam scope; setelah delegasi hanya penerima delegasi yang bertindak pada step tersebut. Workflow dan step IDs disnapshot. Akun MANAGER-A2 memungkinkan pengujian concurrency/delegation.

## Batas paket
Ini fixture dan expected outcomes, bukan implementasi backend atau test suite aplikasi. HTTP 200/400/403/404/409 adalah kontrak yang diusulkan. Sesuaikan adapter jika implementasi memakai 201 untuk create, tanpa mengubah invariant bisnis.
Skenario parallel memerlukan dua koneksi PostgreSQL nyata dan sinkronisasi start. Fixture tidak membuktikan locking aplikasi. Runtime DB role harus bukan owner/superuser untuk uji immutable audit.
Run `python3 validate_fixtures.py` untuk cek konsistensi angka dan referensi lokal.
