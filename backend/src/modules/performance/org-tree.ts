import { PrismaService } from '../../database/prisma.service';

export interface TreeUnit {
  id: string;
  code: string;
  name: string;
  type: string;
  parentId: string | null;
}

/** Pohon unit satu organisasi (kecil; dimuat utuh) untuk menghitung turunan. */
export class OrgTree {
  private readonly children = new Map<string, string[]>();
  constructor(readonly units: Map<string, TreeUnit>) {
    for (const u of units.values()) {
      if (!u.parentId) continue;
      this.children.set(u.parentId, [...(this.children.get(u.parentId) ?? []), u.id]);
    }
  }

  static async load(prisma: Pick<PrismaService, 'orgUnit'>, organizationId: string): Promise<OrgTree> {
    const rows = await prisma.orgUnit.findMany({
      where: { organizationId },
      select: { id: true, externalKey: true, name: true, type: true, parentId: true },
    });
    return new OrgTree(new Map(rows.map((r) => [r.id, { id: r.id, code: r.externalKey, name: r.name, type: r.type, parentId: r.parentId }])));
  }

  /** Unit beserta seluruh turunannya. */
  subtree(id: string): string[] {
    const out = [id];
    for (const c of this.children.get(id) ?? []) out.push(...this.subtree(c));
    return out;
  }

  hasChildren(id: string): boolean {
    return (this.children.get(id) ?? []).length > 0;
  }
}
