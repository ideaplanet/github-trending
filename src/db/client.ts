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
  const db = drizzle(raw, { schema }) as unknown as DB;
  db.$raw = raw;
  return db;
}

export function closeDb(db: DB) {
  db.$raw.close();
}
