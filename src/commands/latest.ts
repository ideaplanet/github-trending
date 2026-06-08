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
