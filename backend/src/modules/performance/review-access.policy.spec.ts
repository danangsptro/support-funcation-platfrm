import { AccessScope } from '../access/scope.service';
import { ReviewAccessPolicy } from './review-access.policy';

describe('ReviewAccessPolicy (fungsi murni)', () => {
  const exactBrA = new AccessScope(['BR-A'], ['ORG-1'], []);
  const brAWithChildren = new AccessScope(['BR-A', 'CC-A'], ['ORG-1'], []);

  it('sumber harus seluruhnya dalam scope; grant tanpa turunan tidak mencakup CC-A', () => {
    expect(ReviewAccessPolicy.covers(exactBrA, ['BR-A', 'CC-A'])).toBe(false);
    expect(ReviewAccessPolicy.covers(brAWithChildren, ['BR-A', 'CC-A'])).toBe(true);
    expect(ReviewAccessPolicy.covers(exactBrA, [])).toBe(true); // tanpa KPI revenue
  });

  it('unit snapshot dibaca dari provenance; provenance kosong/rusak → tanpa sumber', () => {
    expect(ReviewAccessPolicy.snapshotUnits({ revenueSources: [{ unitIds: ['BR-A', 'CC-A'] }, { unitIds: ['BR-A'] }] })).toEqual(['BR-A', 'CC-A', 'BR-A']);
    expect(ReviewAccessPolicy.snapshotUnits({})).toEqual([]);
    expect(ReviewAccessPolicy.snapshotUnits(null)).toEqual([]);
  });
});
