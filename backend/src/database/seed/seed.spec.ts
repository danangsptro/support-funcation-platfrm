import { StepConditionType } from '@prisma/client';
import { fixtureId } from './ids';
import { parseStepCondition } from './seed';

describe('seed helpers', () => {
  it('UUID fixture deterministik dan berbeda per jenis', () => {
    expect(fixtureId('org-unit', 'ORG-1', 'BR-A')).toBe(fixtureId('org-unit', 'ORG-1', 'BR-A'));
    expect(fixtureId('org-unit', 'ORG-1', 'BR-A')).not.toBe(fixtureId('org-unit', 'ORG-2', 'BR-A'));
    expect(fixtureId('grant', 'ADMIN', 'ADMIN', 'ORG-1', null)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('parse kondisi workflow fixture', () => {
    expect(parseStepCondition('always')).toEqual({ type: StepConditionType.ALWAYS, amount: null });
    expect(parseStepCondition('amount > 10000000')).toEqual({ type: StepConditionType.AMOUNT_GT, amount: '10000000' });
    expect(() => parseStepCondition('amount >= 5')).toThrow(/tidak dikenal/);
  });
});
