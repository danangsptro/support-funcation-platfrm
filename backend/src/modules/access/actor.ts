import { Role } from '@prisma/client';

export interface ActorGrant {
  role: Role;
  organizationId: string;
  unitId: string | null;
  includeDescendants: boolean;
}

/** Identitas tepercaya yang dimuat ulang dari database setiap request (bukan dari payload klien). */
export interface Actor {
  userId: string;
  email: string;
  grants: ActorGrant[];
}
