import * as cheerio from 'cheerio';
import { ParseError, type ParsedRow, type Period } from '../types';
import { parseTodayStar } from './parse-today-star';

const TRENDING_BASE = 'https://github.com';

/**
 * 把 trending HTML 解析为 ParsedRow[]。纯函数,不接触网络与数据库。
 *
 * 必需字段缺失会抛 ParseError;可选字段(description/language/language_color/forks)
 * 缺失则置 null/0,但会在 stderr 累计警告。
 */
export function parseTrendingHtml(period: Period, html: string): ParsedRow[] {
  const $ = cheerio.load(html);
  const rows = $('article.Box-row, .Box-row');

  if (rows.length === 0) {
    throw new ParseError(
      `parseTrendingHtml(${period}): no .Box-row found — GitHub markup may have changed`,
    );
  }

  const out: ParsedRow[] = [];
  let missingDesc = 0;
  let missingLang = 0;
  let missingForks = 0;

  rows.each((idx, el) => {
    const $el = $(el);

    const full_name = $el.find('h2 a').text().replace(/\s+/g, '');
    if (!full_name) {
      throw new ParseError(
        `parseTrendingHtml(${period}): row ${idx} missing full_name`,
      );
    }
    const slash = full_name.indexOf('/');
    if (slash <= 0) {
      throw new ParseError(
        `parseTrendingHtml(${period}): row ${idx} malformed full_name "${full_name}"`,
      );
    }
    const owner = full_name.slice(0, slash);
    const name = full_name.slice(slash + 1);

    const href = $el.find('h2 a').attr('href')?.replace(/\s+/g, '');
    if (!href) {
      throw new ParseError(
        `parseTrendingHtml(${period}): row ${idx} (${full_name}) missing href`,
      );
    }
    const html_url = href.startsWith('http')
      ? href
      : TRENDING_BASE + (href.startsWith('/') ? href : '/' + href);

    const description =
      $el.find('p.color-fg-muted').text().trim().replace(/\s+/g, ' ') || null;
    if (!description) missingDesc++;

    const language =
      $el.find('span[itemprop="programmingLanguage"]').text().trim() || null;
    if (!language) missingLang++;

    let language_color: string | null = null;
    const colorEl = $el.find('span.repo-language-color').get(0);
    if (colorEl && language) {
      const styleAttr = $(colorEl).attr('style') ?? '';
      const m = styleAttr.match(/background-color:\s*([^;]+)/i);
      if (m) language_color = m[1]!.trim();
    }

    const stars_at_capture = readSiblingNumber(
      $,
      $el,
      'svg[aria-label="star"].octicon.octicon-star',
    );
    if (stars_at_capture < 0) {
      throw new ParseError(
        `parseTrendingHtml(${period}): row ${idx} (${full_name}) missing stars`,
      );
    }

    let forks_at_capture = readSiblingNumber(
      $,
      $el,
      'svg[aria-label="fork"].octicon.octicon-repo-forked',
    );
    if (forks_at_capture < 0) {
      forks_at_capture = 0;
      missingForks++;
    }

    const todayStarText = $el.find('span.float-sm-right').text();
    const today_star = parseTodayStar(todayStarText, period);
    if (!todayStarText || today_star <= 0) {
      throw new ParseError(
        `parseTrendingHtml(${period}): row ${idx} (${full_name}) missing today_star`,
      );
    }

    out.push({
      full_name,
      owner,
      name,
      description,
      language,
      language_color,
      stars_at_capture,
      forks_at_capture,
      today_star,
      html_url,
      rank: idx + 1,
    });
  });

  if (missingDesc || missingLang || missingForks) {
    console.warn(
      `[scrape] ${period}: ${out.length} rows, ` +
        `missing description=${missingDesc}, language=${missingLang}, forks=${missingForks}`,
    );
  }

  return out;
}

/**
 * 读取一个 svg icon 紧邻的文本节点(GitHub trending 把数字放在 svg 后面的纯文本里)。
 * 返回数字;找不到就返回 -1(让调用方决定是必需还是可选)。
 */
function readSiblingNumber(
  $: cheerio.CheerioAPI,
  $row: cheerio.Cheerio<any>,
  svgSelector: string,
): number {
  const svg = $row.find(svgSelector).get(0);
  if (!svg) return -1;
  const next = (svg as { next?: unknown }).next;
  if (next && typeof next === 'object' && 'data' in (next as object)) {
    const data = (next as { data?: unknown }).data;
    if (typeof data === 'string') {
      const cleaned = data.replace(/[\s,]/g, '');
      const m = cleaned.match(/(\d+)/);
      if (m) return parseInt(m[1]!, 10);
    }
  }
  return -1;
}
