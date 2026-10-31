import type { Grant, Role } from './types';

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Admin organisasi',
  HR: 'HR',
  FINANCE: 'Finance',
  MANAGER: 'Manager',
  REQUESTER: 'Pengaju anggaran',
};

const UNIT_TYPE_LABEL: Record<string, string> = {
  DIVISION: 'Divisi',
  BRANCH: 'Cabang',
  COST_CENTER: 'Cost center',
};

export function unitTypeLabel(type: string): string {
  return UNIT_TYPE_LABEL[type] ?? type;
}

/** Kalimat ringkas cakupan akses, mis. "Cabang BR-A dan unit di bawahnya · Demo Nusantara". */
export function describeScope(grant: Grant): string {
  const org = grant.organization.name;
  if (!grant.unit) return `Seluruh organisasi ${org}`;
  const unit = `${unitTypeLabel(grant.unit.type)} ${grant.unit.name}`;
  return `${unit}${grant.includeDescendants ? ' dan unit di bawahnya' : ''} · ${org}`;
}
