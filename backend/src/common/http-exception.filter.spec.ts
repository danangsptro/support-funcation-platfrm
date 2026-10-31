import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { AppException } from './app-exception';
import { toErrorBody } from './http-exception.filter';

describe('format error API', () => {
  it('memakai kode default per status', () => {
    expect(toErrorBody(new NotFoundException('Tidak ditemukan'), 'r1')).toEqual({
      status: 404,
      body: { code: 'NOT_FOUND', message: 'Tidak ditemukan', requestId: 'r1' },
    });
    expect(toErrorBody(new ConflictException(), 'r2').body.code).toBe('CONFLICT');
  });

  it('meneruskan kode domain dan details untuk 4xx', () => {
    const err = new AppException(HttpStatus.BAD_REQUEST, 'INVALID_DATE', 'Tanggal tidak valid', [{ row: 2 }]);
    expect(toErrorBody(err, 'r3')).toEqual({
      status: 400,
      body: { code: 'INVALID_DATE', message: 'Tanggal tidak valid', requestId: 'r3', details: [{ row: 2 }] },
    });
  });

  it('menggabungkan pesan validasi array', () => {
    const err = new BadRequestException({ message: ['a wajib', 'b wajib'] });
    expect(toErrorBody(err, 'r4').body.message).toBe('a wajib; b wajib');
  });

  it('tidak membocorkan pesan/stack error tak terduga', () => {
    const result = toErrorBody(new Error('password=rahasia at db.ts:10'), 'r5');
    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).not.toContain('rahasia');
    expect(result.body).toEqual({ code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan pada server', requestId: 'r5' });
  });

  it('5xx HttpException biasa disanitasi, AppException 503 tetap informatif', () => {
    expect(toErrorBody(new InternalServerErrorException('query gagal: secret'), 'r6').body.message).toBe(
      'Terjadi kesalahan pada server',
    );
    const ready = new AppException(HttpStatus.SERVICE_UNAVAILABLE, 'NOT_READY', 'Database tidak tersedia', { db: 'down' });
    expect(toErrorBody(ready, 'r7').body).toEqual({
      code: 'NOT_READY',
      message: 'Database tidak tersedia',
      requestId: 'r7',
      details: { db: 'down' },
    });
  });
});
