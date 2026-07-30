# robovac

Technical spec. Companion to `docs/design-brief.md` (product and visual scope).

## tl;dr

One Next.js app. One pure TypeScript core (`lib/core`) computes everything: snapshot validation, optimization, simulation, URL codec. The web report page and the MCP endpoint are two thin consumers of that core. robovac never connects to a database: the agent runs SQL, robovac only computes.

## Architecture

```
lib/core/          pure functions, no React, no IO
  snapshot.ts      zod schema + types for the table snapshot
  optimize.ts      snapshot -> recommended settings + reasons
  simulate.ts      (snapshot, settings) -> chart series
  codec.ts         snapshot <-> URL fragment string
  sql.ts           the snapshot SQL text the agent runs
lib/terms/         explain content: one module per term + registry
app/
  page.tsx         landing
  r/page.tsx       report page (client component, reads location.hash)
  explain/[slug]/  explain pages (static)
  mcp/route.ts     MCP endpoint (Streamable HTTP, via mcp-handler)
components/        slider, stat, chart frame, code block, term link, demos
```

Data flows one way: snapshot in, numbers out. The report page holds one state object: `{ snapshot, settings }`. The sliders write `settings`, everything else derives from `simulate()` and renders.

## Snapshot

The agent runs one SQL query (from `get_snapshot_sql`) against the target database. The query returns one JSON row. Sources: `pg_stat_user_tables`, `pg_class`, `pg_settings`, per-table `reloptions`, `pg_relation_size`, `age(relfrozenxid)`, `mxid_age(relminmxid)`, `server_version_num`, `pg_stat_get_snapshot_timestamp` equivalent fields.

Schema (v1, validated w/ zod):

- `v: 1`, `capturedAt`
- `pg: { versionNum }`
- `table: { schema, name, relpages, reltuples, nLiveTup, nDeadTup, sizeBytes }`
- `activity: { nTupIns, nTupUpd, nTupDel, nTupHotUpd, statsResetAt, lastVacuum?, lastAutovacuum?, lastAnalyze?, lastAutoanalyze?, vacuumCount, autovacuumCount }`
- `xid: { frozenxidAge, minmxidAge, xidPerHour? }` (a rate needs two samples, so `xidPerHour` is optional input from the agent, the UI degrades to a static age view w/o it)
- `settings: { <name>: { global, table? } }` for the full knob set from the brief (trigger, cost, freeze, incl. `autovacuum_naptime`, `autovacuum_max_workers`, `autovacuum_work_mem`/`maintenance_work_mem` as context)

Rates derive from counters and `statsResetAt`: `deadRowsPerHour = (nTupUpd - nTupHotUpd + nTupDel) / hoursSinceReset`, `insertsPerHour = nTupIns / hoursSinceReset`. This is an average since reset (not comprehensive, good enough for v1). Two-snapshot deltas are out of scope.

## URL codec

`codec.ts`: snapshot JSON → deflate-raw → base64url → `https://<host>/r#1.<data>`. The leading `1.` is the codec version. Decode reverses and validates w/ zod. A failed decode renders the error state w/ the zod issues listed. Round-trip is property-tested. Practical limit ~8 KB of JSON per URL, one table per link.

## Optimizer

`optimize(snapshot) -> { settings, reasons, sql }`. Deterministic heuristics, no ML. Every changed setting carries a one-sentence reason string, the UI and the MCP both show it. Targets:

- **Trigger (bloat)**: keep dead tuples under ~5% of live rows, vacuum interval clamped to [15 min, 24 h]. Compute the wanted trigger point `T = deadRowsPerHour * targetIntervalHours`, then express it as `autovacuum_vacuum_threshold = T` w/ `autovacuum_vacuum_scale_factor = 0.01` capped for large tables (scale factor dominates on big tables, threshold gives the fixed floor). Analyze knobs get the same treatment w/ total churn (ins+upd+del) and a ~10% target.
- **Trigger (inserts)**: for append-heavy tables set `autovacuum_vacuum_insert_threshold ≈ insertsPerHour * targetIntervalHours` so pages get vacuumed (and frozen) while still in cache.
- **Cost**: estimate vacuum throughput as `costLimit / avgCostPerPage * (1000 / costDelayMs) * 8 KB` w/ an assumed page-cost mix (hit 1, miss 2, dirty 20, weighted by an assumed cache profile, stated as a footnote in the UI). Raise `autovacuum_vacuum_cost_limit` / lower `autovacuum_vacuum_cost_delay` until one full-table pass completes in under 4 h and throughput beats `deadRowsPerHour`.
- **Freeze**: for append-only tables lower `vacuum_freeze_min_age` so insert-triggered vacuums freeze early. Keep `vacuum_freeze_table_age` well under `autovacuum_freeze_max_age` so aggressive vacuums run proactively. If `xidPerHour` is present, report time-to-aggressive and time-to-wraparound in hours/days.

`sql` is the `ALTER TABLE <t> SET (...)` statement for the changed per-table settings, plus commented `ALTER SYSTEM` lines for the few global-only knobs.

## Simulator

`simulate(snapshot, settings) -> series` feeds the charts. Pure and fast (runs on every slider move):

- Dead-tuple sawtooth: linear growth at `deadRowsPerHour`, drop when the trigger fires, vacuum duration from the cost model.
- Freeze timeline: XID age line vs `vacuum_freeze_table_age`, `autovacuum_freeze_max_age`, and the 2^31 wraparound limit.
- I/O estimate: pages read/dirtied per vacuum pass and the resulting MB/h.

The explain-page demos call the same simulator w/ a fixed toy snapshot.

Charts are hand-written SVG components (a sawtooth, a timeline, a bar). No chart library: the three chart shapes are bespoke, and the monochrome style from the brief is easier to hit directly than to configure into a library.

## MCP

`app/mcp/route.ts`, Streamable HTTP, no auth, three tools:

1. `get_snapshot_sql()` → the SQL text + instructions to run it read-only.
2. `create_report({ snapshot })` → validates, returns `{ url, verdict }`. `verdict` is the header one-liner from the brief.
3. `optimize({ snapshot })` → `{ settings, reasons, sql, url }`. The URL opens the report w/ the proposed values pre-applied.

All three call the same `lib/core` functions the web app uses. Invalid input returns the zod issues as the tool error.

## Explain pages

`lib/terms/` holds one module per term: `{ slug, title, definition (React node), seeAlso: slug[], Demo?: Component }`. A registry maps slug → module and drives `generateStaticParams`. The `<Term>` component links a term inline and validates the slug at build time. Initial set (~15 terms): `xmin`, `xmax`, dead tuple, bloat, freeze, aggressive vacuum, wraparound, HOT update, and the settings from the brief. Demos exist where the simulator can show the effect, definitions alone are fine for the rest.

## Errors

Two failure surfaces, same handling: zod-validate at the boundary (MCP input, URL decode), pass typed data inward, core functions never see invalid data. The error page lists the validation issues and links the snapshot SQL so people can re-generate.

## Testing

Vitest on `lib/core`: codec round-trip (property-based), optimizer fixtures (hot update-heavy table, large append-only table, wraparound-risk table, healthy table → no changes), simulator invariants (sawtooth never negative, vacuum always fires when the trigger is crossed). UI e2e is out of scope for v1.

## Out of scope (v1)

- Server-side storage, auth, rate limits (nothing to write to).
- Live database connections from robovac.
- Multi-table fleet views.
- Two-snapshot rate deltas.
- stdio MCP package.
