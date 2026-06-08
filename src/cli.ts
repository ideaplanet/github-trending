#!/usr/bin/env bun
import { runFetch } from './commands/fetch';
import { runHistory } from './commands/history';
import { runLatest } from './commands/latest';
import { PERIODS, type Period } from './types';

const DEFAULT_DB = 'data/trending.db';

function usage(): string {
  return `\
Usage: bun src/cli.ts <command> [flags]

Commands:
  fetch    Scrape GitHub trending and write to SQLite
  latest   Show the latest snapshot for a period
  history  Show one repository's trending history
  help     Show this message

Run "bun src/cli.ts <command> --help" for command-specific flags.
`;
}

const argv = process.argv.slice(2);
const cmd = argv[0];

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  process.stdout.write(usage());
  process.exit(cmd ? 0 : 2);
}

const flags = parseFlags(argv.slice(1));

try {
  if (cmd === 'fetch') {
    if (flags.has('help') || flags.has('h')) {
      console.log(`fetch [--db <path>] [--periods daily,weekly,monthly] [--dry-run]`);
      process.exit(0);
    }
    const periods = parsePeriods(getStr(flags, 'periods', PERIODS.join(',')));
    await runFetch({
      dbPath: getStr(flags, 'db', DEFAULT_DB),
      periods,
      dryRun: flags.has('dry-run'),
    });
    process.exit(0);
  }

  if (cmd === 'latest') {
    if (flags.has('help') || flags.has('h')) {
      console.log(`latest [--period daily|weekly|monthly] [--db <path>] [--limit N] [--json]`);
      process.exit(0);
    }
    const code = runLatest({
      dbPath: getStr(flags, 'db', DEFAULT_DB),
      period: parsePeriod(getStr(flags, 'period', 'daily')),
      limit: parseInt(getStr(flags, 'limit', '25'), 10),
      json: flags.has('json'),
    });
    process.exit(code);
  }

  if (cmd === 'history') {
    if (flags.has('help') || flags.has('h')) {
      console.log(
        `history --repo <owner/name> [--period daily|weekly|monthly|all] ` +
          `[--db <path>] [--limit N] [--json]`,
      );
      process.exit(0);
    }
    const repoArg = getStrOrNull(flags, 'repo');
    if (!repoArg) {
      console.error('history: --repo <owner/name> is required');
      process.exit(2);
    }
    const periodArg = getStr(flags, 'period', 'all');
    const period: Period | 'all' =
      periodArg === 'all' ? 'all' : parsePeriod(periodArg);
    const code = runHistory({
      dbPath: getStr(flags, 'db', DEFAULT_DB),
      repoFullName: repoArg,
      period,
      limit: parseInt(getStr(flags, 'limit', '30'), 10),
      json: flags.has('json'),
    });
    process.exit(code);
  }

  console.error(`unknown command: ${cmd}\n`);
  process.stderr.write(usage());
  process.exit(2);
} catch (e) {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
}

// ----- minimal flag parser -----
type Flags = Map<string, string | true>;

function parseFlags(args: string[]): Flags {
  const out: Flags = new Map();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith('--') && !a.startsWith('-')) continue;
    const key = a.replace(/^-+/, '');
    const eq = key.indexOf('=');
    if (eq >= 0) {
      out.set(key.slice(0, eq), key.slice(eq + 1));
      continue;
    }
    const next = args[i + 1];
    if (next !== undefined && !next.startsWith('-')) {
      out.set(key, next);
      i++;
    } else {
      out.set(key, true);
    }
  }
  return out;
}

function getStr(f: Flags, k: string, def: string): string {
  const v = f.get(k);
  return typeof v === 'string' ? v : def;
}
function getStrOrNull(f: Flags, k: string): string | null {
  const v = f.get(k);
  return typeof v === 'string' ? v : null;
}

function parsePeriod(s: string): Period {
  if (s === 'daily' || s === 'weekly' || s === 'monthly') return s;
  console.error(`invalid --period: ${s} (expected daily|weekly|monthly)`);
  process.exit(2);
}
function parsePeriods(s: string): Period[] {
  return s
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map(parsePeriod);
}
