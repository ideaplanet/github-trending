# github-trending

Track GitHub trending (daily / weekly / monthly) into a single SQLite file
that is committed back to this repository.

## Usage

```bash
bun install
bun run db:migrate           # apply schema (idempotent)
bun run fetch                # scrape and write a snapshot
bun run latest               # show current daily top 25
bun run latest --period weekly
bun run history --repo karpathy/llm.c
```

The database lives at `data/trending.db`. GitHub Actions runs `fetch` every
hour and commits the updated DB back to `main`.
