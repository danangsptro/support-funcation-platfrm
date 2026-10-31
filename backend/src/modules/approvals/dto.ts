import { ApprovalStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { IsDecimalString } from '../../common/decimal-validator';
import { PaginationQuery } from '../../common/pagination';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const AMOUNT = { min: '0', minExclusive: true, max: '999999999999999999', maxScale: 2 };

export class CreateRequestBody {
  @IsUUID()
  unitId!: string;

  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title!: string;

  @Transform(trim)
  @IsString()
  @MinLength(5, { message: 'Alasan pengajuan minimal 5 karakter' })
  @MaxLength(2000)
  reason!: string;

  @IsDecimalString(AMOUNT)
  amount!: string;
}

/** Hanya untuk DRAFT; setelah submit nominal/unit/alasan tidak bisa diubah (409). */
export class UpdateRequestBody {
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  reason?: string;

  @IsOptional()
  @IsDecimalString(AMOUNT)
  amount?: string;
}

export class ListRequestsQuery extends PaginationQuery {
  /** mine = pengajuan saya; inbox = menunggu tindakan saya; all = semua yang boleh saya lihat. */
  @IsOptional()
  @IsIn(['mine', 'inbox', 'all'])
  view: 'mine' | 'inbox' | 'all' = 'all';

  @IsOptional()
  @IsEnum(ApprovalStatus)
  status?: ApprovalStatus;
}

export class DecisionBody {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class RejectBody {
  @Transform(trim)
  @IsString()
  @MinLength(3, { message: 'Alasan penolakan minimal 3 karakter' })
  @MaxLength(1000)
  comment!: string;
}

export class DelegateBody {
  @IsUUID()
  toUserId!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
