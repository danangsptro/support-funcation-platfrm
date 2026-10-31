export type Role = 'ADMIN' | 'HR' | 'FINANCE' | 'MANAGER' | 'REQUESTER';

export interface Grant {
  role: Role;
  includeDescendants: boolean;
  organization: { id: string; code: string; name: string };
  unit: { id: string; code: string; name: string; type: string } | null;
}

export interface UserProfile {
  id: string;
  email: string;
  grants: Grant[];
  permissions: string[];
  /** Hanya dari GET /auth/me. */
  sessionExpiresAt?: string;
}

export interface LoginResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresAt: string;
  user: UserProfile;
}
