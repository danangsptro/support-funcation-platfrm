import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

export interface UnitRevenue {
  unitId: string;
  amount: string;
}

/** Kelompok unit yang revenue-nya dijumlahkan bersama (mis. satu cabang + turunannya). */
export interface RevenueGroup {
  key: string;
  unitIds: string[];
}

export interface GroupRevenue {
  key: string;
  amount: string;
  /** Run canonical yang menyumbang revenue terverifikasi (provenance). Kosong untuk recorded. */
  canonicalRunIds: string[];
}

type Db = Pick<PrismaService, '$queryRaw'> | Prisma.TransactionClient;

/**
 * Revenue per unit untuk periode [from, toExclusive). Pemanggil WAJIB memberi unitIds dari scope
 * tepercaya (ScopeService) — service ini tidak menerima parameter klien mentah.
 */
@Injectable()
export class RevenueService {
  constructor(private readonly prisma: PrismaService) {}

  /** Verified: transaksi internal REVENUE yang Matched pada hasil canonical. v1 dan v2 tidak pernah dijumlahkan. */
  async verifiedByUnit(unitIds: string[], from: string, toExclusive: string): Promise<UnitRevenue[]> {
    if (unitIds.length === 0) return [];
    const rows = await this.prisma.$queryRaw<{ unit_id: string; amount: Prisma.Decimal }[]>`
      SELECT ft.unit_id, SUM(ft.amount) AS amount
      FROM canonical_reconciliations c
      JOIN reconciliation_results r ON r.id = c.result_id
      JOIN financial_transactions ft ON ft.id = c.internal_transaction_id
      WHERE r.status = 'MATCHED'
        AND ft.transaction_type = 'REVENUE'
        AND ft.unit_id = ANY(${unitIds}::uuid[])
        AND ft.transaction_date >= ${from}::date AND ft.transaction_date < ${toExclusive}::date
      GROUP BY ft.unit_id`;
    return rows.map((r) => ({ unitId: r.unit_id, amount: r.amount.toString() }));
  }

  /**
   * Verified revenue untuk banyak kelompok dalam SATU statement SQL, sehingga semua kelompok membaca
   * keadaan canonical yang sama (pergantian run v1 → v2 bersifat atomik; statement ini melihat salah
   * satunya secara utuh, tidak campuran). Bisa dijalankan di dalam transaksi pemanggil.
   */
  async verifiedForGroups(groups: RevenueGroup[], from: string, toExclusive: string, db: Db = this.prisma): Promise<GroupRevenue[]> {
    const pairs = groups.flatMap((g) => g.unitIds.map((u) => [g.key, u] as const));
    if (pairs.length === 0) return groups.map((g) => ({ key: g.key, amount: '0', canonicalRunIds: [] }));
    const rows = await db.$queryRaw<{ key: string; amount: Prisma.Decimal; run_ids: string[] }[]>`
      WITH g AS (
        SELECT * FROM unnest(${pairs.map((p) => p[0])}::text[], ${pairs.map((p) => p[1])}::uuid[]) AS g(key, unit_id)
      ), v AS (
        SELECT ft.unit_id, ft.amount, c.run_id
        FROM canonical_reconciliations c
        JOIN reconciliation_results r ON r.id = c.result_id AND r.status = 'MATCHED'
        JOIN financial_transactions ft ON ft.id = c.internal_transaction_id
        WHERE ft.transaction_type = 'REVENUE'
          AND ft.unit_id IN (SELECT unit_id FROM g)
          AND ft.transaction_date >= ${from}::date AND ft.transaction_date < ${toExclusive}::date
      )
      SELECT g.key,
             COALESCE(SUM(v.amount), 0) AS amount,
             COALESCE(array_agg(DISTINCT v.run_id::text) FILTER (WHERE v.run_id IS NOT NULL), ARRAY[]::text[]) AS run_ids
      FROM g LEFT JOIN v ON v.unit_id = g.unit_id
      GROUP BY g.key`;
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return groups.map((g) => {
      const r = byKey.get(g.key);
      return { key: g.key, amount: r ? r.amount.toString() : '0', canonicalRunIds: r ? [...r.run_ids].sort() : [] };
    });
  }

  /** Recorded revenue (seluruh transaksi internal, terlepas status rekonsiliasi) untuk banyak kelompok, satu statement. */
  async recordedForGroups(groups: RevenueGroup[], from: string, toExclusive: string, db: Db = this.prisma): Promise<GroupRevenue[]> {
    const pairs = groups.flatMap((g) => g.unitIds.map((u) => [g.key, u] as const));
    if (pairs.length === 0) return groups.map((g) => ({ key: g.key, amount: '0', canonicalRunIds: [] }));
    const rows = await db.$queryRaw<{ key: string; amount: Prisma.Decimal }[]>`
      WITH g AS (
        SELECT * FROM unnest(${pairs.map((p) => p[0])}::text[], ${pairs.map((p) => p[1])}::uuid[]) AS g(key, unit_id)
      )
      SELECT g.key, COALESCE(SUM(ft.amount), 0) AS amount
      FROM g LEFT JOIN financial_transactions ft
        ON ft.unit_id = g.unit_id AND ft.side = 'INTERNAL' AND ft.transaction_type = 'REVENUE'
       AND ft.transaction_date >= ${from}::date AND ft.transaction_date < ${toExclusive}::date
      GROUP BY g.key`;
    const byKey = new Map(rows.map((r) => [r.key, r.amount.toString()]));
    return groups.map((g) => ({ key: g.key, amount: byKey.get(g.key) ?? '0', canonicalRunIds: [] }));
  }

  /** Recorded: seluruh transaksi internal REVENUE (satu kali per identitas sumber), terlepas status rekonsiliasi. */
  async recordedByUnit(unitIds: string[], from: string, toExclusive: string): Promise<UnitRevenue[]> {
    if (unitIds.length === 0) return [];
    const rows = await this.prisma.$queryRaw<{ unit_id: string; amount: Prisma.Decimal }[]>`
      SELECT unit_id, SUM(amount) AS amount
      FROM financial_transactions
      WHERE side = 'INTERNAL' AND transaction_type = 'REVENUE'
        AND unit_id = ANY(${unitIds}::uuid[])
        AND transaction_date >= ${from}::date AND transaction_date < ${toExclusive}::date
      GROUP BY unit_id`;
    return rows.map((r) => ({ unitId: r.unit_id, amount: r.amount.toString() }));
  }
}
