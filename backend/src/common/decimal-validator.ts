import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';
import Decimal from 'decimal.js';

export interface DecimalRule {
  min?: string;
  /** true: nilai harus > min (bukan ≥). */
  minExclusive?: boolean;
  max?: string;
  maxScale?: number;
}

const DECIMAL = /^-?\d{1,18}(\.\d+)?$/;

/** String desimal (API nominal/bobot) dengan batas nilai & jumlah desimal. Tidak menerima number/float. */
export function IsDecimalString(rule: DecimalRule, options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isDecimalString',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string' || !DECIMAL.test(value)) return false;
          const d = new Decimal(value);
          if (rule.maxScale !== undefined && d.decimalPlaces() > rule.maxScale) return false;
          if (rule.min !== undefined && (rule.minExclusive ? d.lessThanOrEqualTo(rule.min) : d.lessThan(rule.min))) return false;
          if (rule.max !== undefined && d.greaterThan(rule.max)) return false;
          return true;
        },
        defaultMessage(args: ValidationArguments) {
          const parts = ['string desimal'];
          if (rule.min !== undefined) parts.push(`${rule.minExclusive ? '>' : '≥'} ${rule.min}`);
          if (rule.max !== undefined) parts.push(`≤ ${rule.max}`);
          if (rule.maxScale !== undefined) parts.push(`maks. ${rule.maxScale} desimal`);
          return `${args.property} harus ${parts.join(', ')}`;
        },
      },
    });
}
