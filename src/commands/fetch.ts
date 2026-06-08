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
