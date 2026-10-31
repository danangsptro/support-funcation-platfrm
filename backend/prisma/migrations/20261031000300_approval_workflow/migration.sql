-- AlterTable
ALTER TABLE "approval_requests" ADD COLUMN     "reason" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "workflow_snapshot" JSONB;


-- ---------- Manual (tidak dikenal Prisma) ----------
ALTER TABLE "approval_requests"
  ADD CONSTRAINT "approval_requests_reason_len_chk" CHECK (char_length("reason") <= 2000),
  ADD CONSTRAINT "approval_requests_title_len_chk" CHECK (char_length("title") <= 200),
  -- Hanya DRAFT yang belum pernah disubmit; setelah submit wajib ada snapshot workflow.
  ADD CONSTRAINT "approval_requests_submitted_chk" CHECK (
    ("status" = 'DRAFT') = ("submitted_at" IS NULL)
    AND ("status" = 'DRAFT' OR "workflow_snapshot" IS NOT NULL)
  ),
  -- PENDING ⇔ ada langkah aktif; status akhir ⇔ waktu keputusan tercatat.
  ADD CONSTRAINT "approval_requests_pending_step_chk" CHECK (("status" = 'PENDING') = ("current_step_order" IS NOT NULL)),
  ADD CONSTRAINT "approval_requests_decided_chk" CHECK (("status" IN ('APPROVED', 'REJECTED')) = ("decided_at" IS NOT NULL));

-- Paling banyak satu langkah ACTIVE per pengajuan.
CREATE UNIQUE INDEX "approval_steps_one_active_per_request" ON "approval_steps" ("request_id") WHERE "status" = 'ACTIVE';

-- Paling banyak satu versi workflow aktif per organisasi & tipe.
CREATE UNIQUE INDEX "workflow_definitions_one_active" ON "workflow_definitions" ("organization_id", "type") WHERE "active";
