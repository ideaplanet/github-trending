import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';
import { parseTrendingHtml } from '../src/scrape/trending';
import { ParseError } from '../src/types';

const dailyHtml = readFileSync('tests/fixtures/trending-daily.html', 'utf-8');
const weeklyHtml = readFileSync('tests/fixtures/trending-weekly.html', 'utf-8');
const monthlyHtml = readFileSync('tests/fixtures/trending-monthly.html', 'utf-8');

describe('parseTrendingHtml — fixtures', () => {
  test('daily fixture yields well-formed rows', () => {
    const rows = parseTrendingHtml('daily', dailyHtml);
    // GitHub trending currently serves 16–25 rows depending on day.
    expect(rows.length).toBeGreaterThanOrEqual(10);
    expect(rows.length).toBeLessThanOrEqual(30);

    // rank 单调递增
    for (let i = 0; i < rows.length; i++) {
      expect(rows[i]!.rank).toBe(i + 1);
    }

    // full_name 形如 owner/name
    for (const r of rows) {
      expect(r.full_name).toMatch(/^[\w.-]+\/[\w.-]+$/);
      const [owner, name] = r.full_name.split('/');
      expect(r.owner).toBe(owner!);
      expect(r.name).toBe(name!);
      expect(r.html_url).toMatch(/^https:\/\/github\.com\//);
      expect(r.stars_at_capture).toBeGreaterThanOrEqual(0);
      expect(r.today_star).toBeGreaterThanOrEqual(0);
    }
  });

  test('weekly fixture parses', () => {
    const rows = parseTrendingHtml('weekly', weeklyHtml);
    expect(rows.length).toBeGreaterThanOrEqual(10);
  });

  test('monthly fixture parses', () => {
    const rows = parseTrendingHtml('monthly', monthlyHtml);
    expect(rows.length).toBeGreaterThanOrEqual(10);
  });
});

describe('parseTrendingHtml — error cases', () => {
  test('empty html throws ParseError', () => {
    expect(() => parseTrendingHtml('daily', '<html></html>')).toThrow(ParseError);
  });

  test('html without Box-row throws ParseError', () => {
    expect(() =>
      parseTrendingHtml('daily', '<html><body><h1>nothing</h1></body></html>'),
    ).toThrow(ParseError);
  });

  test('row missing required full_name throws ParseError', () => {
    const html = `<html><body><article class="Box-row"></article></body></html>`;
    expect(() => parseTrendingHtml('daily', html)).toThrow(ParseError);
  });
});
