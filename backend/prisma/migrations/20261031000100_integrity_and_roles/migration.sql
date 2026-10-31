-- Constraint integritas yang tidak bisa diekspresikan di schema.prisma, trigger audit append-only,
-- dan hak akses role runtime. PERINGATAN: `prisma migrate diff` tidak mengenal FK komposit di bawah
-- dan akan mengusulkan DROP; hapus usulan itu sebelum membuat migration baru. Test integrasi
-- test/integration/schema-constraints.int-spec.ts gagal bila constraint ini hilang.

CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    RAISE EXCEPTION 'Role app_runtime belum ada. Jalankan docker/postgres/init/01-roles-and-databases.sh terlebih dulu.';
  END IF;
END $$;

-- ---------- Konsistensi organisasi (FK komposit) ----------
ALTER TABLE "org_units"
  ADD CONSTRAINT "org_units_parent_same_org_fkey"
    FOREIGN KEY ("parent_id", "organization_id") REFERENCES "org_units"("id", "organization_id"),
  ADD CONSTRAINT "org_units_not_own_parent_chk" CHECK ("parent_id" IS NULL OR "parent_id" <> "id");

ALTER TABLE "user_access_grants"
  ADD CONSTRAINT "user_access_grants_unit_same_org_fkey"
    FOREIGN KEY ("unit_id", "organization_id") REFERENCES "org_units"("id", "organization_id");
CREATE UNIQUE INDEX "user_access_grants_identity_key"
  ON "user_access_grants" ("user_id", "role", "organization_id", "unit_id") NULLS NOT DISTINCT;

ALTER TABLE "employee_assignments"
  ADD CONSTRAINT "employee_assignments_employee_same_org_fkey"
    FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id"),
  ADD CONSTRAINT "employee_assignments_unit_same_org_fkey"
    FOREIGN KEY ("unit_id", "organization_id") REFERENCES "org_units"("id", "organization_id"),
  ADD CONSTRAINT "employee_assignments_interval_chk"
    CHECK ("end_date_exclusive" IS NULL OR "end_date_exclusive" > "start_date"),
  -- Penempatan primer satu karyawan tidak boleh overlap (interval [start, end_exclusive)).
  ADD CONSTRAINT "employee_assignments_primary_no_overlap"
    EXCLUDE USING gist (
      "employee_id" WITH =,
      daterange("start_date", "end_date_exclusive", '[)') WITH &&
    ) WHERE ("is_primary");

ALTER TABLE "review_periods"
  ADD CONSTRAINT "review_periods_interval_chk" CHECK ("end_date_exclusive" > "start_date");

ALTER TABLE "kpi_assignments"
  ADD CONSTRAINT "kpi_assignments_employee_same_org_fkey"
    FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id"),
  ADD CONSTRAINT "kpi_assignments_period_same_org_fkey"
    FOREIGN KEY ("period_id", "organization_id") REFERENCES "review_periods"("id", "organization_id"),
  ADD CONSTRAINT "kpi_assignments_unit_same_org_fkey"
    FOREIGN KEY ("unit_id", "organization_id") REFERENCES "org_units"("id", "organization_id"),
  ADD CONSTRAINT "kpi_assignments_target_positive_chk" CHECK ("target" > 0),
  ADD CONSTRAINT "kpi_assignments_actual_non_negative_chk" CHECK ("actual" IS NULL OR "actual" >= 0),
  ADD CONSTRAINT "kpi_assignments_weight_range_chk" CHECK ("weight" > 0 AND "weight" <= 100),
  ADD CONSTRAINT "kpi_assignments_source_unit_chk" CHECK (
    ("source" = 'VERIFIED_UNIT_REVENUE' AND "unit_id" IS NOT NULL)
    OR ("source" = 'MANUAL' AND "unit_id" IS NULL)
  );

ALTER TABLE "performance_reviews"
  ADD CONSTRAINT "performance_reviews_employee_same_org_fkey"
    FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id"),
  ADD CONSTRAINT "performance_reviews_period_same_org_fkey"
    FOREIGN KEY ("period_id", "organization_id") REFERENCES "review_periods"("id", "organization_id"),
  ADD CONSTRAINT "performance_reviews_finalized_chk" CHECK (
    ("status" = 'FINALIZED') = ("finalized_at" IS NOT NULL)
  );

-- ---------- Rekonsiliasi ----------
ALTER TABLE "financial_transactions"
  ADD CONSTRAINT "financial_transactions_unit_same_org_fkey"
    FOREIGN KEY ("unit_id", "organization_id") REFERENCES "org_units"("id", "organization_id"),
  ADD CONSTRAINT "financial_transactions_amount_positive_chk" CHECK ("amount" > 0),
  ADD CONSTRAINT "financial_transactions_currency_chk" CHECK ("currency" = 'IDR'),
  ADD CONSTRAINT "financial_transactions_type_chk" CHECK ("transaction_type" = 'REVENUE'),
  ADD CONSTRAINT "financial_transactions_reference_chk" CHECK (btrim("reference") <> ''),
  ADD CONSTRAINT "financial_transactions_id_side_key" UNIQUE ("id", "side");

