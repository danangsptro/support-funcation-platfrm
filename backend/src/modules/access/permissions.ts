import { Role } from '@prisma/client';

/**
 * Permission aplikasi. Role hanya bermakna bersama scope grant-nya: scope untuk sebuah
 * permission dihitung HANYA dari grant yang role-nya memberi permission tersebut.
 */
export const Permission = {
  OrgRead: 'org.read',
  OrgManage: 'org.manage',
  EmployeeRead: 'employee.read',
  ReviewManage: 'review.manage',
  PerformanceAnalyticsRead: 'analytics.performance.read',
  RevenueAnalyticsRead: 'analytics.rpe.read',
  DatasetImport: 'dataset.import',
  ReconciliationRun: 'reconciliation.run',
  ReconciliationRead: 'reconciliation.read',
  ReconciliationSummaryRead: 'reconciliation.summary.read',
  /** Membuat & mengajukan pengajuan; membaca pengajuan SENDIRI. */
  ApprovalRequestCreate: 'approval.request.create',
  /** Memutuskan/mendelegasikan langkah — hanya langkah yang role-nya sama dengan grant & scope-nya mencakup unit. */
  ApprovalDecide: 'approval.decide',
  /** Izin eksplisit membaca semua pengajuan tersubmit + audit dalam scope, TANPA hak memutuskan. */
  ApprovalOversight: 'approval.oversight',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

/** Matriks docs/business-rules.md §1.2. ADMIN tidak mengambil keputusan bisnis. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: [
    Permission.OrgRead,
    Permission.OrgManage,
    Permission.EmployeeRead,
    Permission.PerformanceAnalyticsRead,
    Permission.RevenueAnalyticsRead,
    Permission.ReconciliationRead,
    Permission.ReconciliationSummaryRead,
    Permission.ApprovalOversight,
  ],
  HR: [
    Permission.OrgRead,
    Permission.EmployeeRead,
    Permission.ReviewManage,
    Permission.PerformanceAnalyticsRead,
    Permission.RevenueAnalyticsRead,
  ],
  FINANCE: [
    Permission.OrgRead,
    Permission.EmployeeRead,
    Permission.RevenueAnalyticsRead,
    Permission.DatasetImport,
    Permission.ReconciliationRun,
    Permission.ReconciliationRead,
    Permission.ReconciliationSummaryRead,
    Permission.ApprovalDecide,
  ],
  MANAGER: [
    Permission.OrgRead,
    Permission.EmployeeRead,
    Permission.PerformanceAnalyticsRead,
    Permission.RevenueAnalyticsRead,
    Permission.ReconciliationSummaryRead,
    Permission.ApprovalDecide,
  ],
  REQUESTER: [Permission.ApprovalRequestCreate],
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
