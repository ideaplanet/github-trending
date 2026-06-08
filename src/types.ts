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
