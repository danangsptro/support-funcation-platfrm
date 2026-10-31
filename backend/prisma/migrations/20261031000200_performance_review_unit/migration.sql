-- AlterTable
ALTER TABLE "performance_reviews" ADD COLUMN     "unit_id" UUID NOT NULL;

-- AlterTable
ALTER TABLE "review_items" ADD COLUMN     "unit_id" UUID;

-- CreateIndex
CREATE INDEX "performance_reviews_period_id_unit_id_idx" ON "performance_reviews"("period_id", "unit_id");

-- AddForeignKey
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "org_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------- Manual (tidak dikenal Prisma) ----------
-- Unit review wajib satu organisasi dengan review.
ALTER TABLE "performance_reviews"
  ADD CONSTRAINT "performance_reviews_unit_same_org_fkey"
    FOREIGN KEY ("unit_id", "organization_id") REFERENCES "org_units"("id", "organization_id"),
  -- Review final selalu punya skor; draft tidak menyimpan skor (preview dihitung langsung).
  ADD CONSTRAINT "performance_reviews_final_score_chk" CHECK (
    ("status" = 'FINALIZED') = ("total_score" IS NOT NULL)
  );
