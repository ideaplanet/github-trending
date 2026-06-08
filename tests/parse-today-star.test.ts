import { describe, expect, test } from 'bun:test';
import { parseTodayStar } from '../src/scrape/parse-today-star';

describe('parseTodayStar', () => {
  test('daily', () => {
    expect(parseTodayStar('2168 stars today', 'daily')).toBe(2168);
  });

  test('weekly with thousands separator', () => {
    expect(parseTodayStar('1,275 stars this week', 'weekly')).toBe(1275);
  });

  test('monthly with thousands separator', () => {
    expect(parseTodayStar('12,345 stars this month', 'monthly')).toBe(12345);
  });

  test('empty string returns 0', () => {
    expect(parseTodayStar('', 'daily')).toBe(0);
  });

  test('whitespace and newlines are ignored', () => {
    expect(parseTodayStar('  2,168  stars\n today  ', 'daily')).toBe(2168);
  });

  test('no number returns 0', () => {
    expect(parseTodayStar('stars today', 'daily')).toBe(0);
  });
});
