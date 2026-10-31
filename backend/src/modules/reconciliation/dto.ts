import { MatchStatus, TransactionSide } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsUUID, Matches } from 'class-validator';
import { PaginationQuery } from '../../common/pagination';
import { RULE_VERSIONS } from './rules';

export const MATCH_REASONS = ['DUPLICATE_REFERENCE', 'NO_INTERNAL', 'NO_EXTERNAL', 'AMOUNT_DIFFERENCE', 'DATE_OUTSIDE_TOLERANCE'];

/** Field multipart bersama file CSV. Organisasi diturunkan dari unit, bukan dari klien. */
export class ImportDatasetBody {
  @IsUUID()
  unitId!: string;

  @Matches(/^[A-Za-z0-9._-]{1,64}$/, { message: 'accountId hanya huruf, angka, titik, garis bawah, strip (maks. 64)' })
  accountId!: string;

  @IsEnum(TransactionSide)
  side!: TransactionSide;
}

export class ListDatasetsQuery extends PaginationQuery {
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @IsOptional()
  @IsEnum(TransactionSide)
  side?: TransactionSide;
}

export class CreateRunBody {
  @IsUUID()
  internalDatasetId!: string;

  @IsUUID()
  externalDatasetId!: string;

  @IsIn(RULE_VERSIONS, { message: `ruleVersion harus salah satu: ${RULE_VERSIONS.join(', ')}` })
  ruleVersion!: string;
}

export class ListRunsQuery extends PaginationQuery {
  @IsOptional()
  @IsUUID()
  unitId?: string;
}

export class ListResultsQuery extends PaginationQuery {
  @IsOptional()
  @IsEnum(MatchStatus)
  status?: MatchStatus;

  @IsOptional()
  @IsIn(MATCH_REASONS)
  reason?: string;
}
