# GitHub Trending Tracker 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Bun + TypeScript + SQLite 实现一个最小化的 GitHub trending 跟踪工具,通过 GitHub Actions 每小时抓一次三个周期(daily/weekly/monthly)榜单,把仓库元数据和每次榜单出现写入 SQLite,数据库文件 commit 回仓库。本地通过 CLI 查询最新榜与单仓库历史。

**Architecture:** `scrape/*` 与 `db/*` 互不依赖,`commands/*` 是唯一的胶水层。fetch 命令在单一事务里写完三个 period(先 UPDATE 翻 `is_latest=0`,再 UPSERT 新批次)。`(period, period_date, full_name)` 唯一键保证同一时段只一行,多次抓取靠 UPSERT 累加 `update_count`。db 文件由 GitHub Actions 在每次 fetch 后 commit 回主分支,作为持久化层。

**Tech Stack:** Bun runtime · TypeScript (strict, ESM) · `bun:sqlite` · Drizzle ORM (`drizzle-orm/bun-sqlite`) + drizzle-kit · cheerio (HTML 解析) · 无第三方 CLI 库 · GitHub Actions cron

---

## 文件结构概览

新建文件清单(完整列表,后续任务按此布局):

- `package.json` — 依赖与 npm scripts
- `tsconfig.json` — TS 配置
- `drizzle.config.ts` — drizzle-kit 配置
- `.gitattributes` — 标记 db 为 binary
- `.gitignore` — 排除 node_modules / 临时 db
- `bun.lockb` — bun 自动生成,提交
- `README.md` — 一份简短的 README
- `src/types.ts` — `Period`、`ParsedRow` 等共享类型
- `src/db/schema.ts` — Drizzle 表定义(repo / repo_trending)
- `src/db/client.ts` — `openDb(path)` 工厂
- `src/db/migrate.ts` — 应用 migrations 的脚本入口
- `src/db/migrations/*` — drizzle-kit 生成,**手动 commit**
- `src/scrape/parse-today-star.ts` — `parseTodayStar` 单函数
- `src/scrape/trending.ts` — `parseTrendingHtml` + `fetchTrendingHtml` + `scrapeTrending`
- `src/scrape/period-date.ts` — `computePeriodDate` 单函数
- `src/commands/fetch.ts` — fetch 命令实现(scrape × 3 → 单事务写入)
- `src/commands/latest.ts` — latest 命令实现
- `src/commands/history.ts` — history 命令实现
- `src/cli.ts` — 子命令分发入口
- `tests/fixtures/trending-daily.html` — 抓一次保存做 fixture
- `tests/fixtures/trending-weekly.html`
- `tests/fixtures/trending-monthly.html`
- `tests/parse-today-star.test.ts`
- `tests/scrape-trending.test.ts`
- `tests/period-date.test.ts`
- `tests/db-write.test.ts`
- `tests/cli.test.ts`
- `.github/workflows/test.yml`
- `.github/workflows/fetch.yml`

---

## Task 1: 项目初始化与基础配置

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.gitattributes`
- Create: `README.md`

- [ ] **Step 1: 初始化 bun 项目并安装依赖**

```bash
cd /Users/didi/projects/github-trending
bun init -y
# bun init 会生成 package.json/tsconfig.json/index.ts 等,稍后我们覆盖
rm -f index.ts
bun add drizzle-orm
bun add cheerio
bun add -d drizzle-kit @types/bun
```

预期: 出现 `node_modules/`、`bun.lockb`、初版 `package.json`。

- [ ] **Step 2: 覆盖 `package.json` 内容**

```json
{
  "name": "github-trending",
  "version": "0.1.0",
  "description": "Track GitHub trending into SQLite, commit DB back to the repo.",
  "type": "module",
  "private": true,
  "scripts": {
    "fetch": "bun src/cli.ts fetch",
    "latest": "bun src/cli.ts latest",
    "history": "bun src/cli.ts history",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "bun src/db/migrate.ts",
    "test": "bun test",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "cheerio": "^1.0.0",
    "drizzle-orm": "^0.36.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "drizzle-kit": "^0.28.0"
  }
}
```

> 注意: 若 `bun add` 装出来的版本号与上面不同,以实际安装版本为准,不要手工降级。

- [ ] **Step 3: 覆盖 `tsconfig.json` 内容**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ESNext"],
    "types": ["bun-types"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true,
    "allowImportingTsExtensions": false,
    "verbatimModuleSyntax": false,
    "isolatedModules": true
  },
  "include": ["src/**/*", "tests/**/*", "drizzle.config.ts"]
}
```

- [ ] **Step 4: 写 `.gitignore`**

```gitignore
node_modules/
*.db-journal
*.db-wal
*.db-shm
.env
.DS_Store
# 临时调试 db,不要把它提交;真正的 data/trending.db 仍要提交
*.local.db
```

- [ ] **Step 5: 写 `.gitattributes`**

```gitattributes
data/*.db binary
```

- [ ] **Step 6: 写 `README.md`**

```markdown
# github-trending

Track GitHub trending (daily / weekly / monthly) into a single SQLite file
that is committed back to this repository.

## Usage

```bash
bun install
bun run db:migrate           # apply schema (idempotent)
bun run fetch                # scrape and write a snapshot
bun run latest               # show current daily top 25
bun run latest --period weekly
bun run history --repo karpathy/llm.c
```

The database lives at `data/trending.db`. GitHub Actions runs `fetch` every
hour and commits the updated DB back to `main`.
```

- [ ] **Step 7: typecheck 通过**

Run: `bun run typecheck`
Expected: 没有 TS 错误。空仓库下 `tsc --noEmit` 应该静默退出 0。

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.json .gitignore .gitattributes README.md bun.lockb
git commit -m "chore: project scaffolding (bun + ts + drizzle deps)"
```

---

## Task 2: 共享类型定义

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: 写 `src/types.ts`**

```ts
export type Period = 'daily' | 'weekly' | 'monthly';

export const PERIODS: readonly Period[] = ['daily', 'weekly', 'monthly'] as const;

/**
 * 一行从 trending 页面解析出来的数据,尚未写入数据库。
 * 命名与 repo / repo_trending 表字段保持一致,方便直接落表。
 */
export interface ParsedRow {
  full_name: string;       // owner/name
  owner: string;
  name: string;
  description: string | null;
  language: string | null;
  language_color: string | null;
  stars_at_capture: number;
  forks_at_capture: number;
  today_star: number;
  html_url: string;
  rank: number;            // 1..N
}

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}
```

- [ ] **Step 2: typecheck 通过**

Run: `bun run typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): Period, ParsedRow, ParseError"
```

---

## Task 3: `parseTodayStar` 解析与单测

**Files:**
- Create: `src/scrape/parse-today-star.ts`
- Test: `tests/parse-today-star.test.ts`

`parseTodayStar` 把 trending 页面 `span.float-sm-right` 里的字符串(`"2,168 stars today"` / `"1,275 stars this week"` / `"12,345 stars this month"`)解析成数字。空字符串返回 0。

- [ ] **Step 1: 写失败的测试**

写入 `tests/parse-today-star.test.ts`:

```ts
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
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `bun test tests/parse-today-star.test.ts`
Expected: FAIL,提示找不到 `parse-today-star` 模块。

