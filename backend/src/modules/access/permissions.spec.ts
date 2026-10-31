import { Role } from '@prisma/client';
import { Permission, ROLE_PERMISSIONS, roleHasPermission } from './permissions';

describe('matriks permission (business-rules §1.2)', () => {
  it('hanya FINANCE yang boleh import dataset dan menjalankan rekonsiliasi', () => {
    const roles = Object.values(Role).filter((r) => roleHasPermission(r, Permission.DatasetImport));
    expect(roles).toEqual([Role.FINANCE]);
    expect(Object.values(Role).filter((r) => roleHasPermission(r, Permission.ReconciliationRun))).toEqual([Role.FINANCE]);
  });

  it('ADMIN tidak mengambil keputusan bisnis', () => {
    for (const p of [Permission.DatasetImport, Permission.ApprovalDecide, Permission.ReviewManage]) {
      expect(roleHasPermission(Role.ADMIN, p)).toBe(false);
    }
  });

  it('REQUESTER hanya membuat/mengajukan (dan membaca miliknya sendiri)', () => {
    expect(ROLE_PERMISSIONS.REQUESTER).toEqual([Permission.ApprovalRequestCreate]);
  });

  it('keputusan approval hanya MANAGER & FINANCE; ADMIN hanya oversight (baca), tanpa keputusan', () => {
    expect(Object.values(Role).filter((r) => roleHasPermission(r, Permission.ApprovalDecide))).toEqual([Role.FINANCE, Role.MANAGER]);
    expect(Object.values(Role).filter((r) => roleHasPermission(r, Permission.ApprovalOversight))).toEqual([Role.ADMIN]);
  });

  it('hanya HR yang mengelola review', () => {
    expect(Object.values(Role).filter((r) => roleHasPermission(r, Permission.ReviewManage))).toEqual([Role.HR]);
  });
});
