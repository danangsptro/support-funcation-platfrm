import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { AppException } from '../../common/app-exception';
import { PrismaService } from '../../database/prisma.service';
import type { Actor } from './actor';
import { Permission, roleHasPermission } from './permissions';

/** Hasil resolusi scope untuk satu permission. Kosong = tidak ada akses (default-deny). */
export class AccessScope {
  private readonly units: Set<string>;
  private readonly orgs: Set<string>;
  private readonly orgWide: Set<string>;

  constructor(unitIds: Iterable<string>, organizationIds: Iterable<string>, orgWideOrganizationIds: Iterable<string>) {
    this.units = new Set(unitIds);
    this.orgs = new Set(organizationIds);
    this.orgWide = new Set(orgWideOrganizationIds);
  }

  /** Unit yang boleh diakses (sudah termasuk descendant bila grant mengizinkan). */
  get unitIds(): string[] {
    return [...this.units];
  }

  get organizationIds(): string[] {
    return [...this.orgs];
  }

  /** Organisasi dengan grant tanpa unit (seluruh organisasi), mis. ADMIN. */
  get orgWideOrganizationIds(): string[] {
    return [...this.orgWide];
  }

  get isEmpty(): boolean {
    return this.units.size === 0 && this.orgWide.size === 0;
  }

  hasUnit(unitId: string): boolean {
    return this.units.has(unitId);
  }

  hasOrganization(organizationId: string): boolean {
    return this.orgs.has(organizationId);
  }

  /** Untuk detail/mutasi: resource di luar scope dilaporkan 404 agar keberadaannya tidak bocor. */
  assertUnit(unitId: string, what = 'Resource'): void {
    if (!this.hasUnit(unitId)) throw notFound(what);
  }
}

export function notFound(what = 'Resource') {
  return new AppException(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${what} tidak ditemukan dalam akses Anda`);
}

@Injectable()
export class ScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Scope untuk satu permission dihitung hanya dari grant yang role-nya memberi permission itu.
   * Dengan begitu FINANCE di BR-A + MANAGER di BR-B tidak menghasilkan akses FINANCE di BR-B.
   */
  async resolve(actor: Actor, permission: Permission): Promise<AccessScope> {
    return this.fromGrants(actor.grants.filter((g) => roleHasPermission(g.role, permission)));
  }

  /**
   * Scope dari grant dengan role tertentu saja (mis. langkah approval MANAGER hanya memakai grant MANAGER):
   * role tetap terikat pada scope grant-nya, tidak dipinjam dari grant lain milik actor yang sama.
   */
  async resolveForRole(actor: Pick<Actor, 'grants'>, role: Role): Promise<AccessScope> {
    return this.fromGrants(actor.grants.filter((g) => g.role === role));
  }

  private async fromGrants(grants: Actor['grants']): Promise<AccessScope> {
    if (grants.length === 0) return new AccessScope([], [], []);

    const orgWide = [...new Set(grants.filter((g) => g.unitId === null).map((g) => g.organizationId))];
    const subtreeRoots = grants.filter((g) => g.unitId !== null && g.includeDescendants).map((g) => g.unitId as string);
    const exactUnits = grants.filter((g) => g.unitId !== null && !g.includeDescendants).map((g) => g.unitId as string);

    const rows = await this.prisma.$queryRaw<{ id: string; organization_id: string }[]>`
      WITH RECURSIVE tree AS (
        SELECT u.id, u.organization_id FROM org_units u
        WHERE u.id = ANY(${toUuidArray(subtreeRoots)})
        UNION
        SELECT c.id, c.organization_id FROM org_units c JOIN tree t ON c.parent_id = t.id
      )
      SELECT id, organization_id FROM tree
      UNION
      SELECT id, organization_id FROM org_units WHERE id = ANY(${toUuidArray(exactUnits)})
      UNION
      SELECT id, organization_id FROM org_units WHERE organization_id = ANY(${toUuidArray(orgWide)})`;

    return new AccessScope(
      rows.map((r) => r.id),
      [...rows.map((r) => r.organization_id), ...orgWide],
      orgWide,
    );
  }
}

function toUuidArray(ids: string[]) {
  return Prisma.sql`${ids}::uuid[]`;
}
