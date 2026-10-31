-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OrgUnitType" AS ENUM ('DIVISION', 'BRANCH', 'COST_CENTER');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'HR', 'FINANCE', 'MANAGER', 'REQUESTER');

-- CreateEnum
CREATE TYPE "TransactionSide" AS ENUM ('INTERNAL', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "KpiSource" AS ENUM ('VERIFIED_UNIT_REVENUE', 'MANUAL');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('DRAFT', 'FINALIZED');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('COMPLETED');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('MATCHED', 'MISMATCHED', 'MISSING_IN_INTERNAL', 'MISSING_IN_EXTERNAL');

-- CreateEnum
CREATE TYPE "StepConditionType" AS ENUM ('ALWAYS', 'AMOUNT_GT');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "StepStatus" AS ENUM ('WAITING', 'ACTIVE', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ApprovalActionType" AS ENUM ('APPROVE', 'REJECT', 'DELEGATE');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "external_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_units" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "parent_id" UUID,
    "type" "OrgUnitType" NOT NULL,
    "external_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "external_key" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_access_grants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "organization_id" UUID NOT NULL,
    "unit_id" UUID,
    "include_descendants" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "external_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employee_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date_exclusive" DATE,
    "is_primary" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_periods" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "external_key" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date_exclusive" DATE NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Jakarta',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "external_key" TEXT,
    "name" TEXT NOT NULL,
    "source" "KpiSource" NOT NULL,
    "unit_id" UUID,
    "weight" DECIMAL(5,2) NOT NULL,
    "target" DECIMAL(20,4) NOT NULL,
    "actual" DECIMAL(20,4),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kpi_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'DRAFT',
    "total_score" DECIMAL,
    "formula_version" TEXT NOT NULL,
    "provenance" JSONB NOT NULL DEFAULT '{}',
    "calculated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalized_at" TIMESTAMPTZ(6),
    "finalized_by" UUID,

    CONSTRAINT "performance_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "review_id" UUID NOT NULL,
    "kpi_assignment_id" UUID NOT NULL,
    "kpi_name" TEXT NOT NULL,
    "source" "KpiSource" NOT NULL,
    "weight" DECIMAL(5,2) NOT NULL,
    "target" DECIMAL(20,4) NOT NULL,
    "actual" DECIMAL NOT NULL,
    "achievement" DECIMAL NOT NULL,
    "capped_achievement" DECIMAL NOT NULL,
    "weighted_score" DECIMAL NOT NULL,

    CONSTRAINT "review_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "side" "TransactionSide" NOT NULL,
    "account_id" TEXT NOT NULL,
    "source_transaction_id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "transaction_date" DATE NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "transaction_type" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_datasets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "account_id" TEXT NOT NULL,
    "side" "TransactionSide" NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "row_count" INTEGER NOT NULL,
    "source_filename" TEXT,
    "imported_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_datasets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dataset_transactions" (
    "dataset_id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,

    CONSTRAINT "dataset_transactions_pkey" PRIMARY KEY ("dataset_id","transaction_id")
);

-- CreateTable
CREATE TABLE "reconciliation_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "account_id" TEXT NOT NULL,
    "internal_dataset_id" UUID NOT NULL,
    "external_dataset_id" UUID NOT NULL,
    "rule_version" TEXT NOT NULL,
    "date_tolerance_days" INTEGER NOT NULL,
    "amount_tolerance" DECIMAL(20,2) NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'COMPLETED',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "reconciliation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id" UUID NOT NULL,
    "match_key" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "MatchStatus" NOT NULL,
    "reason" TEXT,
    "internal_amount_total" DECIMAL(20,2) NOT NULL,
    "external_amount_total" DECIMAL(20,2) NOT NULL,
    "amount_difference" DECIMAL(20,2),

    CONSTRAINT "reconciliation_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_result_items" (
    "result_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "side" "TransactionSide" NOT NULL,

    CONSTRAINT "reconciliation_result_items_pkey" PRIMARY KEY ("result_id","transaction_id")
);

-- CreateTable
CREATE TABLE "canonical_reconciliations" (
    "internal_transaction_id" UUID NOT NULL,
    "transaction_side" "TransactionSide" NOT NULL DEFAULT 'INTERNAL',
    "run_id" UUID NOT NULL,
    "result_id" UUID NOT NULL,
    "selected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "canonical_reconciliations_pkey" PRIMARY KEY ("internal_transaction_id")
);

-- CreateTable
CREATE TABLE "workflow_definitions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "external_key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "self_approval" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_steps" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workflow_id" UUID NOT NULL,
    "step_order" INTEGER NOT NULL,
    "role" "Role" NOT NULL,
    "condition_type" "StepConditionType" NOT NULL,
    "condition_amount" DECIMAL(20,2),

    CONSTRAINT "workflow_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "external_key" TEXT,
    "requester_user_id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "amount" DECIMAL(20,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "current_step_order" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 0,
    "submitted_at" TIMESTAMPTZ(6),
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_steps" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "request_id" UUID NOT NULL,
    "workflow_step_id" UUID NOT NULL,
    "step_order" INTEGER NOT NULL,
    "role" "Role" NOT NULL,
    "status" "StepStatus" NOT NULL DEFAULT 'WAITING',
    "assignee_user_id" UUID,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(6),

    CONSTRAINT "approval_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_actions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "step_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "action" "ApprovalActionType" NOT NULL,
    "delegate_to_user_id" UUID,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" BIGSERIAL NOT NULL,
    "organization_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "trace_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_external_key_key" ON "organizations"("external_key");

-- CreateIndex
CREATE INDEX "org_units_parent_id_idx" ON "org_units"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "org_units_organization_id_external_key_key" ON "org_units"("organization_id", "external_key");

-- CreateIndex
CREATE UNIQUE INDEX "org_units_id_organization_id_key" ON "org_units"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_external_key_key" ON "users"("external_key");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "user_access_grants_user_id_idx" ON "user_access_grants"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "employees_organization_id_external_key_key" ON "employees"("organization_id", "external_key");

-- CreateIndex
CREATE UNIQUE INDEX "employees_id_organization_id_key" ON "employees"("id", "organization_id");

-- CreateIndex
CREATE INDEX "employee_assignments_unit_id_idx" ON "employee_assignments"("unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_assignments_employee_id_unit_id_start_date_key" ON "employee_assignments"("employee_id", "unit_id", "start_date");

-- CreateIndex
CREATE UNIQUE INDEX "review_periods_organization_id_external_key_key" ON "review_periods"("organization_id", "external_key");

-- CreateIndex
CREATE UNIQUE INDEX "review_periods_id_organization_id_key" ON "review_periods"("id", "organization_id");

-- CreateIndex
CREATE INDEX "kpi_assignments_employee_id_period_id_idx" ON "kpi_assignments"("employee_id", "period_id");

-- CreateIndex
CREATE UNIQUE INDEX "kpi_assignments_organization_id_external_key_key" ON "kpi_assignments"("organization_id", "external_key");

-- CreateIndex
CREATE UNIQUE INDEX "performance_reviews_employee_id_period_id_key" ON "performance_reviews"("employee_id", "period_id");

-- CreateIndex
CREATE UNIQUE INDEX "review_items_review_id_kpi_assignment_id_key" ON "review_items"("review_id", "kpi_assignment_id");

-- CreateIndex
CREATE INDEX "financial_transactions_organization_id_unit_id_transaction__idx" ON "financial_transactions"("organization_id", "unit_id", "transaction_date");

-- CreateIndex
CREATE UNIQUE INDEX "financial_transactions_organization_id_side_account_id_sour_key" ON "financial_transactions"("organization_id", "side", "account_id", "source_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_datasets_organization_id_fingerprint_key" ON "transaction_datasets"("organization_id", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_runs_internal_dataset_id_external_dataset_id_key" ON "reconciliation_runs"("internal_dataset_id", "external_dataset_id", "rule_version");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_results_run_id_match_key_key" ON "reconciliation_results"("run_id", "match_key");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_result_items_run_id_transaction_id_key" ON "reconciliation_result_items"("run_id", "transaction_id");

-- CreateIndex
CREATE INDEX "canonical_reconciliations_run_id_idx" ON "canonical_reconciliations"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_definitions_organization_id_external_key_version_key" ON "workflow_definitions"("organization_id", "external_key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_steps_workflow_id_step_order_key" ON "workflow_steps"("workflow_id", "step_order");

-- CreateIndex
CREATE INDEX "approval_requests_organization_id_unit_id_status_idx" ON "approval_requests"("organization_id", "unit_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "approval_requests_organization_id_external_key_key" ON "approval_requests"("organization_id", "external_key");

-- CreateIndex
CREATE UNIQUE INDEX "approval_steps_request_id_step_order_key" ON "approval_steps"("request_id", "step_order");

-- CreateIndex
CREATE INDEX "approval_actions_request_id_idx" ON "approval_actions"("request_id");

-- CreateIndex
CREATE INDEX "audit_events_entity_type_entity_id_id_idx" ON "audit_events"("entity_type", "entity_id", "id");

-- AddForeignKey
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_access_grants" ADD CONSTRAINT "user_access_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_access_grants" ADD CONSTRAINT "user_access_grants_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_access_grants" ADD CONSTRAINT "user_access_grants_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_assignments" ADD CONSTRAINT "employee_assignments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_assignments" ADD CONSTRAINT "employee_assignments_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "org_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_periods" ADD CONSTRAINT "review_periods_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_assignments" ADD CONSTRAINT "kpi_assignments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_assignments" ADD CONSTRAINT "kpi_assignments_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "review_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_assignments" ADD CONSTRAINT "kpi_assignments_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "review_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "performance_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_kpi_assignment_id_fkey" FOREIGN KEY ("kpi_assignment_id") REFERENCES "kpi_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "org_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_datasets" ADD CONSTRAINT "transaction_datasets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_datasets" ADD CONSTRAINT "transaction_datasets_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "org_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_transactions" ADD CONSTRAINT "dataset_transactions_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "transaction_datasets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_transactions" ADD CONSTRAINT "dataset_transactions_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "financial_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_internal_dataset_id_fkey" FOREIGN KEY ("internal_dataset_id") REFERENCES "transaction_datasets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_external_dataset_id_fkey" FOREIGN KEY ("external_dataset_id") REFERENCES "transaction_datasets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_results" ADD CONSTRAINT "reconciliation_results_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "reconciliation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_result_items" ADD CONSTRAINT "reconciliation_result_items_result_id_fkey" FOREIGN KEY ("result_id") REFERENCES "reconciliation_results"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_result_items" ADD CONSTRAINT "reconciliation_result_items_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "financial_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canonical_reconciliations" ADD CONSTRAINT "canonical_reconciliations_internal_transaction_id_fkey" FOREIGN KEY ("internal_transaction_id") REFERENCES "financial_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canonical_reconciliations" ADD CONSTRAINT "canonical_reconciliations_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "reconciliation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canonical_reconciliations" ADD CONSTRAINT "canonical_reconciliations_result_id_fkey" FOREIGN KEY ("result_id") REFERENCES "reconciliation_results"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflow_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "org_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requester_user_id_fkey" FOREIGN KEY ("requester_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflow_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_workflow_step_id_fkey" FOREIGN KEY ("workflow_step_id") REFERENCES "workflow_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_assignee_user_id_fkey" FOREIGN KEY ("assignee_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_actions" ADD CONSTRAINT "approval_actions_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "approval_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_actions" ADD CONSTRAINT "approval_actions_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_actions" ADD CONSTRAINT "approval_actions_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_actions" ADD CONSTRAINT "approval_actions_delegate_to_user_id_fkey" FOREIGN KEY ("delegate_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

