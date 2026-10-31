# Kontrak API

> **Swagger / OpenAPI**: dokumentasi interaktif tersedia di `/api/v1/docs` (mis. http://localhost:8080/api/v1/docs) dan JSON OpenAPI 3 di `/api/v1/docs-json`. Skema DTO dihasilkan otomatis oleh plugin `@nestjs/swagger` saat `nest build` dari tipe TypeScript + dekorator class-validator. Untuk mencoba: `POST /api/v1/auth/login` → salin `accessToken` → tombol **Authorize** (skema *bearer*). Endpoint dokumentasi tidak butuh login; otorisasi API tetap di guard.

Prefix `/api/v1`. Semua endpoint wajib terautentikasi kecuali ditandai **publik**, lewat salah satu:
- **Browser:** cookie `sfp_session` (httpOnly, `SameSite=Strict`, `Path=/api`, `Secure` bila `COOKIE_SECURE=true`) yang dipasang saat login. Request selain GET/HEAD/OPTIONS wajib membawa header `X-Requested-With: sfp-web`, jika tidak → 403 `CSRF_CHECK_FAILED`.
- **Klien API/CLI:** header `Authorization: Bearer <token>` (tidak perlu header CSRF). Nominal uang berupa string desimal. Setiap respons membawa header `x-request-id`.

Error: `{ "code": string, "message": string, "requestId": string, "details"?: any }`.

| Status | Kode umum | Arti |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Input/query tidak valid; field tak dikenal ditolak. `details: [{ field, messages[] }]` |
| 401 | `UNAUTHENTICATED`, `INVALID_CREDENTIALS` | Token tidak ada/invalid/kedaluwarsa/akun nonaktif; login gagal |
| 403 | `FORBIDDEN`, `CSRF_CHECK_FAILED` | Tidak punya permission untuk tindakan ini di grant mana pun; header CSRF tidak ada pada request berbasis cookie |
| 404 | `NOT_FOUND` | Resource tidak ada **atau** di luar scope (sengaja tidak dibedakan) |
| 409 | `CONFLICT` / kode domain | Konflik state |
| 429 | `TOO_MANY_ATTEMPTS` | Terlalu banyak login gagal; `details.retryAfterSeconds` + header `Retry-After` |
| 503 | `NOT_READY` | Database tidak tersedia |

List: query `page` (≥1, default 1) dan `pageSize` (1–100, default 20); respons `{ items, page, pageSize, total }`.

## Health (publik)
- `GET /health/live` → `{ status: "ok" }`
- `GET /health/ready` → `{ status: "ok", checks: { database: "up" } }` atau 503 `NOT_READY`

## Auth
### `POST /auth/login` (publik)
Body `{ email, password }` (email di-trim & lowercase). 200:
```json
{ "accessToken": "…", "tokenType": "Bearer", "expiresAt": "2026-10-31T05:00:00.000Z", "user": { /* sama dengan /auth/me */ } }
```
Respons juga memasang cookie sesi `sfp_session`. Frontend tidak menyimpan `accessToken` dari body.
401 `INVALID_CREDENTIALS` — pesan sama untuk email tidak terdaftar, kata sandi salah, atau akun nonaktif.
429 `TOO_MANY_ATTEMPTS` — setelah 5 gagal per IP+email atau 30 gagal per IP dalam 15 menit (berlaku juga bila sandi benar).

### `POST /auth/logout` (publik)
204; menghapus cookie sesi. Token stateless tidak dicabut di server (salinan Bearer tetap sah sampai kedaluwarsa).

### `GET /auth/me`
```json
{
  "id": "uuid", "email": "manager-a@example.test",
  "grants": [{ "role": "MANAGER", "includeDescendants": true,
               "organization": { "id": "uuid", "code": "ORG-1", "name": "Demo Nusantara" },
               "unit": { "id": "uuid", "code": "BR-A", "name": "BR-A", "type": "BRANCH" } }],
  "permissions": ["analytics.performance.read", "approval.decide", "…"]
}
```
Ditambah `sessionExpiresAt` (ISO). Token hanya memuat `sub` (user ID) dan `typ`; role/scope selalu dibaca ulang dari database per request.

## Master organisasi
| Endpoint | Permission | Catatan |
|---|---|---|
| `GET /org-units?organizationId&parentId&type&page&pageSize` | `org.read` | Hanya unit dalam scope. Filter di luar scope → 404 |
| `GET /org-units/:id` | `org.read` | `{ …unit, children[] }`; `parentId` null bila induk di luar scope |
| `PATCH /org-units/:id` body `{ name }` | `org.manage` (ADMIN) | Scope dicek; audit `ORG_UNIT_RENAMED` di transaksi yang sama. Dipakai UI halaman Organisasi (tombol "Ubah nama"). Resmi masuk kontrak (D-22, docs/architecture.md §6) |

Bentuk unit: `{ id, code, name, type, organization: { id, code, name }, parentId }`.

## Karyawan
| Endpoint | Permission | Catatan |
|---|---|---|
| `GET /employees?unitId&page&pageSize` | `employee.read` | Karyawan yang pernah/sedang ditempatkan di unit dalam scope (atau seluruh organisasi untuk grant org-wide) |
| `GET /employees/summary?asOf=YYYY-MM-DD` | `employee.read` | Jumlah penempatan primer aktif per unit dalam scope pada `asOf` (default hari ini Asia/Jakarta) |
| `GET /employees/:id` | `employee.read` | 404 bila di luar scope |

Bentuk karyawan: `{ id, code, name, organizationId, assignments: [{ unitId, unitCode, unitName, startDate, endDateExclusive, isPrimary }] }` — riwayat di unit luar scope disembunyikan.

## Rekonsiliasi
| Endpoint | Permission | Catatan |
|---|---|---|
| `POST /datasets/import` (multipart: `file`, `unitId`, `accountId`, `side`) | `dataset.import` (FINANCE) | 201 dataset baru, 200 `created:false` bila file identik/urutan berbeda. 400 `IMPORT_REJECTED` (+ `details.errors[]`), `INVALID_HEADER`, `EMPTY_FILE`, `TOO_MANY_ROWS`, `UNSUPPORTED_FILE_TYPE`, `FILE_REQUIRED`; 409 `TRANSACTION_CONFLICT`; 413 > 1 MiB; 404 unit di luar scope |
| `GET /datasets?unitId&side&page&pageSize` | `reconciliation.read` | Dataset dalam scope |
| `POST /reconciliation-runs` body `{ internalDatasetId, externalDatasetId, ruleVersion: "v1"\|"v2" }` | `reconciliation.run` (FINANCE) | 201 run baru, 200 `created:false` bila identik. 400 `DATASET_SIDE_MISMATCH` / `DATASET_SCOPE_MISMATCH`; 404 dataset di luar scope; 409 `CANONICAL_OVERLAP` |
| `GET /reconciliation-runs?unitId&page&pageSize` | `reconciliation.summary.read` | Daftar run dalam scope, terbaru dulu (`created_at` lalu `id`, stabil antar halaman); `unitId` di luar scope → 404; `pageSize` maks. 100; `total` untuk paginasi. UI memaginasi & memfilter lewat parameter ini (tambahan di luar kontrak awal) |
| `GET /reconciliation-runs/:id` | `reconciliation.summary.read` | Detail run (tambahan) |
| `GET /reconciliation-runs/:id/results?status&reason&page&pageSize` | `reconciliation.read` | Grup hasil berurutan `matchKey`; tiap grup memuat seluruh transaksi internal/eksternal |
| `GET /reconciliation-runs/:id/summary` | `reconciliation.summary.read` | Dihitung segar dari DB |

Bentuk run: `{ id, ruleVersion, dateToleranceDays, amountTolerance, unitId, unit, accountId, internalDatasetId, externalDatasetId, groups, isCanonical, createdAt, completedAt }`.

Grup hasil: `{ id, reference, status: MATCHED|MISMATCHED|MISSING_IN_INTERNAL|MISSING_IN_EXTERNAL, statusLabel, reason, internal: [{ id, transactionId, reference, transactionDate, amount }], external: [...], internalAmountTotal, externalAmountTotal, amountDifference }` — `amountDifference` null untuk missing & duplicate.

Ringkasan:
```json
{ "runId": "…", "ruleVersion": "v1", "groups": 7,
  "counts": { "MATCHED": 2, "MISMATCHED": 3, "MISSING_IN_INTERNAL": 1, "MISSING_IN_EXTERNAL": 1 },
  "byReason": { "AMOUNT_DIFFERENCE": 1, "DATE_OUTSIDE_TOLERANCE": 1, "DUPLICATE_REFERENCE": 1, "NO_INTERNAL": 1, "NO_EXTERNAL": 1 },
  "matchedRatioPercent": "28.571428571428571429", "matchedRatioPercentDisplay": "28.57",
  "verifiedRevenue": "15000000", "anomalousInternalTotal": "7900000", "anomalousExternalTotal": "6400000",
  "uniquePairAmountDifferenceTotal": "100000", "isCanonical": true }
```

## Performa & revenue per employee
| Endpoint | Permission | Catatan |
|---|---|---|
| `GET /review-periods` | `analytics.rpe.read` | Periode organisasi dalam scope |
| `POST /review-periods` body `{ code, startDate, endDateExclusive, organizationId? }` | `review.manage` (HR) | 201; 409 `PERIOD_CODE_EXISTS`; 400 bila panjang bukan 1–366 hari |
| `POST /kpi-assignments` body `{ employeeId, periodId, name, source: MANUAL\|VERIFIED_UNIT_REVENUE, unitId?, weight, target, actual? }` | `review.manage` | Nilai berupa string desimal. 404 karyawan di luar scope/periode; 400 `KPI_UNIT_OUT_OF_RANGE`; 409 `REVIEW_FINALIZED`. Respons `{ kpiId, review }` |
| `PATCH /kpi-assignments/:id` body `{ name?, weight?, target?, actual? }` | `review.manage` | `actual: null` mengosongkan (manual). KPI revenue menolak `actual` |
| `GET /reviews?periodId&unitId` | `analytics.performance.read` | Karyawan per periode berdasar unit rumah: `{ employee, unit, reviewId, status: NOT_STARTED\|DRAFT\|FINALIZED, totalScore (final saja), kpiCount, weightTotal }` |
| `POST /reviews/calculate` body `{ employeeId, periodId }` | `review.manage` | 200; membuat DRAFT bila perlu; preview atau snapshot |
| `GET /reviews/:id` | `analytics.performance.read` | 404 bila unit review di luar scope |
| `POST /reviews/:id/finalize` | `review.manage` | 200 snapshot; 409 `REVIEW_ALREADY_FINALIZED` / `FINALIZE_REJECTED` |

Aturan akses sumber KPI (business-rules §3.6): bila unit sumber revenue KPI (unit + turunan untuk draf; unit di provenance untuk final) tidak seluruhnya dalam scope actor, `GET /reviews/:id`, `POST /reviews/calculate`, `POST /reviews/:id/finalize`, dan `POST/PATCH /kpi-assignments` → 404; `GET /reviews` mengecualikan karyawan tersebut; `GET /analytics/performance` tidak menghitung review tersebut.
| `GET /analytics/revenue-per-employee?periodId&unitId` | `analytics.rpe.read` | Lihat bentuk di bawah |
| `GET /analytics/performance?periodId&unitId` | `analytics.performance.read` | Distribusi skor final per band |

Review:
```json
{ "id": "…", "status": "DRAFT|FINALIZED", "isSnapshot": false, "formulaVersion": "kpi-v1",
  "employee": { "id": "…", "code": "EMP-1", "name": "…" }, "unit": { "code": "BR-A" }, "period": { "code": "PERIOD-SEP", "days": 30 },
  "items": [{ "kpiId": "…", "name": "Revenue cabang", "source": "VERIFIED_UNIT_REVENUE", "unit": { "code": "BR-A" },
              "weight": "60", "target": "20000000", "actual": "15000000", "achievement": "75", "cappedAchievement": "75", "weightedScore": "45" }],
  "weightTotal": "100", "totalScore": "85", "problems": [], "canFinalize": true, "finalizedAt": null,
  "provenance": { "formulaVersion": "kpi-v1", "period": { … }, "revenueSources": [{ "kpiId": "…", "unitCode": "BR-A", "unitIds": ["…"], "verifiedRevenue": "15000000", "canonicalRunIds": ["…"], "ruleVersions": ["v1"] }] } }
```

RPE: `{ period, units: [{ unit: { id, code, name, type, parentId|null }, own: Metrics, hasChildren, subtotal: Metrics|null, subtotalUnavailableReason: "PARTIAL_SCOPE"|null, benchmark: { parentUnitId, parentRpe, difference, index }|null, benchmarkUnavailableReason: "NO_PARENT"|"PARENT_OUT_OF_SCOPE"|null }], organizationTotal: Metrics|null, branchSpread }` dengan `Metrics = { verifiedRevenue, recordedRevenue, employeeDays, averageHeadcount, rpe|null, canonicalRunIds }`. Semua nominal string desimal presisi penuh; tampilan dibulatkan HALF_UP 2 desimal di frontend.

## Persetujuan anggaran
Visibilitas & kelayakan: business-rules §4.5. Nominal string desimal (> 0, maks. 2 desimal).

| Endpoint | Permission | Catatan |
|---|---|---|
| `GET /approval-requests/options` | `approval.request.create` | Unit dalam scope pengaju + definisi workflow aktif (untuk pratinjau jalur) |
| `POST /approval-requests` body `{ unitId, title, reason, amount }` | `approval.request.create` | 201 draf; 404 unit di luar scope |
| `PATCH /approval-requests/:id` body `{ unitId?, title?, reason?, amount? }` | `approval.request.create` | Hanya draf milik sendiri; 409 `REQUEST_NOT_DRAFT` |
| `POST /approval-requests/:id/submit` | `approval.request.create` | 200; snapshot workflow + langkah; 409 `REQUEST_ALREADY_SUBMITTED`, `NO_ACTIVE_WORKFLOW` |
| `GET /approval-requests?view=mine\|inbox\|all&status&page&pageSize` | login | Hasil mengikuti visibilitas |
| `GET /approval-requests/:id` | login | 404 di luar visibilitas. Memuat `steps`, `history`, `workflow` (snapshot), `permissions: { canEdit, canSubmit, canDecide, activeStepId }` |
| `GET /approval-requests/:id/audit` | login | Jejak audit (visibilitas sama dengan detail) |
| `POST /approval-requests/:id/steps/:stepId/approve` body `{ comment? }` | `approval.decide` | 200; 404 / 409 `REQUEST_NOT_PENDING`, `STEP_NOT_ACTIVE` / 403 `SELF_APPROVAL_FORBIDDEN`, `NOT_ASSIGNEE`, `NOT_ELIGIBLE` |
| `POST /approval-requests/:id/steps/:stepId/reject` body `{ comment }` (min. 3 karakter) | `approval.decide` | Sama seperti approve |
| `POST /approval-requests/:id/steps/:stepId/delegate` body `{ toUserId, comment? }` | `approval.decide` | 200; 403 `INVALID_DELEGATE` |
| `GET /approval-requests/:id/steps/:stepId/delegates` | `approval.decide` | Calon penerima yang sah; hanya untuk actor yang berhak bertindak |

Ringkasan pengajuan: `{ id, code, title, amount, currency, status, unit, requester: { id, email }, createdAt, submittedAt, decidedAt, activeStep: { id, order, role, assignee }|null, version }`.
