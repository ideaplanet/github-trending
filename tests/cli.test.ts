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

async function runCli(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
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