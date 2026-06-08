import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { and, eq } from 'drizzle-orm';
import { closeDb, openDb, type DB } from '../src/db/client';
import { repo, repoTrending } from '../src/db/schema';
import { writeBatch } from '../src/commands/fetch';
import type { ParsedRow } from '../src/types';

function row(overrides: Partial<ParsedRow> = {}): ParsedRow {
  return {
    full_name: 'karpathy/llm.c',
    owner: 'karpathy',
    name: 'llm.c',
    description: 'LLM training in simple, raw C/CUDA',
    language: 'Cuda',
    language_color: '#3A4E3A',
    stars_at_capture: 12649,
    forks_at_capture: 1156,
    today_star: 2168,
    html_url: 'https://github.com/karpathy/llm.c',
    rank: 1,
    ...overrides,
  };
}

let db: DB;

beforeEach(() => {
  db = openDb(':memory:');
  migrate(db, { migrationsFolder: './src/db/migrations' });
});
afterEach(() => closeDb(db));

describe('writeBatch — first run', () => {
  test('inserts repo and trending rows with is_latest=1, update_count=1', () => {
    const now = 1_749_400_000; // 2025-06-08 something
    writeBatch(db, {
      now,
      parsed: {
        daily: [row({ rank: 1 }), row({ full_name: 'a/b', owner: 'a', name: 'b', rank: 2 })],
        weekly: [row({ rank: 1 })],
        monthly: [row({ rank: 1 })],
      },
    });

    const repoRows = db.select().from(repo).all();
    expect(repoRows.length).toBe(2); // karpathy/llm.c + a/b

    const all = db.select().from(repoTrending).all();
    expect(all.length).toBe(4); // 2 daily + 1 weekly + 1 monthly
    for (const r of all) {
      expect(r.is_latest).toBe(true);
      expect(r.update_count).toBe(1);
      expect(r.first_captured_at).toBe(r.captured_at);
    }
  });
});

describe('writeBatch — same period_date second run (UPSERT)', () => {
  test('row count unchanged; update_count incremented; first_captured_at frozen', () => {
    const t1 = 1_749_400_000;
    const t2 = t1 + 3600; // 一小时后,同一天
    writeBatch(db, {
      now: t1,
      parsed: { daily: [row({ rank: 1, today_star: 100 })], weekly: [], monthly: [] },
    });
    writeBatch(db, {
      now: t2,
      parsed: { daily: [row({ rank: 3, today_star: 250 })], weekly: [], monthly: [] },
    });

    const all = db
      .select()
      .from(repoTrending)
      .where(eq(repoTrending.full_name, 'karpathy/llm.c'))
      .all();
    expect(all.length).toBe(1);
    const r = all[0]!;
    expect(r.is_latest).toBe(true);
    expect(r.update_count).toBe(2);
    expect(r.first_captured_at).toBe(t1);
    expect(r.captured_at).toBe(t2);
    expect(r.rank).toBe(3);
    expect(r.today_star).toBe(250);
  });
});

describe('writeBatch — new period_date flips old is_latest=0', () => {
  test('previous period_date rows become is_latest=0, new ones is_latest=1', () => {
    const day1 = Date.UTC(2026, 5, 8, 12, 0, 0) / 1000;
    const day2 = Date.UTC(2026, 5, 9, 12, 0, 0) / 1000;
    writeBatch(db, {
      now: day1,
      parsed: { daily: [row({ rank: 1 })], weekly: [], monthly: [] },
    });
    writeBatch(db, {
      now: day2,
      parsed: { daily: [row({ rank: 5 })], weekly: [], monthly: [] },
    });

    const day1Rows = db
      .select()
      .from(repoTrending)
      .where(
        and(eq(repoTrending.period, 'daily'), eq(repoTrending.period_date, '2026-06-08')),
      )
      .all();
    const day2Rows = db
      .select()
      .from(repoTrending)
      .where(
        and(eq(repoTrending.period, 'daily'), eq(repoTrending.period_date, '2026-06-09')),
      )
      .all();
    expect(day1Rows.length).toBe(1);
    expect(day1Rows[0]!.is_latest).toBe(false);
    expect(day2Rows.length).toBe(1);
    expect(day2Rows[0]!.is_latest).toBe(true);
  });
});

describe('writeBatch — atomic on partial failure', () => {
  test('throwing inside the batch leaves db unchanged', () => {
    // 第一次写入正常一行
    writeBatch(db, {
      now: 1_749_400_000,
      parsed: { daily: [row({ rank: 1 })], weekly: [], monthly: [] },
    });
    const before = db.select().from(repoTrending).all();

    // 构造一个会失败的批次:第二行 rank=null 触发 NOT NULL 约束错误
    expect(() =>
      writeBatch(db, {
        now: 1_749_400_001,
        parsed: {
          daily: [
            row({ full_name: 'fresh/repo', owner: 'fresh', name: 'repo', rank: 2 }),
            // 显式越过类型系统给一个非法行,触发 NOT NULL 约束错误
            { ...row({ full_name: 'bad/row', owner: 'bad', name: 'row' }), rank: null as unknown as number } as ParsedRow,
          ],
          weekly: [],
          monthly: [],
        },
      }),
    ).toThrow();

    const after = db.select().from(repoTrending).all();
    expect(after).toEqual(before);
  });
});

describe('writeBatch — partial periods do not flip is_latest', () => {
  test('empty period does not mark existing latest rows stale', () => {
    // 先写全部三个 period 的完整快照
    const t1 = Date.UTC(2026, 5, 8, 12, 0, 0) / 1000;
    writeBatch(db, {
      now: t1,
      parsed: {
        daily: [row({ rank: 1 })],
        weekly: [row({ rank: 1 })],
        monthly: [row({ rank: 1 })],
      },
    });

    // 模拟 `fetch --periods daily`:只传 daily,weekly/monthly 为空
    const t2 = t1 + 3600;
    writeBatch(db, {
      now: t2,
      parsed: {
        daily: [row({ rank: 2 })],
        weekly: [],
        monthly: [],
      },
    });

    // weekly 和 monthly 的 is_latest 必须保留为 true,不能被空数组的副作用翻成 false
    const weeklyLatest = db
      .select()
      .from(repoTrending)
      .where(
        and(eq(repoTrending.period, 'weekly'), eq(repoTrending.is_latest, true)),
      )
      .all();
    expect(weeklyLatest.length).toBe(1);

    const monthlyLatest = db
      .select()
      .from(repoTrending)
      .where(
        and(eq(repoTrending.period, 'monthly'), eq(repoTrending.is_latest, true)),
      )
      .all();
    expect(monthlyLatest.length).toBe(1);
  });
});
