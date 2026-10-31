import { HttpException, HttpStatus } from '@nestjs/common';

/** Error domain dengan kode stabil untuk klien: { code, message, details? }. */
export class AppException extends HttpException {
  constructor(status: HttpStatus, code: string, message: string, details?: unknown) {
    super({ code, message, details }, status);
  }
}
