import { HttpStatus, ValidationError, ValidationPipe } from '@nestjs/common';
import { AppException } from './app-exception';

/** Body/query diubah ke DTO; field tak dikenal ditolak (mis. organizationId sisipan klien). */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors: ValidationError[]) =>
      new AppException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Input tidak valid', flatten(errors)),
  });
}

function flatten(errors: ValidationError[], prefix = ''): { field: string; messages: string[] }[] {
  return errors.flatMap((e) => {
    const field = prefix ? `${prefix}.${e.property}` : e.property;
    const own = e.constraints ? [{ field, messages: Object.values(e.constraints) }] : [];
    return [...own, ...flatten(e.children ?? [], field)];
  });
}
