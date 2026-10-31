import { IsOptional, IsUUID, Validate, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';
import { isValidIsoDate } from '../../common/dates';
import { PaginationQuery } from '../../common/pagination';

@ValidatorConstraint({ name: 'isoDate' })
class IsoDateConstraint implements ValidatorConstraintInterface {
  validate(value: unknown) {
    return typeof value === 'string' && isValidIsoDate(value);
  }
  defaultMessage() {
    return 'asOf harus tanggal valid berformat YYYY-MM-DD';
  }
}

export class ListEmployeesQuery extends PaginationQuery {
  @IsOptional()
  @IsUUID()
  unitId?: string;
}

export class EmployeeSummaryQuery {
  @IsOptional()
  @Validate(IsoDateConstraint)
  asOf?: string;
}
