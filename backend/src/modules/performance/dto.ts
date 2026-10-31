import { KpiSource } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, Validate, ValidateIf, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';
import { isValidIsoDate } from '../../common/dates';
import { IsDecimalString } from '../../common/decimal-validator';

@ValidatorConstraint({ name: 'isoDate' })
class IsoDate implements ValidatorConstraintInterface {
  validate(v: unknown) {
    return typeof v === 'string' && isValidIsoDate(v);
  }
  defaultMessage() {
    return 'tanggal harus valid berformat YYYY-MM-DD';
  }
}

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreatePeriodBody {
  @Transform(trim)
  @Matches(/^[A-Z0-9][A-Z0-9-]{1,31}$/, { message: 'code 2–32 karakter: huruf besar, angka, strip (mis. PERIOD-OKT)' })
  code!: string;

  @Validate(IsoDate)
  startDate!: string;

  @Validate(IsoDate)
  endDateExclusive!: string;

  /** Wajib hanya bila actor punya hak HR di lebih dari satu organisasi. */
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}

export class CreateKpiBody {
  @IsUUID()
  employeeId!: string;

  @IsUUID()
  periodId!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsEnum(KpiSource)
  source!: KpiSource;

  /** Wajib untuk VERIFIED_UNIT_REVENUE; harus kosong untuk MANUAL. */
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @IsDecimalString({ min: '0', minExclusive: true, max: '100', maxScale: 2 })
  weight!: string;

  @IsDecimalString({ min: '0', minExclusive: true, maxScale: 4 })
  target!: string;

  /** Hanya untuk MANUAL. null/kosong = belum diisi. */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsDecimalString({ min: '0', maxScale: 4 })
  actual?: string | null;
}

export class UpdateKpiBody {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsDecimalString({ min: '0', minExclusive: true, max: '100', maxScale: 2 })
  weight?: string;

  @IsOptional()
  @IsDecimalString({ min: '0', minExclusive: true, maxScale: 4 })
  target?: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsDecimalString({ min: '0', maxScale: 4 })
  actual?: string | null;
}

export class CalculateBody {
  @IsUUID()
  employeeId!: string;

  @IsUUID()
  periodId!: string;
}

export class PeriodQuery {
  @IsUUID()
  periodId!: string;

  /** Mempersempit ke unit (dan turunannya) — tidak pernah memperluas scope. */
  @IsOptional()
  @IsUUID()
  unitId?: string;
}
