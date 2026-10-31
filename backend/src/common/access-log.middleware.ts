import { Logger } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import type { RequestWithId } from './request-id.middleware';

const logger = new Logger('HTTP');
/** Request lebih lambat dari ini dicatat sebagai peringatan. */
export const SLOW_REQUEST_MS = 2000;

/**
 * Satu baris log per request: requestId, method, path (tanpa query), status, durasi. Request yang ditutup klien
 * sebelum respons selesai juga dicatat, agar request "menggantung" dapat ditelusuri lewat x-request-id.
 */
export function accessLogMiddleware(req: RequestWithId, res: Response, next: NextFunction): void {
  const started = process.hrtime.bigint();
  const path = req.originalUrl.split('?')[0];
  const ms = () => Number((process.hrtime.bigint() - started) / 1_000_000n);
  let finished = false;
  res.on('finish', () => {
    finished = true;
    const line = `${req.requestId ?? '-'} ${req.method} ${path} ${res.statusCode} ${ms()}ms`;
    if (ms() >= SLOW_REQUEST_MS) logger.warn(`${line} (lambat)`);
    else logger.log(line);
  });
  res.on('close', () => {
    if (!finished) logger.warn(`${req.requestId ?? '-'} ${req.method} ${path} ditutup klien sebelum respons selesai setelah ${ms()}ms`);
  });
  next();
}