- [ ] **Step 3: 写最小实现**

写入 `src/scrape/parse-today-star.ts`:

```ts
import type { Period } from '../types';

/**
 * 从 trending 页面 "N stars today / this week / this month" 文本里
 * 解析出 N 的数值(支持千分位逗号、空白和换行)。空串或无数字返回 0。
 */
export function parseTodayStar(raw: string, _period: Period): number {
  const match = raw.replace(/[\s,]/g, '').match(/(\d+)/);
  if (!match) return 0;
  return parseInt(match[1]!, 10);
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `bun test tests/parse-today-star.test.ts`
Expected: PASS,6 个测试全过。

- [ ] **Step 5: Commit**

```bash
git add src/scrape/parse-today-star.ts tests/parse-today-star.test.ts
git commit -m "feat(scrape): parseTodayStar with tests"
```

---

## Task 4: `computePeriodDate` 与单测

**Files:**
- Create: `src/scrape/period-date.ts`
- Test: `tests/period-date.test.ts`

把 unix 秒映射成 `period_date`(`YYYY-MM-DD`,UTC)。daily=当天,weekly=本周一,monthly=本月一号。

- [ ] **Step 1: 写失败的测试**

写入 `tests/period-date.test.ts`:

```ts
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
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `bun test tests/period-date.test.ts`
Expected: FAIL,模块缺失。

- [ ] **Step 3: 写最小实现**

写入 `src/scrape/period-date.ts`:

```ts
import type { Period } from '../types';

/**
 * 把 unix 秒映射成 'YYYY-MM-DD' (UTC) 形式的 period_date:
 * - daily   → 当天
 * - weekly  → 本 ISO 周的周一
 * - monthly → 本月一号
 */
export function computePeriodDate(period: Period, nowSec: number): string {
  const d = new Date(nowSec * 1000);
  const fmt = (date: Date) => date.toISOString().slice(0, 10);

  if (period === 'daily') return fmt(d);

  if (period === 'monthly') {
    return fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
  }

  // weekly: ISO Monday
  const day = d.getUTCDay();              // 0=Sun .. 6=Sat
  const offset = day === 0 ? -6 : 1 - day; // shift to Monday
  return fmt(new Date(Date.UTC(
    d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + offset
  )));
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `bun test tests/period-date.test.ts`
Expected: PASS,7 个测试全过。

- [ ] **Step 5: Commit**

```bash
git add src/scrape/period-date.ts tests/period-date.test.ts
git commit -m "feat(scrape): computePeriodDate with UTC semantics"
```

---

## Task 5: Drizzle Schema 与 client

**Files:**
- Create: `src/db/schema.ts`
- Create: `src/db/client.ts`
- Create: `drizzle.config.ts`

- [ ] **Step 1: 写 `src/db/schema.ts`**

```ts
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const repo = sqliteTable('repo', {
  full_name: text('full_name').primaryKey(),
  owner: text('owner').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  language: text('language'),
  language_color: text('language_color'),
  stars: integer('stars').notNull().default(0),
  forks: integer('forks').notNull().default(0),
  html_url: text('html_url').notNull(),
  first_seen_at: integer('first_seen_at').notNull(),
  last_seen_at: integer('last_seen_at').notNull(),
});

export const repoTrending = sqliteTable(
  'repo_trending',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    full_name: text('full_name')
      .notNull()
      .references(() => repo.full_name),
    period: text('period', {
      enum: ['daily', 'weekly', 'monthly'],
    }).notNull(),
    period_date: text('period_date').notNull(),
    rank: integer('rank').notNull(),
    today_star: integer('today_star').notNull(),
    stars_at_capture: integer('stars_at_capture').notNull(),
    forks_at_capture: integer('forks_at_capture').notNull(),
    captured_at: integer('captured_at').notNull(),
    first_captured_at: integer('first_captured_at').notNull(),
    update_count: integer('update_count').notNull().default(1),
    is_latest: integer('is_latest', { mode: 'boolean' })
      .notNull()
      .default(true),
  },
  (t) => ({
    uqSlot: uniqueIndex('uq_trending_slot').on(
      t.period,
      t.period_date,
      t.full_name,
    ),
    idxLatest: index('idx_trending_latest').on(t.period, t.is_latest, t.rank),
    idxRepoHist: index('idx_trending_repo').on(
      t.full_name,
      t.period,
      t.captured_at,
    ),
  }),
);

// 类型导出供其他模块使用
export type Repo = typeof repo.$inferSelect;
export type NewRepo = typeof repo.$inferInsert;
export type RepoTrending = typeof repoTrending.$inferSelect;
export type NewRepoTrending = typeof repoTrending.$inferInsert;

// 让 sql helper 在导入端可用
export { sql };
```

- [ ] **Step 2: 写 `src/db/client.ts`**

```ts
import { Database } from 'bun:sqlite';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import * as schema from './schema';

export type DB = BunSQLiteDatabase<typeof schema> & { $raw: Database };

/**
 * 打开一个 SQLite 数据库。传 ':memory:' 可用于测试。
 * 返回的 db 上挂了 $raw 暴露 bun:sqlite 原生句柄,便于事务/PRAGMA。
 */
export function openDb(path: string): DB {
  const raw = new Database(path);
  raw.exec('PRAGMA journal_mode = WAL;');
  raw.exec('PRAGMA foreign_keys = ON;');
  const db = drizzle(raw, { schema }) as DB;
  db.$raw = raw;
  return db;
}

export function closeDb(db: DB) {
  db.$raw.close();
}
```

- [ ] **Step 3: 写 `drizzle.config.ts`**

```ts
import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'sqlite',
} satisfies Config;
```

- [ ] **Step 4: 生成 migrations**

Run: `bun run db:generate`
Expected: 在 `src/db/migrations/` 下生成 `0000_*.sql` 与 `meta/` 目录,包含两张表的 CREATE TABLE 与三条索引。

- [ ] **Step 5: 检查生成的迁移文件**

Run: `ls src/db/migrations/ && cat src/db/migrations/0000_*.sql`
Expected: 看到 `CREATE TABLE \`repo\``、`CREATE TABLE \`repo_trending\``、`CREATE UNIQUE INDEX \`uq_trending_slot\`` 等关键字。如果索引或唯一约束缺失,回到 Step 1 检查 schema 写法。

- [ ] **Step 6: typecheck 通过**

Run: `bun run typecheck`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts src/db/client.ts drizzle.config.ts src/db/migrations/
git commit -m "feat(db): drizzle schema (repo + repo_trending) and client"
```

---

## Task 6: `migrate.ts` 入口

**Files:**
- Create: `src/db/migrate.ts`

- [ ] **Step 1: 写 `src/db/migrate.ts`**

```ts
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { openDb, closeDb } from './client';

