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
