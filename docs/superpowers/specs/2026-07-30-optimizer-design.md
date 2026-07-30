# robovac optimizer v2: cadence-first, pattern-based

Design for the optimization algorithm. Sources: the research book (`docs/research/`, chapters 3-7, 9) and operational tuning experience on large production Postgres deployments.

## tl;dr

Four stages: SENSE (measure rates and confidence), CLASSIFY (score the table against 7 workload patterns), SOLVE (turn per-pattern time targets into settings, with the freeze knobs chained to the real vacuum cadence), PROVE (simulate proposed vs current and refuse any regression). The core idea: solve for a target vacuum cadence in units of time, not for a dead-row fraction. Thresholds come from measured rates, freeze ages come from the cadence, cost limits come from an I/O budget. Every output carries a reason, a pattern verdict, and warnings.

## Why cadence-first

The default trigger couples vacuum frequency to table size (20% of live rows). Every incident in chapter 9 fights that coupling. Practitioners who tune large fleets converge on the alternative: `scale_factor = 0`, fixed threshold sized to about 1 hour of the measured dead-tuple rate. Time is the unit operators think in ("vacuum every hour"), and time is what the freeze knobs secretly depend on: `vacuum_freeze_min_age` only freezes pages if it is shorter, in time, than the vacuum interval, otherwise no row is ever old enough when the vacuum arrives. So the solver works in hours and converts to rows and xids at the end.

## Stage 1: SENSE

Inputs (snapshot v2, superset of today):

- Measured rates from the two-sample read: `deadPerDay` (upd − hot_upd + del), `insPerDay`, `hotFraction`, `modPerDay` (for analyze), `xidPerDay`.
- Stock: live, dead, pages, xidAge, multixactAge, lastAutovacuum/lastAutoanalyze, vacuumCount deltas, indexes, toast presence + toast stats, reloptions, global settings, `versionNum`, `isPartition`.
- Optional hints (new fields, provided by the agent or the user, all optional):
  - `pattern`: explicit override of the classifier.
  - `replicationLagBudget`: none | tight | relaxed (default tight, replica lag is the constraint production reports hit most).
  - `storage`: ssd | hdd (page-cost mix).
  - `ramBytes`, `maxWorkers`: for cluster advice.
  - `longTransactions`: true if the workload holds multi-minute transactions.
  - `fkHeavy`: true if FK checks / SELECT FOR UPDATE dominate (multixact pressure).

Every rate gets a confidence: `high` (sample ≥ 30 s, non-trivial deltas), `low` (short sample, zero deltas, or stats reset). Confidence gates how far the solver may move a knob (see PROVE).

## Stage 2: CLASSIFY

Features: size class (rows and bytes), churn ratio (`deadPerDay / live`), insert fraction (`ins / (ins + upd + del)`), HOT fraction, dead ratio now, xid pressure (`xidAge / freeze_max_age` and days to shutdown), horizon signal (dead ratio high while autovacuum ran recently and often).

Seven patterns, scored 0-1, top score wins. Two overlays (xid pressure, horizon block) can attach to any pattern:

| #   | Pattern                        | Signature                                                 | Target cadence                                       |
| --- | ------------------------------ | --------------------------------------------------------- | ---------------------------------------------------- |
| 1   | append-only                    | insert fraction > 0.95, churn ratio ≈ 0                   | insert vacuum ≈ 1 h of inserts, freeze on first pass |
| 2   | queue / hot-loop               | churn ratio > 5/day, table small (< 1 GB)                 | vacuum every 5-15 min, static analyze                |
| 3   | large update-heavy             | live > 10M, churn ratio meaningful, insert fraction < 0.7 | vacuum ≈ 1 h of dead rows                            |
| 4   | mixed OLTP                     | everything moderate                                       | vacuum every 1-6 h                                   |
| 5   | cold / static                  | rates ≈ 0, any size                                       | no trigger changes, freeze schedule only             |
| 6   | wraparound emergency (overlay) | xidAge > freeze_max_age, or shutdown < 30 d               | freeze throughput first, everything else second      |
| 7   | horizon-blocked (overlay)      | dead ratio high AND autovacuum ran < 2 cadences ago       | no settings can help, output a diagnosis             |

