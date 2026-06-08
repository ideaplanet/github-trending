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