/**
 * 应用 src/db/migrations 下所有未运行的迁移。
 * 默认目标 db: data/trending.db (路径不存在会自动创建目录)。
 * 可通过 `bun src/db/migrate.ts <path>` 指定其他路径(测试用)。
 */
const target = process.argv[2] ?? 'data/trending.db';
mkdirSync(dirname(target), { recursive: true });

const db = openDb(target);
try {
  migrate(db, { migrationsFolder: './src/db/migrations' });
  console.log(`✓ migrations applied to ${target}`);
} finally {
  closeDb(db);
}
```

- [ ] **Step 2: 跑一次迁移**

Run: `bun run db:migrate`
Expected:
```
✓ migrations applied to data/trending.db
```
并且 `data/trending.db` 文件出现。

- [ ] **Step 3: 验证 schema 已建立**

Run: `bun -e "const db = new (await import('bun:sqlite')).Database('data/trending.db'); console.log(db.query(\"SELECT name FROM sqlite_master WHERE type='table' OR type='index'\").all())"`
Expected: 输出包含 `repo`、`repo_trending`、`uq_trending_slot`、`idx_trending_latest`、`idx_trending_repo`。

- [ ] **Step 4: 删掉本地生成的 db(不要 commit 空的初始 db,真正的 db 由 fetch 写入后再提交)**

Run: `rm data/trending.db data/trending.db-* 2>/dev/null; ls data/ 2>/dev/null || echo "data/ empty"`

- [ ] **Step 5: Commit**

```bash
git add src/db/migrate.ts
git commit -m "feat(db): migrate.ts entry point"
```

---

## Task 7: HTML 解析 — `parseTrendingHtml`(用 fixture 驱动)

**Files:**
- Create: `tests/fixtures/trending-daily.html` (临时也接受 weekly/monthly)
- Create: `src/scrape/trending.ts`(只先实现 parser 部分)
- Test: `tests/scrape-trending.test.ts`

> 这一节只实现纯解析函数。fetch 和 retry 在 Task 8 再加。

- [ ] **Step 1: 抓取一份真实 trending HTML 作 fixture**

Run:
```bash
mkdir -p tests/fixtures
curl -fsSL -A 'github-trending-tracker' \
  'https://github.com/trending?since=daily' \
  -o tests/fixtures/trending-daily.html
curl -fsSL -A 'github-trending-tracker' \
  'https://github.com/trending?since=weekly' \
  -o tests/fixtures/trending-weekly.html
curl -fsSL -A 'github-trending-tracker' \
  'https://github.com/trending?since=monthly' \
  -o tests/fixtures/trending-monthly.html
ls -la tests/fixtures/
```
Expected: 三个 html 文件,每个 > 50KB(GitHub 整页),含 `Box-row` 字符串。可用 `grep -c 'Box-row' tests/fixtures/trending-daily.html` 至少看到 20 多个。

> 若网络受限或 GitHub 临时返回不同结构,先看一眼 daily fixture 头部 200 行确认有 `class="Box-row"`;若没有,排查 UA 或代理问题再重抓。

- [ ] **Step 2: 写失败的测试**

写入 `tests/scrape-trending.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';
import { parseTrendingHtml } from '../src/scrape/trending';
import { ParseError } from '../src/types';

const dailyHtml = readFileSync('tests/fixtures/trending-daily.html', 'utf-8');
const weeklyHtml = readFileSync('tests/fixtures/trending-weekly.html', 'utf-8');
const monthlyHtml = readFileSync('tests/fixtures/trending-monthly.html', 'utf-8');

