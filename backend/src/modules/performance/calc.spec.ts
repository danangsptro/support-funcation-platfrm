import { readFixtureJson } from '../../../test/fixtures/fixtures';
import {
  AssignmentSpan,
  calculateReview,
  Dec,
  employeeDaysByUnit,
  homeUnitForPeriod,
  KpiInput,
  median,
  periodDays,
  rpeMetrics,
  scoreBand,
} from './calc';

const SEP = { startDate: '2026-09-01', endDateExclusive: '2026-10-01' };
const kpi = (over: Partial<KpiInput>): KpiInput => ({ kpiId: 'k', name: 'k', source: 'MANUAL', unitId: null, weight: '100', target: '10', actual: '10', ...over });

describe('skor review vs hr/expected-results.json', () => {
  const expected = readFixtureJson<{ employee_review: { kpi_scores: { id: string; achievement_percent: string; weighted_score: string }[]; total_score: string } }>(
    'hr/expected-results.json',
  );

  it('EMP-1: revenue 15 jt / 20 jt = 75% × 60 = 45; manual 100% × 40 = 40; total 85', () => {
    const r = calculateReview([
      kpi({ kpiId: 'KPI-1', source: 'VERIFIED_UNIT_REVENUE', unitId: 'BR-A', weight: '60', target: '20000000', actual: '15000000' }),
      kpi({ kpiId: 'KPI-2', weight: '40', target: '10', actual: '10' }),
    ]);
    expect(r.items.map((i) => ({ id: i.kpiId, achievement_percent: i.achievement!.toString(), weighted_score: i.weightedScore!.toString() }))).toEqual(
      expected.employee_review.kpi_scores,
    );
    expect(r.totalScore!.toString()).toBe(expected.employee_review.total_score);
    expect(r.problems).toEqual([]);
  });

  it('KPI-CAP: 15/10 = 150% dibatasi 120 → skor 120', () => {
    const r = calculateReview([kpi({ target: '10', actual: '15' })]);
    expect([r.items[0].achievement!.toString(), r.items[0].cappedAchievement!.toString(), r.totalScore!.toString()]).toEqual(['150', '120', '120']);
  });

  it('BAD-WEIGHTS 60 + 30 → masalah WEIGHT_TOTAL_NOT_100; actual kosong → MISSING_ACTUAL & skor null; tanpa KPI → NO_KPI', () => {
    expect(calculateReview([kpi({ weight: '60' }), kpi({ weight: '30' })]).problems).toEqual(['WEIGHT_TOTAL_NOT_100']);
    const missing = calculateReview([kpi({ actual: null })]);
    expect([missing.problems, missing.totalScore]).toEqual([['MISSING_ACTUAL'], null]);
    expect(calculateReview([]).problems).toEqual(['NO_KPI']);
  });

  it('tanpa pembulatan antara: 2/3 × 100 × 50% tetap presisi penuh', () => {
    const r = calculateReview([kpi({ target: '3', actual: '2', weight: '50' }), kpi({ weight: '50' })]);
    expect(r.items[0].weightedScore!.toFixed(10)).toBe('33.3333333333');
    expect(r.totalScore!.toDecimalPlaces(2).toString()).toBe('83.33');
  });

  it('bobot desimal 33.33 + 33.33 + 33.34 = 100 diterima', () => {
    expect(calculateReview([kpi({ weight: '33.33' }), kpi({ weight: '33.33' }), kpi({ weight: '33.34' })]).problems).toEqual([]);
  });
});