Pattern 7 is the "do not make it worse" case from chapter 1 and the queue-table reports: when the xmin horizon is pinned, tuning knobs cannot remove dead rows, so robovac says that, ships the four holder queries, and leaves the settings alone.

## Stage 3: SOLVE

Shared machinery, pattern-specific targets. All conversions use the measured rates.

**Triggers.** `threshold = round_human(deadPerDay × T_v)`, `scale_factor = 0` for large tables, a small floor (0.005-0.02) for tables under ~1M rows so the trigger scales while they grow. Insert side identical with `insPerDay × T_i` (PG13+; on PG12 fall back to freeze scheduling only). Analyze: `modPerDay × T_a` with `T_a = 2 × T_v`, static (`analyze_scale_factor = 0`) on queue tables and partitions (stale statistics on high-churn tables break plans, partition pruning included). Cap thresholds so the trigger stays reachable: `threshold ≤ 0.25 × live` for small tables.

**Freeze chain** (the novel core, all in time units):

1. `freeze_min_age = k × T_v × xidPerDay` with k = 2, clamped to [1M, 50M]. Guarantees pages freeze on normal vacuums because the age is older than a couple of vacuum intervals.
2. `freeze_table_age = 0.75 × freeze_max_age` so aggressive passes happen on our schedule, not the forced one.
3. `freeze_max_age`: choose so the forced anti-wraparound cadence lands in [30 d, 90 d] at the measured `xidPerDay`, clamped to [200M, 1B]. Raising above 400M requires the flat-age evidence gate: only when the observed `xidAge` is comfortably below the current limit and confidence is high. A very high freeze age also delays the day a latent bug detonates (chapter 9), so the default stays conservative.
4. Multixact: `1.5 × freeze_max_age` capped at 1.2B; if `fkHeavy`, do not raise it and add a member-space warning (chapter 9 documents member exhaustion with no metric watching it).

**Cost budget.** Delay fixed at 2 ms, page costs to modern defaults (miss 2). Choose the smallest `cost_limit` from {200, 600, 1000, 2000, 4000, 10000} such that: pass duration ≤ min(T_v / 2, 4 h) AND estimated write rate stays inside the replication budget (tight: ~40 MB/s sustained, relaxed: ~150 MB/s, none: unthrottled). Production reports of multi-GB WAL bursts from a single vacuum are why the budget defaults to tight.

**Companions (not sliders, extra outputs):** `toast.autovacuum_*` block when a TOAST table exists (TOAST cannot be altered directly, the `toast.` prefix on the parent carries the settings), fillfactor advice for update-heavy tables with low HOT fraction, cluster advice (`maintenance_work_mem` ≈ 1% RAM cap 5 GB, `vacuum_buffer_usage_limit` ≈ 2% RAM cap 10 GB, workers), partition note (settings go on every partition, template for new ones, reloptions die on table rebuilds).

## Stage 4: PROVE

Simulate current vs proposed with the existing `simulate()` and refuse regressions:

- Peak dead rows must not rise more than 10%.
- Pass duration must not rise unless peak bloat falls.
- Time to forced aggressive vacuum must not fall below 14 d (unless the emergency overlay is active).
- Total vacuum seconds per day must not exceed 4× current (worker starvation guard).
- Low-confidence rates clamp every knob to a bounded step: at most 10× away from current, direction preserved. Ambiguity makes robovac conservative, not silent.

A proposal that fails a gate falls back toward current for the offending knob and reports "kept current" with the failed gate as the reason.

## Output

`optimize(snapshot, hints) -> { values, reasons, warnings, pattern: { name, score, evidence }, diagnosis?, companions: { toastSql?, clusterAdvice[], fillfactorNote? } }`

- MCP `snapshot_table` accepts the hint fields and returns the full object, URL included.
- The URL payload carries the hints; the report page derives pattern, warnings, and diagnosis from the same `optimize()` the MCP uses, so there is one source of truth.
- The emergency overlay always produces warnings ranked first ("forced aggressive vacuum is running now", "shutdown in N days"), because the war stories say the warning is worth more than the tuned value.

## Out of scope

- Multi-table / whole-cluster scheduling (one table per report stays).
- Applying settings, monitoring integration.
- Learning across snapshots (a later step, needs storage).
