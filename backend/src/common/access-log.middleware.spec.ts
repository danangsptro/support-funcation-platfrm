import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { accessLogMiddleware } from './access-log.middleware';
import type { RequestWithId } from './request-id.middleware';

describe('accessLogMiddleware', () => {
  const setup = () => {
    const req = { requestId: 'req-1', method: 'GET', originalUrl: '/api/v1/approval-requests/options?x=1' } as RequestWithId;
    const res = Object.assign(new EventEmitter(), { statusCode: 200 }) as unknown as Response;
    const next = jest.fn() as NextFunction;
    accessLogMiddleware(req, res, next);
    return { res, next };
  };
  afterEach(() => jest.restoreAllMocks());

  it('mencatat requestId, method, path tanpa query, status, dan durasi saat respons selesai', () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const { res, next } = setup();
    expect(next).toHaveBeenCalled();
    res.emit('finish');
    res.emit('close');
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^req-1 GET \/api\/v1\/approval-requests\/options 200 \d+ms$/));
  });

  it('request yang ditutup klien sebelum selesai dicatat sebagai peringatan', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { res } = setup();
    res.emit('close');
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^req-1 GET \/api\/v1\/approval-requests\/options ditutup klien sebelum respons selesai/));
  });
});
