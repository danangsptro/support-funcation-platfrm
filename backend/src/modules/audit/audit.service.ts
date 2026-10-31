import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export interface AuditInput {
  organizationId: string;
  entityType: string;
  entityId: string;
  actorUserId: string | null;
  eventType: string;
  payload?: Prisma.InputJsonValue;
  traceId?: string;
}

/** Audit ditulis di transaksi yang sama dengan perubahan bisnis (append-only di DB). */
@Injectable()
export class AuditService {
  async record(tx: Prisma.TransactionClient, input: AuditInput): Promise<void> {
    await tx.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        entityType: input.entityType,
        entityId: input.entityId,
        actorUserId: input.actorUserId,
        eventType: input.eventType,
        payload: input.payload ?? {},
        traceId: input.traceId,
      },
    });
  }
}
