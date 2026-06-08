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