describe('employee-days & headcount', () => {
  const fixture = readFixtureJson<{ employee_id: string; unit_id: string; start_date: string; end_date_exclusive: string | null }[]>(
    'seed/employee-assignments.json',
  ).map((a): AssignmentSpan => ({ employeeId: a.employee_id, unitId: a.unit_id, startDate: a.start_date, endDateExclusive: a.end_date_exclusive, isPrimary: true }));
  const hr = readFixtureJson<{ branches: { unit_id: string; employee_days: number; average_headcount: string; verified_revenue: string; rpe: string | null }[]; division: { verified_revenue: string; average_headcount: string; rpe: string } }>(
    'hr/expected-results.json',
  );

  it('fixture: BR-A 60, BR-B 45, BR-ZERO 0 hari; September 30 hari', () => {
    const days = employeeDaysByUnit(fixture, SEP);
    for (const b of hr.branches) expect([b.unit_id, days.get(b.unit_id) ?? 0]).toEqual([b.unit_id, b.employee_days]);
    expect(periodDays(SEP)).toBe(30);
  });

  it('RPE per cabang dan divisi (ratio of sums) sesuai expected; headcount 0 → null', () => {
    const days = employeeDaysByUnit(fixture, SEP);
    for (const b of hr.branches) {
      const m = rpeMetrics(new Dec(b.verified_revenue), new Dec(0), days.get(b.unit_id) ?? 0, 30);
      expect(m.averageHeadcount.toString()).toBe(b.average_headcount);
      expect(m.rpe?.toString() ?? null).toBe(b.rpe);
    }
    const div = rpeMetrics(new Dec(hr.division.verified_revenue), new Dec(0), 60 + 45, 30);
    expect([div.averageHeadcount.toString(), div.rpe!.toString()]).toEqual([hr.division.average_headcount, hr.division.rpe]);
    expect(new Dec('7500000').plus('4000000').div(2).toString()).not.toBe(hr.division.rpe); // bukan rata-rata RPE cabang
  });

  it.each([
    ['masuk tengah periode', { startDate: '2026-09-16', endDateExclusive: null }, 15],
    ['keluar tengah periode (end eksklusif)', { startDate: '2026-08-01', endDateExclusive: '2026-09-11' }, 10],
    ['melewati kedua batas periode', { startDate: '2026-01-01', endDateExclusive: '2027-01-01' }, 30],
    ['berakhir tepat di awal periode', { startDate: '2026-08-01', endDateExclusive: '2026-09-01' }, 0],
    ['mulai tepat di akhir eksklusif', { startDate: '2026-10-01', endDateExclusive: null }, 0],
    ['satu hari', { startDate: '2026-09-30', endDateExclusive: '2026-10-01' }, 1],
  ])('%s → %i hari', (_l, span, days) => {
    const a = { employeeId: 'E', unitId: 'U', isPrimary: true, ...span } as AssignmentSpan;
    expect(employeeDaysByUnit([a], SEP).get('U') ?? 0).toBe(days);
  });

  it('penempatan non-primer tidak dihitung', () => {
    const a: AssignmentSpan = { employeeId: 'E', unitId: 'U', startDate: '2026-09-01', endDateExclusive: null, isPrimary: false };
    expect(employeeDaysByUnit([a], SEP).size).toBe(0);
  });

  it('unit rumah per periode: EMP-3 pindah → BR-B; EMP-1 → BR-A; tanpa penempatan → null', () => {
    const of = (e: string) => fixture.filter((a) => a.employeeId === e);
    expect(homeUnitForPeriod(of('EMP-3'), SEP)).toBe('BR-B');
    expect(homeUnitForPeriod(of('EMP-1'), SEP)).toBe('BR-A');
    expect(homeUnitForPeriod(of('EMP-3'), { startDate: '2026-09-01', endDateExclusive: '2026-09-16' })).toBe('BR-A');
    expect(homeUnitForPeriod(of('EMP-2'), { startDate: '2026-08-01', endDateExclusive: '2026-09-01' })).toBeNull();
  });
});

describe('band & median', () => {
  it('band skor', () => {
    expect(['59.99', '60', '79.99', '80', '99.99', '100', '120'].map((s) => scoreBand(new Dec(s)))).toEqual([
      'BELOW_60', 'FROM_60', 'FROM_60', 'FROM_80', 'FROM_80', 'FROM_100', 'FROM_100',
    ]);
  });
  it('median ganjil/genap/kosong', () => {
    expect(median([new Dec(85), new Dec(120), new Dec(60)])!.toString()).toBe('85');
    expect(median([new Dec(80), new Dec(90)])!.toString()).toBe('85');
    expect(median([])).toBeNull();
  });
});
