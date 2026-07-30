<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./docs/assets/wordmark-dark.png" />
    <img alt="robovac" src="./docs/assets/wordmark-light.png" width="280" />
  </picture>
</p>

---

> Postgres vacuum tuning made easy

robovac explains and tunes Postgres autovacuum, one table at a time. An MCP server snapshots a table's statistics and returns a link. The link carries the whole snapshot in its URL fragment and opens an interactive report: sliders for every setting, live charts, and a copyable `ALTER TABLE` statement. There are no accounts and no server-side state, and the web app never touches a database.

The optimizer is cadence-first and pattern-based. It classifies the workload (append-only, queue, large-update-heavy, mixed-oltp, cold), solves for a target vacuum cadence in time units, chains the freeze ages to that cadence, and simulates every proposal against the current settings before it recommends anything. When a pinned xmin horizon makes tuning pointless, it says so and returns a diagnosis instead.

## Getting started

```sh
mise install   # node + pnpm, pinned in mise.toml
pnpm install   # workspace dependencies
mise run dev   # the app on http://localhost:3000
```

Everything else is a mise task:

```sh
mise run test    # vitest suite for lib/core
mise run lint    # oxlint
mise run fmt     # oxfmt
mise run build   # app + mcp package
mise run check   # everything CI runs
```

## Add the MCP server to an agent

```json
{
  "robovac": {
    "command": "npx",
    "args": ["-y", "robovac-mcp"],
    "env": { "DATABASE_URL": "postgres://readonly@host:5432/prod" }
  }
}
```

A role in `pg_monitor` is enough. The server reads statistics catalogs only, never table data, and never writes. Tools: `snapshot_table` (statistics snapshot → report URL + optimized settings), `list_candidates` (rank tables by vacuum pressure), `explain_term` (stable explain URLs).

## Layout

- `app/`, `components/`: the Next.js app (report, explain pages, arcana, mcp).
- `lib/core/`: all math as pure functions: snapshot schema, trigger/cost/freeze model, simulator, URL codec, optimizer.
- `packages/robovac-mcp/`: the stdio MCP server.
- `docs/research/`: a small book about Postgres vacuum, the domain foundation for the product.
