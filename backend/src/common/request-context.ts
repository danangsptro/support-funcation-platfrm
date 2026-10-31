import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { RequestWithId } from './request-id.middleware';

/** ID request (x-request-id) untuk dicatat pada audit event. */
export const RequestId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<RequestWithId>().requestId,
);
