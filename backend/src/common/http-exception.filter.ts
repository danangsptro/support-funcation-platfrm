import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { AppException } from './app-exception';
import type { RequestWithId } from './request-id.middleware';

const DEFAULT_CODES: Record<number, string> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  503: 'SERVICE_UNAVAILABLE',
};

export interface ErrorBody {
  code: string;
  message: string;
  requestId: string | undefined;
  details?: unknown;
}

/** Semua error menjadi { code, message, requestId, details? } tanpa stack trace atau secret. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<RequestWithId>();
    const res = ctx.getResponse<Response>();
    const { status, body } = toErrorBody(exception, req.requestId);
    if (status >= 500) {
      this.logger.error(
        `${req.method} ${req.originalUrl} -> ${status} [${req.requestId}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }
    res.status(status).json(body);
  }
}

export function toErrorBody(exception: unknown, requestId: string | undefined): { status: number; body: ErrorBody } {
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const response = exception.getResponse();
    const fallbackCode = DEFAULT_CODES[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'ERROR');
    if (typeof response === 'object' && response !== null) {
      const r = response as { code?: unknown; message?: unknown; details?: unknown };
      const message = Array.isArray(r.message) ? r.message.join('; ') : String(r.message ?? exception.message);
      // 5xx dari AppException disengaja (mis. NOT_READY) dan aman; 5xx lain disanitasi.
      const sanitize = status >= 500 && !(exception instanceof AppException);
      const body: ErrorBody = {
        code: typeof r.code === 'string' ? r.code : fallbackCode,
        message: sanitize ? 'Terjadi kesalahan pada server' : message,
        requestId,
      };
      if (r.details !== undefined && !sanitize) body.details = r.details;
      return { status, body };
    }
    return { status, body: { code: fallbackCode, message: String(response), requestId } };
  }
  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    body: { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan pada server', requestId },
  };
}