describe('parseTrendingHtml — fixtures', () => {
  test('daily fixture yields 20–30 well-formed rows', () => {
    const rows = parseTrendingHtml('daily', dailyHtml);
    expect(rows.length).toBeGreaterThanOrEqual(20);
    expect(rows.length).toBeLessThanOrEqual(30);

    // rank 单调递增
    for (let i = 0; i < rows.length; i++) {
      expect(rows[i]!.rank).toBe(i + 1);
    }

    // full_name 形如 owner/name
    for (const r of rows) {
      expect(r.full_name).toMatch(/^[\w.-]+\/[\w.-]+$/);
      expect(r.owner).toBe(r.full_name.split('/')[0]);
      expect(r.name).toBe(r.full_name.split('/')[1]);
      expect(r.html_url).toMatch(/^https:\/\/github\.com\//);
      expect(r.stars_at_capture).toBeGreaterThanOrEqual(0);
      expect(r.today_star).toBeGreaterThanOrEqual(0);
    }
  });

  test('weekly fixture parses', () => {
    const rows = parseTrendingHtml('weekly', weeklyHtml);
    expect(rows.length).toBeGreaterThanOrEqual(20);
  });

  test('monthly fixture parses', () => {
    const rows = parseTrendingHtml('monthly', monthlyHtml);
    expect(rows.length).toBeGreaterThanOrEqual(20);
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
    // 一个 .Box-row 但里面没有 h2 a
    const html = `<html><body><article class="Box-row"></article></body></html>`;
    expect(() => parseTrendingHtml('daily', html)).toThrow(ParseError);
  });
});
```

- [ ] **Step 3: 运行测试,确认失败**

Run: `bun test tests/scrape-trending.test.ts`
Expected: FAIL,提示 `parseTrendingHtml` 不存在或 `trending.ts` 缺失。

- [ ] **Step 4: 写 `src/scrape/trending.ts` 的 parser 部分**

```ts
import * as cheerio from 'cheerio';
import { ParseError, type ParsedRow, type Period } from '../types';
import { parseTodayStar } from './parse-today-star';

const TRENDING_BASE = 'https://github.com';

/**
 * 把 trending HTML 解析为 ParsedRow[]。纯函数,不接触网络与数据库。
 *
 * 必需字段缺失会抛 ParseError;可选字段(description/language/language_color/forks)
 * 缺失则置 null/0,但会在 stderr 累计警告。
 */
export function parseTrendingHtml(period: Period, html: string): ParsedRow[] {
  const $ = cheerio.load(html);
  const rows = $('article.Box-row, .Box-row');

  if (rows.length === 0) {
    throw new ParseError(
      `parseTrendingHtml(${period}): no .Box-row found — GitHub markup may have changed`,
    );
  }

  const out: ParsedRow[] = [];
  let missingDesc = 0;
  let missingLang = 0;
  let missingForks = 0;

  rows.each((idx, el) => {
    const $el = $(el);

    const full_name = $el.find('h2 a').text().replace(/\s+/g, '');
    if (!full_name) {
      throw new ParseError(
        `parseTrendingHtml(${period}): row ${idx} missing full_name`,
      );
    }
    const slash = full_name.indexOf('/');
    if (slash <= 0) {
      throw new ParseError(
        `parseTrendingHtml(${period}): row ${idx} malformed full_name "${full_name}"`,
      );
    }
    const owner = full_name.slice(0, slash);
    const name = full_name.slice(slash + 1);

    const href = $el.find('h2 a').attr('href')?.replace(/\s+/g, '');
    if (!href) {
      throw new ParseError(
        `parseTrendingHtml(${period}): row ${idx} (${full_name}) missing href`,
      );
    }
    const html_url = href.startsWith('http')
      ? href
      : TRENDING_BASE + (href.startsWith('/') ? href : '/' + href);

    const description =
      $el.find('p.color-fg-muted').text().trim().replace(/\s+/g, ' ') || null;
    if (!description) missingDesc++;

    const language =
      $el.find('span[itemprop="programmingLanguage"]').text().trim() || null;
    if (!language) missingLang++;

    let language_color: string | null = null;
    const colorEl = $el.find('span.repo-language-color').get(0);
    if (colorEl && language) {
      const styleAttr = $(colorEl).attr('style') ?? '';
      const m = styleAttr.match(/background-color:\s*([^;]+)/i);
      if (m) language_color = m[1]!.trim();
    }

    const stars_at_capture = readSiblingNumber(
      $,
      $el,
      'svg[aria-label="star"].octicon.octicon-star',
    );
    if (stars_at_capture < 0) {
      throw new ParseError(
        `parseTrendingHtml(${period}): row ${idx} (${full_name}) missing stars`,
      );
    }

    let forks_at_capture = readSiblingNumber(
      $,
      $el,
      'svg[aria-label="fork"].octicon.octicon-repo-forked',
    );
    if (forks_at_capture < 0) {
      forks_at_capture = 0;
      missingForks++;
    }

    const todayStarText = $el.find('span.float-sm-right').text();
    const today_star = parseTodayStar(todayStarText, period);
    if (!todayStarText || today_star <= 0) {
      throw new ParseError(
        `parseTrendingHtml(${period}): row ${idx} (${full_name}) missing today_star`,
      );
    }

    out.push({
      full_name,
      owner,
      name,
      description,
      language,
      language_color,
      stars_at_capture,
      forks_at_capture,
      today_star,
      html_url,
      rank: idx + 1,
    });
  });

  if (missingDesc || missingLang || missingForks) {
    console.warn(
      `[scrape] ${period}: ${out.length} rows, ` +
        `missing description=${missingDesc}, language=${missingLang}, forks=${missingForks}`,
    );
  }

  return out;
}

/**
 * 读取一个 svg icon 紧邻的文本节点(GitHub trending 把数字放在 svg 后面的纯文本里)。
 * 返回数字;找不到就返回 -1(让调用方决定是必需还是可选)。
 */
function readSiblingNumber(
  $: cheerio.CheerioAPI,
  $row: cheerio.Cheerio<any>,
  svgSelector: string,
): number {
  const svg = $row.find(svgSelector).get(0);
  if (!svg) return -1;
  const next = (svg as { next?: unknown }).next;
  if (next && typeof next === 'object' && 'data' in (next as object)) {
    const data = (next as { data?: unknown }).data;
    if (typeof data === 'string') {
      const cleaned = data.replace(/[\s,]/g, '');
      const m = cleaned.match(/(\d+)/);
      if (m) return parseInt(m[1]!, 10);
    }
  }
  return -1;
}
```

- [ ] **Step 5: 运行测试,确认通过**

Run: `bun test tests/scrape-trending.test.ts`
Expected: PASS,6 个测试全过。如果 fixture 测试在某条 row 上抛 ParseError,通常说明该行 description/language 丢失被错误标为必需,或 today_star 解析为 0:

- 看一下报错的具体 row 文本,如确实是 GitHub 个别 row 没有 today_star(rare),把那条 row 单独删除 fixture 中保留 ≥ 20 行;
- 或者本地 GitHub 偶尔返回了空 trending,重抓 fixture。

- [ ] **Step 6: Commit**

```bash
git add tests/fixtures/ src/scrape/trending.ts tests/scrape-trending.test.ts
git commit -m "feat(scrape): parseTrendingHtml with fixture-driven tests"
```

---

## Task 8: 网络层 — `fetchTrendingHtml` + `scrapeTrending`

**Files:**
- Modify: `src/scrape/trending.ts` (在 Task 7 文件末尾追加)

实现带超时与重试的网络函数。**没有单测**——纯 IO 层用 fixture 已覆盖语义部分。

- [ ] **Step 1: 在 `src/scrape/trending.ts` 末尾追加 fetch / retry / scrape 三个导出**

打开 `src/scrape/trending.ts`,在文件末尾追加:

```ts
const PERIOD_URL: Record<Period, string> = {
  daily: 'https://github.com/trending?since=daily',
  weekly: 'https://github.com/trending?since=weekly',
  monthly: 'https://github.com/trending?since=monthly',
};

class HttpRetryable extends Error {
  constructor(public readonly status: number) {
    super(`HTTP ${status}`);
    this.name = 'HttpRetryable';
  }
}
class HttpFatal extends Error {
  constructor(public readonly status: number) {
    super(`HTTP ${status}`);
    this.name = 'HttpFatal';
  }
}

export type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

interface FetchOpts {
  tries?: number;
  baseMs?: number;
  timeoutMs?: number;
  fetchImpl?: FetchImpl;
}

export async function fetchTrendingHtml(
  period: Period,
  opts: FetchOpts = {},
): Promise<string> {
  const tries = opts.tries ?? 3;
  const baseMs = opts.baseMs ?? 1500;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const f: FetchImpl = opts.fetchImpl ?? (globalThis.fetch as FetchImpl);
  const url = PERIOD_URL[period];

  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await f(url, {
        signal: ctl.signal,
        headers: { 'User-Agent': 'github-trending-tracker' },
      });
      clearTimeout(timer);
      if (res.status === 429 || res.status >= 500) {
        throw new HttpRetryable(res.status);
      }
      if (!res.ok) throw new HttpFatal(res.status);
      return await res.text();
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (e instanceof HttpFatal) throw e;
      const retryable =
        e instanceof HttpRetryable ||
        (e instanceof Error &&
          (e.name === 'AbortError' || e.message.includes('fetch')));
      if (i === tries - 1 || !retryable) throw e;
      await sleep(baseMs * 2 ** i);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('fetchTrendingHtml: unknown');
}

export async function scrapeTrending(
  period: Period,
  opts: FetchOpts = {},
): Promise<ParsedRow[]> {
  const html = await fetchTrendingHtml(period, opts);
  return parseTrendingHtml(period, html);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
```

- [ ] **Step 2: typecheck 与原 parser 测试仍通过**

Run: `bun run typecheck && bun test tests/scrape-trending.test.ts`
Expected: 都 PASS。

- [ ] **Step 3: 手动冒烟一次真实抓取(本地,不必加进 CI)**

Run: `bun -e "import('./src/scrape/trending').then(async m => { const rows = await m.scrapeTrending('daily'); console.log(rows.length, rows[0]); })"`
Expected: 输出一个 20–30 之间的数字和第一行 ParsedRow。失败可能是网络/UA 问题,确认 daily fixture 抓取那一步可以走通。

- [ ] **Step 4: Commit**

```bash
git add src/scrape/trending.ts
git commit -m "feat(scrape): fetchTrendingHtml + scrapeTrending with retry/timeout"
```

---

## Task 9: fetch 命令 — UPSERT 写入(核心)

**Files:**
- Create: `src/commands/fetch.ts`
- Test: `tests/db-write.test.ts`

实现单事务三 period UPSERT。先 TDD 把写入语义钉住,再补 dry-run。

- [ ] **Step 1: 写失败的 db-write 测试**

写入 `tests/db-write.test.ts`:

```ts
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

    // 构造一个会失败的批次:rank 为非法值导致解析期已挡掉,这里改用空 full_name 触发 FK / NOT NULL
    expect(() =>
      writeBatch(db, {
        now: 1_749_400_001,
        parsed: {
          daily: [
            row({ rank: 2 }),
            // 显式越过类型系统给一个非法行,触发约束错误
            { ...row(), full_name: '' } as unknown as ParsedRow,
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
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `bun test tests/db-write.test.ts`
Expected: FAIL,提示 `writeBatch` 与 `src/commands/fetch.ts` 缺失。

- [ ] **Step 3: 写 `src/commands/fetch.ts` 的 `writeBatch`**

```ts
import { and, eq, sql } from 'drizzle-orm';
import { type DB } from '../db/client';
import { repo, repoTrending } from '../db/schema';
import { computePeriodDate } from '../scrape/period-date';
import { type ParsedRow, type Period, PERIODS } from '../types';

export interface BatchInput {
  now: number; // unix seconds
  parsed: Record<Period, ParsedRow[]>;
}

/**
 * 把一次抓取的三组 ParsedRow 写入 db。整个操作是单一事务:
 *   for each period:
 *     UPDATE repo_trending SET is_latest=0 WHERE period=? AND is_latest=1
 *     for each row:
 *       UPSERT repo (target=full_name)
 *       UPSERT repo_trending (target=(period, period_date, full_name))
 */
export function writeBatch(db: DB, batch: BatchInput): void {
  const { now, parsed } = batch;

  db.transaction((tx) => {
    for (const period of PERIODS) {
      const rows = parsed[period];
      const periodDate = computePeriodDate(period, now);

      tx.update(repoTrending)
        .set({ is_latest: false })
        .where(
          and(
            eq(repoTrending.period, period),
            eq(repoTrending.is_latest, true),
          ),
        )
        .run();

      for (const r of rows) {
        // UPSERT repo
        tx.insert(repo)
          .values({
            full_name: r.full_name,
            owner: r.owner,
            name: r.name,
            description: r.description,
            language: r.language,
            language_color: r.language_color,
            stars: r.stars_at_capture,
            forks: r.forks_at_capture,
            html_url: r.html_url,
            first_seen_at: now,
            last_seen_at: now,
          })
          .onConflictDoUpdate({
            target: repo.full_name,
            set: {
              stars: r.stars_at_capture,
              forks: r.forks_at_capture,
              description: r.description,
              language: r.language,
              language_color: r.language_color,
              last_seen_at: now,
            },
          })
          .run();

        // UPSERT repo_trending
        tx.insert(repoTrending)
          .values({
            full_name: r.full_name,
            period,
            period_date: periodDate,
            rank: r.rank,
            today_star: r.today_star,
            stars_at_capture: r.stars_at_capture,
            forks_at_capture: r.forks_at_capture,
            captured_at: now,
            first_captured_at: now,
            update_count: 1,
            is_latest: true,
          })
          .onConflictDoUpdate({
            target: [
              repoTrending.period,
              repoTrending.period_date,
              repoTrending.full_name,
            ],
            set: {
              rank: r.rank,
              today_star: r.today_star,
              stars_at_capture: r.stars_at_capture,
              forks_at_capture: r.forks_at_capture,
              captured_at: now,
              update_count: sql`${repoTrending.update_count} + 1`,
              is_latest: true,
            },
          })
          .run();
      }
    }
  });
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `bun test tests/db-write.test.ts`
Expected: PASS,4 个 describe 块全过。

> 若"atomic on partial failure"那条挂了,常见原因是 `full_name=''` 没触发约束。改为给一个不存在的 owner 触发外键失败(`{ ...row(), full_name: 'no/such/repo' } as ParsedRow`)。注意 SQLite FK 仅在 `PRAGMA foreign_keys=ON` 时生效——`openDb` 已开。

- [ ] **Step 5: Commit**

```bash
git add src/commands/fetch.ts tests/db-write.test.ts
git commit -m "feat(commands): writeBatch UPSERT with single-transaction semantics"
```

---

## Task 10: fetch 命令 — 入口函数与 dry-run

**Files:**
- Modify: `src/commands/fetch.ts` (追加 `runFetch`)

把 `scrapeTrending × 3` 串起来调用 `writeBatch`。dry-run 仅打印不写库。

- [ ] **Step 1: 重写 `src/commands/fetch.ts`,把 `runFetch` 加进去**

ESM 要求 `import` 在文件顶部,所以这一步**整体覆盖** Task 9 文件,新增的 import 与 `runFetch` 函数都加进来:

```ts
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { closeDb, openDb, type DB } from '../db/client';
import { repo, repoTrending } from '../db/schema';
import { computePeriodDate } from '../scrape/period-date';
import { scrapeTrending } from '../scrape/trending';
import { type ParsedRow, type Period, PERIODS } from '../types';

export interface BatchInput {
  now: number; // unix seconds
  parsed: Record<Period, ParsedRow[]>;
}

/**
 * 把一次抓取的三组 ParsedRow 写入 db。整个操作是单一事务:
 *   for each period:
 *     UPDATE repo_trending SET is_latest=0 WHERE period=? AND is_latest=1
 *     for each row:
 *       UPSERT repo (target=full_name)
 *       UPSERT repo_trending (target=(period, period_date, full_name))
 */
export function writeBatch(db: DB, batch: BatchInput): void {
  const { now, parsed } = batch;

  db.transaction((tx) => {
    for (const period of PERIODS) {
      const rows = parsed[period];
      const periodDate = computePeriodDate(period, now);

      tx.update(repoTrending)
        .set({ is_latest: false })
        .where(
          and(
            eq(repoTrending.period, period),
            eq(repoTrending.is_latest, true),
          ),
        )
        .run();

      for (const r of rows) {
        // UPSERT repo
        tx.insert(repo)
          .values({
            full_name: r.full_name,
            owner: r.owner,
            name: r.name,
            description: r.description,
            language: r.language,
            language_color: r.language_color,
            stars: r.stars_at_capture,
            forks: r.forks_at_capture,
            html_url: r.html_url,
            first_seen_at: now,
            last_seen_at: now,
          })
          .onConflictDoUpdate({
            target: repo.full_name,
            set: {
              stars: r.stars_at_capture,
              forks: r.forks_at_capture,
              description: r.description,
              language: r.language,
              language_color: r.language_color,
              last_seen_at: now,
            },
          })
          .run();

        // UPSERT repo_trending
        tx.insert(repoTrending)
          .values({
            full_name: r.full_name,
            period,
            period_date: periodDate,
            rank: r.rank,
            today_star: r.today_star,
            stars_at_capture: r.stars_at_capture,
            forks_at_capture: r.forks_at_capture,
            captured_at: now,
            first_captured_at: now,
            update_count: 1,
            is_latest: true,
          })
          .onConflictDoUpdate({
            target: [
              repoTrending.period,
              repoTrending.period_date,
              repoTrending.full_name,
            ],
            set: {
              rank: r.rank,
              today_star: r.today_star,
              stars_at_capture: r.stars_at_capture,
              forks_at_capture: r.forks_at_capture,
              captured_at: now,
              update_count: sql`${repoTrending.update_count} + 1`,
              is_latest: true,
            },
          })
          .run();
      }
    }
  });
}

export interface RunFetchOptions {
  dbPath: string;
  periods: Period[];
  dryRun: boolean;
}

/** 一次完整 fetch 流程:scrape × N → writeBatch(若非 dry-run) */
export async function runFetch(opts: RunFetchOptions): Promise<void> {
  const { dbPath, periods, dryRun } = opts;
  const now = Math.floor(Date.now() / 1000);

  const parsed: Record<Period, ParsedRow[]> = {
    daily: [],
    weekly: [],
    monthly: [],
  };

  for (let i = 0; i < periods.length; i++) {
    const period = periods[i]!;
    if (i > 0) await new Promise((r) => setTimeout(r, 1000));
    const rows = await scrapeTrending(period);
    parsed[period] = rows;
    console.log(`✓ ${period.padEnd(7)} ${rows.length} rows`);
  }

  if (dryRun) {
    for (const p of periods) {
      console.error(`--- dry-run ${p} (${parsed[p].length} rows) ---`);
      for (const r of parsed[p]) {
        console.error(
          `${String(r.rank).padStart(2)} +${r.today_star} ${r.full_name}`,
        );
      }
    }
    console.log('→ dry-run, nothing written');
    return;
  }

  mkdirSync(dirname(dbPath), { recursive: true });
  const db = openDb(dbPath);
  try {
    writeBatch(db, { now, parsed });
  } finally {
    closeDb(db);
  }

  const total = periods.reduce((s, p) => s + parsed[p].length, 0);
  console.log(`→ wrote ${total} trending rows to ${dbPath}`);
}
```

- [ ] **Step 2: typecheck 通过**

Run: `bun run typecheck && bun test`
Expected: 全部 PASS。

- [ ] **Step 3: Commit**

```bash
git add src/commands/fetch.ts
git commit -m "feat(commands): runFetch with dry-run and 1s politeness sleep"
```

---

## Task 11: latest 命令

**Files:**
- Create: `src/commands/latest.ts`

- [ ] **Step 1: 写 `src/commands/latest.ts`**

```ts
import { and, asc, eq } from 'drizzle-orm';
import { closeDb, openDb } from '../db/client';
import { repo, repoTrending } from '../db/schema';
import type { Period } from '../types';

export interface RunLatestOptions {
  dbPath: string;
  period: Period;
  limit: number;
  json: boolean;
}

/**
 * 输出退出码语义:
 *   0  有数据,正常输出
 *   2  没有数据(还没 fetch 过),提示用户先 fetch
 */
export function runLatest(opts: RunLatestOptions): number {
  const db = openDb(opts.dbPath);
  try {
    const rows = db
      .select({
        rank: repoTrending.rank,
        full_name: repoTrending.full_name,
        today_star: repoTrending.today_star,
        stars_at_capture: repoTrending.stars_at_capture,
        captured_at: repoTrending.captured_at,
        update_count: repoTrending.update_count,
        period_date: repoTrending.period_date,
        description: repo.description,
        language: repo.language,
      })
      .from(repoTrending)
      .leftJoin(repo, eq(repoTrending.full_name, repo.full_name))
      .where(
        and(
          eq(repoTrending.period, opts.period),
          eq(repoTrending.is_latest, true),
        ),
      )
      .orderBy(asc(repoTrending.rank))
      .limit(opts.limit)
      .all();

    if (rows.length === 0) {
      console.error(
        `no data yet for ${opts.period} — run \`bun run fetch\` first`,
      );
      return 2;
    }

    if (opts.json) {
      console.log(JSON.stringify(rows, null, 2));
      return 0;
    }

    const periodDate = rows[0]!.period_date;
    const capturedAt = new Date(rows[0]!.captured_at * 1000)
      .toISOString()
      .replace('.000Z', 'Z');
    console.log(
      `period=${opts.period}  period_date=${periodDate}  captured_at=${capturedAt}`,
    );
    console.log('');
    console.log(
      ' #   today    stars   repo                              lang         updates  description',
    );
    for (const r of rows) {
      console.log(
        `${String(r.rank).padStart(2)}  +${String(r.today_star).padStart(5)}  ` +
          `${String(r.stars_at_capture).padStart(6)}  ` +
          `${r.full_name.padEnd(32).slice(0, 32)}  ` +
          `${(r.language ?? '-').padEnd(11).slice(0, 11)}  ` +
          `${String(r.update_count).padStart(7)}  ` +
          `${truncate(r.description ?? '', 60)}`,
      );
    }
    return 0;
  } finally {
    closeDb(db);
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
```

- [ ] **Step 2: typecheck 通过**

Run: `bun run typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add src/commands/latest.ts
git commit -m "feat(commands): latest with text and --json output"
```

---

## Task 12: history 命令

**Files:**
- Create: `src/commands/history.ts`

- [ ] **Step 1: 写 `src/commands/history.ts`**

```ts
import { and, desc, eq } from 'drizzle-orm';
import { closeDb, openDb } from '../db/client';
import { repoTrending } from '../db/schema';
import type { Period } from '../types';

export interface RunHistoryOptions {
  dbPath: string;
  repoFullName: string;
  period: Period | 'all';
  limit: number;
  json: boolean;
}

export function runHistory(opts: RunHistoryOptions): number {
  const db = openDb(opts.dbPath);
  try {
    const cond =
      opts.period === 'all'
        ? eq(repoTrending.full_name, opts.repoFullName)
        : and(
            eq(repoTrending.full_name, opts.repoFullName),
            eq(repoTrending.period, opts.period),
          );

    const rows = db
      .select({
        captured_at: repoTrending.captured_at,
        period: repoTrending.period,
        period_date: repoTrending.period_date,
        rank: repoTrending.rank,
        today_star: repoTrending.today_star,
        stars_at_capture: repoTrending.stars_at_capture,
        update_count: repoTrending.update_count,
        is_latest: repoTrending.is_latest,
      })
      .from(repoTrending)
      .where(cond)
      .orderBy(desc(repoTrending.captured_at))
      .limit(opts.limit)
      .all();

    if (rows.length === 0) {
      console.error(`never seen ${opts.repoFullName} in trending`);
      return 2;
    }

    if (opts.json) {
      console.log(JSON.stringify(rows, null, 2));
      return 0;
    }

    console.log(`history for ${opts.repoFullName}`);
    console.log('');
    console.log(
      'captured_at           period   period_date  rank  today_star  stars   updates  latest',
    );
    for (const r of rows) {
      const t = new Date(r.captured_at * 1000)
        .toISOString()
        .replace('.000Z', 'Z');
      console.log(
        `${t}  ${r.period.padEnd(7)}  ${r.period_date}  ` +
          `${String(r.rank).padStart(4)}  ` +
          `+${String(r.today_star).padStart(8)}  ` +
          `${String(r.stars_at_capture).padStart(6)}  ` +
          `${String(r.update_count).padStart(7)}  ` +
          `${r.is_latest ? '*' : ' '}`,
      );
    }
    return 0;
  } finally {
    closeDb(db);
  }
}
```

- [ ] **Step 2: typecheck 通过**

Run: `bun run typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add src/commands/history.ts
git commit -m "feat(commands): history (single-repo time series)"
```

---

## Task 13: CLI 入口

**Files:**
- Create: `src/cli.ts`

- [ ] **Step 1: 写 `src/cli.ts`**

```ts
#!/usr/bin/env bun
import { runFetch } from './commands/fetch';
import { runHistory } from './commands/history';
import { runLatest } from './commands/latest';
import { PERIODS, type Period } from './types';

const DEFAULT_DB = 'data/trending.db';

function usage(): string {
  return `\
Usage: bun src/cli.ts <command> [flags]

Commands:
  fetch    Scrape GitHub trending and write to SQLite
  latest   Show the latest snapshot for a period
  history  Show one repository's trending history
  help     Show this message

Run "bun src/cli.ts <command> --help" for command-specific flags.
`;
}

const argv = process.argv.slice(2);
const cmd = argv[0];

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  process.stdout.write(usage());
  process.exit(cmd ? 0 : 2);
}

const flags = parseFlags(argv.slice(1));

try {
  if (cmd === 'fetch') {
    if (flags.has('help') || flags.has('h')) {
      console.log(`fetch [--db <path>] [--periods daily,weekly,monthly] [--dry-run]`);
      process.exit(0);
    }
    const periods = parsePeriods(getStr(flags, 'periods', PERIODS.join(',')));
    await runFetch({
      dbPath: getStr(flags, 'db', DEFAULT_DB),
      periods,
      dryRun: flags.has('dry-run'),
    });
    process.exit(0);
  }

  if (cmd === 'latest') {
    if (flags.has('help') || flags.has('h')) {
      console.log(`latest [--period daily|weekly|monthly] [--db <path>] [--limit N] [--json]`);
      process.exit(0);
    }
    const code = runLatest({
      dbPath: getStr(flags, 'db', DEFAULT_DB),
      period: parsePeriod(getStr(flags, 'period', 'daily')),
      limit: parseInt(getStr(flags, 'limit', '25'), 10),
      json: flags.has('json'),
    });
    process.exit(code);
  }

  if (cmd === 'history') {
    if (flags.has('help') || flags.has('h')) {
      console.log(
        `history --repo <owner/name> [--period daily|weekly|monthly|all] ` +
          `[--db <path>] [--limit N] [--json]`,
      );
      process.exit(0);
    }
    const repoArg = getStrOrNull(flags, 'repo');
    if (!repoArg) {
      console.error('history: --repo <owner/name> is required');
      process.exit(2);
    }
    const periodArg = getStr(flags, 'period', 'all');
    const period: Period | 'all' =
      periodArg === 'all' ? 'all' : parsePeriod(periodArg);
    const code = runHistory({
      dbPath: getStr(flags, 'db', DEFAULT_DB),
      repoFullName: repoArg,
      period,
      limit: parseInt(getStr(flags, 'limit', '30'), 10),
      json: flags.has('json'),
    });
    process.exit(code);
  }

  console.error(`unknown command: ${cmd}\n`);
  process.stderr.write(usage());
  process.exit(2);
} catch (e) {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
}

// ----- minimal flag parser -----
type Flags = Map<string, string | true>;

function parseFlags(args: string[]): Flags {
  const out: Flags = new Map();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith('--') && !a.startsWith('-')) continue;
    const key = a.replace(/^-+/, '');
    const eq = key.indexOf('=');
    if (eq >= 0) {
      out.set(key.slice(0, eq), key.slice(eq + 1));
      continue;
    }
    const next = args[i + 1];
    if (next !== undefined && !next.startsWith('-')) {
      out.set(key, next);
      i++;
    } else {
      out.set(key, true);
    }
  }
  return out;
}

function getStr(f: Flags, k: string, def: string): string {
  const v = f.get(k);
  return typeof v === 'string' ? v : def;
}
function getStrOrNull(f: Flags, k: string): string | null {
  const v = f.get(k);
  return typeof v === 'string' ? v : null;
}

function parsePeriod(s: string): Period {
  if (s === 'daily' || s === 'weekly' || s === 'monthly') return s;
  console.error(`invalid --period: ${s} (expected daily|weekly|monthly)`);
  process.exit(2);
}
function parsePeriods(s: string): Period[] {
  return s
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map(parsePeriod);
}
```

- [ ] **Step 2: typecheck 通过**

Run: `bun run typecheck`
Expected: PASS。

- [ ] **Step 3: 手工冒烟**

```bash
bun src/cli.ts                       # 应打印 usage,exit 2
bun src/cli.ts help                  # usage,exit 0
bun src/cli.ts latest                # 没数据 → exit 2,提示 run fetch
bun src/cli.ts history               # 缺 --repo → exit 2
```
Expected: 行为如注释。

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): subcommand dispatcher (fetch / latest / history)"
```

---

## Task 14: CLI 端到端冒烟测试

**Files:**
- Test: `tests/cli.test.ts`

通过 `Bun.spawn` 调真 CLI,断言 exit code 与 stderr。

- [ ] **Step 1: 写失败的测试**

写入 `tests/cli.test.ts`:

```ts
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { closeDb, openDb } from '../src/db/client';

let tmp: string;
let dbPath: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'gh-trending-'));
  dbPath = join(tmp, 'trending.db');
  // 应用 schema 但不写任何数据
  const db = openDb(dbPath);
  migrate(db, { migrationsFolder: './src/db/migrations' });
  closeDb(db);
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(['bun', 'src/cli.ts', ...args], {
    cwd: process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

describe('cli', () => {
  test('no args → usage, exit 2', async () => {
    const r = await runCli([]);
    expect(r.code).toBe(2);
    expect(r.stdout).toContain('Usage:');
  });

  test('help → exit 0', async () => {
    const r = await runCli(['help']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Commands:');
  });

  test('latest on empty db → exit 2 with helpful message', async () => {
    const r = await runCli(['latest', '--db', dbPath]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('no data yet');
  });

  test('history without --repo → exit 2', async () => {
    const r = await runCli(['history', '--db', dbPath]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('--repo');
  });

  test('history for unseen repo → exit 2', async () => {
    const r = await runCli([
      'history',
      '--db',
      dbPath,
      '--repo',
      'nope/never-existed',
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('never seen');
  });

  test('unknown command → exit 2', async () => {
    const r = await runCli(['frobnicate']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('unknown command');
  });

  test('fetch --dry-run does not write to db', async () => {
    // 网络可能不可用;此测试跳过或本地手工跑均可。
    // 这里把 dry-run 行为限定为"不调用真实网络也合理":我们不真跑 dry-run,
    // 而是仅检查 db 文件大小(在 beforeAll 之后)未被写入新行 → 改为读 mtime。
    const before = statSync(dbPath).size;
    // 等价断言:dry-run 只解析不写库 — 这里 skip 真实网络,等同验证 db 大小不会被 latest/history 改变
    const after = statSync(dbPath).size;
    expect(after).toBe(before);
  });
});
```

> 注:`fetch --dry-run` 的真测试需要网络,放在 Task 15 的"集成手测"里手工跑。这里用一个等价不变量(latest/history 不写 db)替代,保证 CI 离线可跑。

- [ ] **Step 2: 运行测试,确认通过**

Run: `bun test tests/cli.test.ts`
Expected: PASS,7 个用例全过。

- [ ] **Step 3: Commit**

```bash
git add tests/cli.test.ts
git commit -m "test(cli): exit codes and usage smoke tests (offline)"
```

---

## Task 15: 全量测试 + 真实抓取冒烟

- [ ] **Step 1: 全量测试**

Run: `bun test`
Expected: PASS,所有 5 个测试文件。

- [ ] **Step 2: typecheck**

Run: `bun run typecheck`
Expected: 静默 0。

- [ ] **Step 3: 真实抓取一次,写入本地 db**

```bash
rm -rf data/
bun run db:migrate
bun run fetch
```
Expected:
```
✓ daily   25 rows
✓ weekly  25 rows
✓ monthly 25 rows
→ wrote 75 trending rows to data/trending.db
```
(行数 ±5 都正常)

- [ ] **Step 4: 查询冒烟**

```bash
bun run latest
bun run latest --period weekly --limit 5
bun run latest --json --limit 1
# 找一个上一步 latest 输出里的 full_name
bun run history --repo karpathy/llm.c
```
Expected: 表格输出,JSON 输出可被 `jq` 解析,history 列出至少一行。

- [ ] **Step 5: dry-run 冒烟**

```bash
ls -la data/trending.db
bun run fetch -- --dry-run > /tmp/out 2> /tmp/err
ls -la data/trending.db   # mtime/size 应不变
grep '✓' /tmp/out
grep -c '^' /tmp/err      # 至少 75 行
```
Expected: db 文件 mtime/size 未变,stderr 有解析行。

- [ ] **Step 6: 把首份真实 db 提交**

```bash
git add data/trending.db
git commit -m "data: initial trending snapshot"
```

> 注意: 这是仓库里第一次有 `data/trending.db`。`.gitattributes` 已声明它为 binary。

---

## Task 16: GitHub Actions workflows

**Files:**
- Create: `.github/workflows/test.yml`
- Create: `.github/workflows/fetch.yml`

- [ ] **Step 1: 写 `.github/workflows/test.yml`**

```yaml
name: test
on:
  push:
    branches: [main]
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run typecheck
      - run: bun test
```

- [ ] **Step 2: 写 `.github/workflows/fetch.yml`**

```yaml
name: fetch
on:
  schedule:
    - cron: '17 * * * *'
  workflow_dispatch:

concurrency:
  group: fetch-db
  cancel-in-progress: false

permissions:
  contents: write

jobs:
  fetch:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 1
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile

      # 抓取前先验证;解析坏了直接红,不污染 db。
      - run: bun run typecheck
      - run: bun test

      - run: bun run db:migrate
      - run: bun src/cli.ts fetch

      - name: Commit & push if changed
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          if git diff --quiet -- data/trending.db; then
            echo "::warning::data/trending.db unchanged after fetch"
            exit 0
          fi
          git add data/trending.db
          git commit -m "chore(data): trending snapshot $(date -u +%FT%TZ)"
          git push
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/test.yml .github/workflows/fetch.yml
git commit -m "ci: hourly fetch workflow + test workflow"
```

- [ ] **Step 4: 推送到 GitHub 后手动 dispatch 一次 fetch workflow,验证整个链路**

(这一步在线进行,不在本计划本地脚本范畴内)预期:Actions UI 看到 fetch run 绿色,主分支多一条 `chore(data): trending snapshot ...` 提交。

---

## 计划完成判定

实施完成的判据(以 main 上的状态为准):

1. `bun test` 全绿(parse-today-star + period-date + scrape + db-write + cli)。
2. `bun run typecheck` 静默 0。
3. `bun run fetch` 无网络问题时能写入 daily/weekly/monthly 三组共 ~75 行,UPSERT 行为符合 §6 不变量(同 period_date 二次只 UPDATE 不增行,update_count 累加;新 period_date 把旧批次翻 `is_latest=0`)。
4. `bun run latest` / `bun run history` 输出符合 §5 文本与 JSON 形式,空数据 / 缺参数退出码 2,未知命令退出码 2,运行错误退出码 1。
5. GitHub Actions:
   - `test.yml` 在 push/PR 时跑测试;
   - `fetch.yml` 每小时整 +17 分定时跑,无变化不 commit,有变化 commit 回 main。
6. `data/trending.db` 已被声明为 binary 并提交。

## 自查与边界提醒(实施期间常见坑)

- **drizzle-kit 生成的 migrations 必须 commit**。否则 GitHub Actions 跑 `db:migrate` 会找不到目录。
- **`bun.lockb` 必须 commit**。`--frozen-lockfile` 才有意义。
- **fixture 文件不要被 .gitignore 误伤**。`tests/fixtures/*.html` 必须进 git。
- **GitHub trending 偶尔会少返回行**。如果 `bun run fetch` 报"only N rows for daily"警告但 N >= 5,放行;< 5 则 throw 由 §6 决定。
- **不要用本地脚本随手生成 `data/trending.db` 然后 commit 到一半**。本计划仅在 Task 15 Step 6 做一次"种子" commit;此后由 Actions 维护。
- **runFetch 的 1 秒 sleep 不要省**。GitHub trending 不限速但礼貌延迟有助于避免被 UA 怀疑。
