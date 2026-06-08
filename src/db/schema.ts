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