ALTER TABLE "transaction_datasets"
  ADD CONSTRAINT "transaction_datasets_unit_same_org_fkey"
    FOREIGN KEY ("unit_id", "organization_id") REFERENCES "org_units"("id", "organization_id"),
  ADD CONSTRAINT "transaction_datasets_row_count_chk" CHECK ("row_count" >= 0);

ALTER TABLE "reconciliation_runs"
  ADD CONSTRAINT "reconciliation_runs_distinct_datasets_chk" CHECK ("internal_dataset_id" <> "external_dataset_id"),
  ADD CONSTRAINT "reconciliation_runs_tolerance_chk" CHECK ("date_tolerance_days" >= 0 AND "amount_tolerance" >= 0);

ALTER TABLE "reconciliation_results"
  ADD CONSTRAINT "reconciliation_results_id_run_key" UNIQUE ("id", "run_id");

-- Item hasil harus milik run yang sama dengan hasilnya (transaksi satu kali per run).
ALTER TABLE "reconciliation_result_items"
  ADD CONSTRAINT "reconciliation_result_items_result_run_fkey"
    FOREIGN KEY ("result_id", "run_id") REFERENCES "reconciliation_results"("id", "run_id"),
  ADD CONSTRAINT "reconciliation_result_items_tx_side_fkey"
    FOREIGN KEY ("transaction_id", "side") REFERENCES "financial_transactions"("id", "side");

-- Canonical hanya untuk transaksi INTERNAL, dan result harus milik run yang dirujuk.
ALTER TABLE "canonical_reconciliations"
  ADD CONSTRAINT "canonical_reconciliations_internal_only_chk" CHECK ("transaction_side" = 'INTERNAL'),
  ADD CONSTRAINT "canonical_reconciliations_tx_side_fkey"
    FOREIGN KEY ("internal_transaction_id", "transaction_side") REFERENCES "financial_transactions"("id", "side"),
  ADD CONSTRAINT "canonical_reconciliations_result_run_fkey"
    FOREIGN KEY ("result_id", "run_id") REFERENCES "reconciliation_results"("id", "run_id");

-- ---------- Workflow & approval ----------
ALTER TABLE "workflow_steps"
  ADD CONSTRAINT "workflow_steps_condition_chk" CHECK (
    ("condition_type" = 'ALWAYS' AND "condition_amount" IS NULL)
    OR ("condition_type" = 'AMOUNT_GT' AND "condition_amount" IS NOT NULL)
  ),
  ADD CONSTRAINT "workflow_steps_order_chk" CHECK ("step_order" > 0);

ALTER TABLE "approval_requests"
  ADD CONSTRAINT "approval_requests_unit_same_org_fkey"
    FOREIGN KEY ("unit_id", "organization_id") REFERENCES "org_units"("id", "organization_id"),
  ADD CONSTRAINT "approval_requests_amount_positive_chk" CHECK ("amount" > 0),
  ADD CONSTRAINT "approval_requests_currency_chk" CHECK ("currency" = 'IDR'),
  ADD CONSTRAINT "approval_requests_version_chk" CHECK ("version" >= 0);

ALTER TABLE "approval_steps"
  ADD CONSTRAINT "approval_steps_id_request_key" UNIQUE ("id", "request_id"),
  ADD CONSTRAINT "approval_steps_decision_chk" CHECK (
    ("status" IN ('APPROVED', 'REJECTED')) = ("decided_at" IS NOT NULL AND "decided_by" IS NOT NULL)
  );

ALTER TABLE "approval_actions"
  ADD CONSTRAINT "approval_actions_step_request_fkey"
    FOREIGN KEY ("step_id", "request_id") REFERENCES "approval_steps"("id", "request_id"),
  ADD CONSTRAINT "approval_actions_delegate_chk" CHECK (
    ("action" = 'DELEGATE') = ("delegate_to_user_id" IS NOT NULL)
  );
-- Tepat satu keputusan terminal per step (jaring kedua di bawah row lock aplikasi).
CREATE UNIQUE INDEX "approval_actions_one_terminal_per_step"
  ON "approval_actions" ("step_id") WHERE "action" IN ('APPROVE', 'REJECT');

-- ---------- Audit append-only ----------
CREATE FUNCTION "audit_events_block_mutation"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events bersifat append-only (% ditolak)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER "audit_events_no_update_delete"
  BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION "audit_events_block_mutation"();

-- ---------- Hak akses role runtime ----------
GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_events" FROM app_runtime;
REVOKE ALL ON "_prisma_migrations" FROM app_runtime;
-- Tabel baru dari migration berikutnya otomatis mendapat DML; audit-like table wajib REVOKE eksplisit.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;
