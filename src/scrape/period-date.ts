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
