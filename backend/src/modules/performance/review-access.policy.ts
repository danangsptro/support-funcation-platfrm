import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AccessScope, notFound } from '../access/scope.service';
import { OrgTree } from './org-tree';

type Db = PrismaService | Prisma.TransactionClient;

interface Provenance {
  revenueSources?: { unitIds?: string[] }[];
}

/**
 * Kebijakan akses sumber KPI (default-deny). Membaca/mengelola review mensyaratkan DUA hal dari scope
 * permission terkait (dihitung server dari grant, bukan dari klien):
 *   1. unit rumah review ada dalam scope; dan
 *   2. SELURUH unit sumber revenue KPI ada dalam scope — untuk DRAFT: unit KPI + seluruh turunannya
 *      (cara actual dihitung); untuk FINAL: daftar unit yang benar-benar dijumlahkan di provenance snapshot.
 * Bila tidak terpenuhi, review diperlakukan "tidak ada" (404 / dikecualikan dari list & agregat) — tidak
 * pernah ditampilkan dengan angka parsial. Grant tanpa include_descendants tidak membuka unit turunan.
 */
@Injectable()
export class ReviewAccessPolicy {
  constructor(private readonly prisma: PrismaService) {}

  /** Unit sumber revenue per karyawan untuk satu periode. */
  async sourceUnits(periodId: string, employeeIds: string[], tree: OrgTree, db: Db = this.prisma): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>(employeeIds.map((e) => [e, []]));
    if (employeeIds.length === 0) return out;
    const [reviews, kpis] = await Promise.all([
      db.performanceReview.findMany({
        where: { periodId, employeeId: { in: employeeIds }, status: 'FINALIZED' },
        select: { employeeId: true, provenance: true },
      }),
      db.kpiAssignment.findMany({
        where: { periodId, employeeId: { in: employeeIds }, source: 'VERIFIED_UNIT_REVENUE' },
        select: { employeeId: true, unitId: true },
      }),
    ]);
    const finalized = new Set<string>();
    for (const r of reviews) {
      finalized.add(r.employeeId);
      out.set(r.employeeId, ReviewAccessPolicy.snapshotUnits(r.provenance));
    }
    for (const k of kpis) {
      if (finalized.has(k.employeeId) || !k.unitId) continue;
      out.get(k.employeeId)!.push(...tree.subtree(k.unitId));
    }
    return out;
  }

  static snapshotUnits(provenance: Prisma.JsonValue): string[] {
    const p = (provenance ?? {}) as Provenance;
    return (p.revenueSources ?? []).flatMap((s) => s.unitIds ?? []);
  }

  static covers(scope: AccessScope, unitIds: string[]): boolean {
    return unitIds.every((u) => scope.hasUnit(u));
  }

  /** 404 bila ada sumber KPI di luar scope (konsisten dengan resource di luar scope lainnya). */
  async assertCovered(scope: AccessScope, periodId: string, employeeId: string, tree: OrgTree, db: Db = this.prisma): Promise<void> {
    const units = (await this.sourceUnits(periodId, [employeeId], tree, db)).get(employeeId)!;
    if (!ReviewAccessPolicy.covers(scope, units)) throw notFound('Review');
  }
}
