<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./docs/assets/wordmark-dark.png" />
    <img alt="robovac" src="./docs/assets/wordmark-light.png" width="280" />
  </picture>
</p>

---

> Postgres vacuum tuning made easy

robovac explains and tunes Postgres autovacuum, one table at a time. An MCP server snapshots a table's statistics and returns two links to one interactive report: sliders for every setting, live charts, and a copyable `ALTER TABLE` statement. The short link resolves a report that robovac stores for 30 days. The permalink carries the whole snapshot in its URL fragment and never expires. There are no accounts and the web app never touches a database. The server-side state is two things: the stored reports, and one report counter per IP address per clock hour.

The optimizer is cadence-first and pattern-based. It classifies the workload (append-only, queue, large-update-heavy, mixed-oltp, cold), solves for a target vacuum cadence in time units, chains the freeze ages to that cadence, and simulates every proposal against the current settings before it recommends anything. When a pinned xmin horizon makes tuning pointless, it says so and returns a diagnosis instead.

## Getting started

```sh
mise install   # node + pnpm, pinned in mise.toml
pnpm install   # dependencies
mise run dev   # the app on http://localhost:3000
```

Everything else is a mise task:

```sh
mise run test    # vitest suite for lib/
mise run lint    # oxlint
mise run fmt     # oxfmt
mise run build   # the next app
mise run check   # everything CI runs
```

## Add robovac to your agent

Use the public MCP server:

```sh
# Claude Code
claude mcp add --transport http robovac https://robovac.hannesmoser.at/api/mcp

# Codex
codex mcp add robovac --url https://robovac.hannesmoser.at/api/mcp
```

No account and no database access. robovac never connects to your database: it hands your agent read-only SQL (`get_snapshot_sql`, `get_candidates_sql`), the agent runs it twice on its own connection (a role in `pg_monitor` is enough), and `create_report` turns the two result rows into the two report links, the workload pattern, and the optimized settings. `explain_term` returns stable explain URLs.

## Configuration

`REDIS_URL` is the only environment variable, and production requires it. Redis holds two things: the reports behind the short links for 30 days, and one report counter per IP address, which expires after an hour. A deploy that forgets it fails loudly at request time, on purpose: the alternative is links written into a container filesystem that the next replica cannot read.

Development needs no configuration. Without `REDIS_URL` the store falls back to `.links-dev.json` in the repo root, which is gitignored.

## Layout

- `app/`, `components/`: the Next.js app (report, explain pages, arcana, mcp).
- `lib/core/`: all math as pure functions: snapshot schema, trigger/cost/freeze model, simulator, URL codec, optimizer.
- `lib/links/`: the short link store (Redis in production, one JSON file in development).
- `docs/research/`: a small book about Postgres vacuum, the domain foundation for the product.
