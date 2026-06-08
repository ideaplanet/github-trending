import { describe, expect, test } from 'bun:test';
import { computePeriodDate } from '../src/scrape/period-date';

// 2026-06-08 是星期一,UTC
const MON_JUN_8 = Date.UTC(2026, 5, 8, 12, 0, 0) / 1000;
// 2026-06-10 星期三
const WED_JUN_10 = Date.UTC(2026, 5, 10, 12, 0, 0) / 1000;
// 2026-06-14 星期日
const SUN_JUN_14 = Date.UTC(2026, 5, 14, 23, 0, 0) / 1000;

describe('computePeriodDate', () => {
  test('daily on Monday', () => {
    expect(computePeriodDate('daily', MON_JUN_8)).toBe('2026-06-08');
  });

  test('daily on Wednesday', () => {
    expect(computePeriodDate('daily', WED_JUN_10)).toBe('2026-06-10');
  });

  test('weekly on Monday returns same day', () => {
    expect(computePeriodDate('weekly', MON_JUN_8)).toBe('2026-06-08');
  });

  test('weekly on Wednesday returns previous Monday', () => {
    expect(computePeriodDate('weekly', WED_JUN_10)).toBe('2026-06-08');
  });

  test('weekly on Sunday returns previous Monday', () => {
    expect(computePeriodDate('weekly', SUN_JUN_14)).toBe('2026-06-08');
  });

  test('monthly returns first of month', () => {
    expect(computePeriodDate('monthly', WED_JUN_10)).toBe('2026-06-01');
  });

  test('monthly on first of month', () => {
    const t = Date.UTC(2026, 5, 1, 0, 30, 0) / 1000;
    expect(computePeriodDate('monthly', t)).toBe('2026-06-01');
  });
});