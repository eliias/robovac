# 3. Autovacuum scheduling

tl;dr: Autovacuum is a launcher process plus a small pool of workers. The launcher wakes every `autovacuum_naptime` (60 seconds by default) and starts one worker in one database. A worker vacuums a table when its dead-row count passes `threshold + scale_factor * reltuples`. The default scale factor is 0.2, so a 1 billion row table waits for 200 million dead rows. That is the single most common cause of bloat on big tables. Postgres 18 caps the trigger at 100 million dead rows, but you still want per-table settings. Only 3 workers run by default, so clusters with thousands of tables starve. Any conflicting lock cancels a running autovacuum after about 1 second, except an anti-wraparound vacuum.

## The moving parts

Autovacuum has two kinds of processes:

- One **launcher**. It runs for the life of the server. It decides when to start workers and in which database.
- Up to `autovacuum_max_workers` **workers** (default 3). Each worker attaches to one database, builds a list of tables that need work, and processes the list one table at a time.

The launcher tries to start one worker in each database every `autovacuum_naptime` seconds (default 60). With N databases, a new worker starts about every `autovacuum_naptime / N` seconds. Naptime is a per-database visit interval, not a global tick.

A worker does not vacuum every table. For each table it compares the statistics counters in `pg_stat_all_tables` (`n_dead_tup`, `n_ins_since_vacuum`, `n_mod_since_analyze`) against the trigger formulas below. The worker also rechecks the counters right before it starts each table, so two workers do not vacuum the same table twice.

If a database gets close to transaction ID wraparound, the launcher picks that database first and starts a worker there even if `autovacuum` is off. Chapter 5 covers wraparound. This chapter only needs one fact: wraparound work preempts the normal schedule.

## Trigger 1: dead rows (VACUUM)

A table qualifies for vacuum when:

```
n_dead_tup > autovacuum_vacuum_threshold
             + autovacuum_vacuum_scale_factor * reltuples
```

- `autovacuum_vacuum_threshold`: default 50 rows. A flat base so tiny tables do not get vacuumed on every visit.
- `autovacuum_vacuum_scale_factor`: default 0.2, which means 20% of the table.
- `reltuples`: the row-count estimate in `pg_class`, refreshed by each `VACUUM` and `ANALYZE`.
- `n_dead_tup`: the dead-row counter in `pg_stat_all_tables`, maintained by the statistics system.

Postgres 18 adds a cap. The trigger becomes:

```
n_dead_tup > least(autovacuum_vacuum_max_threshold,
                   autovacuum_vacuum_threshold
                   + autovacuum_vacuum_scale_factor * reltuples)
```

`autovacuum_vacuum_max_threshold` defaults to 100,000,000 rows. Set it to -1 to disable the cap. The cap only matters for tables above roughly 500 million rows at the default scale factor. Postgres 17 and older have no cap.

## Trigger 2: modified rows (ANALYZE)

The same worker also decides when to run `ANALYZE`, which refreshes planner statistics:

```
n_mod_since_analyze > autovacuum_analyze_threshold
                      + autovacuum_analyze_scale_factor * reltuples
```

- `autovacuum_analyze_threshold`: default 50 rows.
- `autovacuum_analyze_scale_factor`: default 0.1, which means 10% of the table.
- `n_mod_since_analyze` counts inserts, updates, and deletes. Inserts count here even though they do not create dead rows.

There is no cap for the analyze trigger, in any version. A 1 billion row table waits for 100 million modified rows before it gets fresh statistics. Big append-only tables usually need a per-table `autovacuum_analyze_scale_factor` of 0.01 or lower.

## Trigger 3: inserted rows (VACUUM, Postgres 13+)

Before Postgres 13, an insert-only table never met the dead-row trigger. It got no vacuum until the anti-wraparound deadline forced one huge, unthrottled pass. Postgres 13 added an insert trigger:

```
n_ins_since_vacuum > autovacuum_vacuum_insert_threshold
                     + autovacuum_vacuum_insert_scale_factor * reltuples
```

- `autovacuum_vacuum_insert_threshold`: default 1,000 rows. Set -1 to disable the insert trigger.
- `autovacuum_vacuum_insert_scale_factor`: default 0.2.

These vacuums keep the visibility map current (good for index-only scans) and spread the freeze work out over time.

Postgres 18 changed the formula. The scale factor now applies only to the unfrozen part of the table:

```
n_ins_since_vacuum > autovacuum_vacuum_insert_threshold
                     + autovacuum_vacuum_insert_scale_factor
                       * reltuples * (1 - relallfrozen / relpages)
```

`relallfrozen` is a new `pg_class` column in 18. The effect: on a mostly frozen append-only table, insert vacuums fire much earlier, because the already frozen 95% of the table no longer inflates the threshold.

## Worked example: why 20% fails at 1 billion rows

Take a 1 billion row table with the defaults:

```
trigger = 50 + 0.2 * 1,000,000,000 = 200,000,050 dead rows
```

The table must accumulate 200 million dead rows before autovacuum even starts. At 100 bytes per row that is about 20 GB of dead data, plus the matching dead index entries. Then one vacuum has to clean all of it in a single pass, which can run for hours under cost throttling (chapter 4 covers the throttle math). While that vacuum runs, new dead rows accumulate on top, and one of your 3 workers is pinned.

Compare the same math at three sizes:

| reltuples     | Trigger (defaults)  | Trigger at scale_factor 0.005 |
|---------------|---------------------|-------------------------------|
| 10,000        | 2,050               | 100                           |
| 10,000,000    | 2,000,050           | 50,050                        |
| 1,000,000,000 | 200,000,050         | 5,000,050                     |

The percentage trigger is fine for small tables and wrong for big ones. Postgres 18's 100 million cap halves the worst case here, but 100 million dead rows is still far too late. The common fixes:

- Lower the scale factor per table, for example 0.005 or 0.002 on tables above 10 million rows.
- Or set the scale factor to 0 and use a flat threshold, for example 1,000,000. The trigger then stops growing with the table.

```sql
ALTER TABLE events SET (
  autovacuum_vacuum_scale_factor  = 0,
  autovacuum_vacuum_threshold     = 1000000,
  autovacuum_analyze_scale_factor = 0,
  autovacuum_analyze_threshold    = 1000000
);
```

## Per-table settings vs global settings

Every trigger parameter exists at two levels:

- Global: a GUC in `postgresql.conf`, applies to every table.
- Per table: a storage parameter (reloption) set with `ALTER TABLE ... SET (...)`. It overrides the GUC for that table only.

The TOAST table of a relation is scheduled on its own. Use the `toast.` prefix to tune it, for example `toast.autovacuum_vacuum_scale_factor`. You can also turn autovacuum off for one table with `autovacuum_enabled = false`, but the anti-wraparound vacuum still runs.

Prefer per-table settings for outliers and keep the global defaults sane. A global scale factor of 0.005 would make autovacuum visit every 10,000 row table after 100 changed rows, which wastes worker time. Most clusters have fewer than 20 tables that need custom triggers. Inspect current overrides with:

```sql
SELECT relname, reloptions
FROM pg_class
WHERE reloptions IS NOT NULL;
```

To see how far each table is from its trigger, compare the counters against the formula:

```sql
SELECT s.relname,
       s.n_dead_tup,
       round(current_setting('autovacuum_vacuum_threshold')::numeric
             + current_setting('autovacuum_vacuum_scale_factor')::numeric
               * c.reltuples) AS trigger_at,
       s.last_autovacuum
FROM pg_stat_user_tables s
JOIN pg_class c ON c.oid = s.relid
ORDER BY s.n_dead_tup DESC
LIMIT 20;
```

(This query shows the global trigger. Robovac and tools like pganalyze also fold in the per-table reloptions.)

## Workers and starvation

`autovacuum_max_workers` defaults to 3 for the whole cluster, not per database. Three workers are enough for a schema with 50 tables. They are not enough for:

- Clusters with thousands of tables (multi-tenant schemas, heavy partitioning).
- Clusters where single vacuums run for hours on big tables.

The failure mode is starvation. All 3 workers sit on 3 big tables for hours. Meanwhile a 100,000 row queue table churns to 90% dead rows because no worker is free to take it. The trigger fired long ago, the work just never got scheduled. Citus, AWS, and Percona all report this pattern on clusters in the hundreds-to-thousands of tables range, and it can end in a forced wraparound vacuum.

Two cautions before you raise the worker count:

- The vacuum cost budget is shared across all running workers, so more workers each run slower unless you also raise the budget (chapter 4).
- Before Postgres 18, a change to `autovacuum_max_workers` needs a server restart.

Postgres 18 made the worker count reloadable. A new GUC, `autovacuum_worker_slots` (default 16), reserves process slots at startup. `autovacuum_max_workers` can then change with a config reload, up to the slot count. Set the slots once to your realistic ceiling, then tune the worker count live.

## Which table goes first

There is no priority order. Through Postgres 18, a worker scans `pg_class`, collects every table that passes a trigger, and processes the list in scan order, which roughly follows table OID. The most bloated table gets no preference. The table closest to wraparound gets no preference within the list either. Prioritization only exists at the database level, where the launcher picks the database with the oldest datfrozenxid once any database passes `autovacuum_freeze_max_age`.

The practical consequence: you cannot tell Postgres "this table matters most". You can only make its trigger fire earlier (per-table settings), give the pool more workers, or run manual `VACUUM` from your own scheduler. Robovac exists in that third gap.

## What cancels an autovacuum

Autovacuum takes a `SHARE UPDATE EXCLUSIVE` lock on the table. Normal reads and writes do not conflict with it. These do conflict:

- DDL: `ALTER TABLE`, `DROP TABLE`, `CREATE INDEX` (non-concurrent), `TRUNCATE`.
- Explicit `LOCK TABLE` in `SHARE` or stronger modes.
- Another vacuum or `VACUUM FULL`.

Postgres resolves the conflict in favor of the foreground query. When a backend blocks on a lock that autovacuum holds, the deadlock detector fires after `deadlock_timeout` (default 1 second) and cancels the autovacuum. The log shows `ERROR: canceling autovacuum task` with the table name.

One cancellation is harmless. The launcher retries on a later cycle. The dangerous pattern is a repeating cancellation, for example a migration tool or a cron job that takes an `ACCESS EXCLUSIVE` lock on the same table every few minutes. The table then never completes a vacuum, dead rows pile up, and its XID age keeps growing. Grep the logs: more than a few `canceling autovacuum task` lines per day on one table is a scheduling bug in your workload.

The exception is the anti-wraparound vacuum. When a vacuum runs `to prevent wraparound` (visible in the `query` column of `pg_stat_activity`), it does not yield. The foreground query waits instead, DDL included. Deployments that never let normal autovacuum finish eventually meet this stubborn variant, at the worst possible time. Chapter 5 covers the freeze-age settings that control when it starts.

## Scheduling defaults, one table

| GUC                                     | Default     | Since | Notes                                    |
|-----------------------------------------|-------------|-------|------------------------------------------|
| `autovacuum`                            | on          | 8.3   | Wraparound vacuums run even when off     |
| `autovacuum_naptime`                    | 60s         | 8.1   | Per-database visit interval              |
| `autovacuum_max_workers`                | 3           | 8.3   | Reloadable since 18, restart before that |
| `autovacuum_worker_slots`               | 16          | 18    | Slot ceiling, needs restart              |
| `autovacuum_vacuum_threshold`           | 50          | 8.1   | Flat part of the vacuum trigger          |
| `autovacuum_vacuum_scale_factor`        | 0.2         | 8.1   | 20% of reltuples                         |
| `autovacuum_vacuum_max_threshold`       | 100,000,000 | 18    | Cap on the vacuum trigger, -1 disables   |
| `autovacuum_vacuum_insert_threshold`    | 1,000       | 13    | -1 disables the insert trigger           |
| `autovacuum_vacuum_insert_scale_factor` | 0.2         | 13    | Unfrozen fraction only since 18          |
| `autovacuum_analyze_threshold`          | 50          | 8.1   | Flat part of the analyze trigger         |
| `autovacuum_analyze_scale_factor`       | 0.1         | 8.1   | 10% of reltuples, no cap                 |

## Sources

- PostgreSQL 18 docs, Automatic Vacuuming (GUC reference): https://www.postgresql.org/docs/18/runtime-config-autovacuum.html
- PostgreSQL 18 docs, Routine Vacuuming (formulas, launcher, cancellation): https://www.postgresql.org/docs/18/routine-vacuuming.html
- PostgreSQL 17 docs, Routine Vacuuming (pre-18 insert formula): https://www.postgresql.org/docs/17/routine-vacuuming.html
- PostgreSQL 18.0 release notes: https://www.postgresql.org/docs/release/18.0/
- Citus Data, Debugging Postgres autovacuum problems: 13 tips: https://www.citusdata.com/blog/2022/07/28/debugging-postgres-autovacuum-problems-13-tips/
- dbi services, PostgreSQL 18: Introduce autovacuum_vacuum_max_threshold: https://www.dbi-services.com/blog/postgresql-18-introduce-autovacuum_vacuum_max_threshold/
- dbi services, PostgreSQL 18: Change the maximum number of autovacuum workers on the fly: https://www.dbi-services.com/blog/postgresql-18-change-the-maximum-number-of-autovacuum-workers-on-the-fly/
- depesz, Waiting for PostgreSQL 18: Allow changing autovacuum_max_workers without restarting: https://www.depesz.com/2025/01/24/waiting-for-postgresql-18-allow-changing-autovacuum_max_workers-without-restarting/
- Microsoft, PostgreSQL 18 Vacuuming Improvements Explained: https://techcommunity.microsoft.com/blog/adforpostgresql/postgresql-18-vacuuming-improvements-explained/4459484
- AWS, Understanding autovacuum in Amazon RDS for PostgreSQL environments: https://aws.amazon.com/blogs/database/understanding-autovacuum-in-amazon-rds-for-postgresql-environments/
- Percona, How to Set and Tune Autovacuum Settings in PostgreSQL: https://www.percona.com/blog/importance-of-postgresql-vacuum-tuning-and-custom-scheduled-vacuum-job/
- Percona Community, PostgreSQL Autovacuum Internals and Benchmark: https://percona.community/blog/2026/07/01/postgresql-autovacuum-internals-benchmark/
- pganalyze, Log Insights A60: Canceling autovacuum task: https://pganalyze.com/docs/log-insights/autovacuum/A60
- Cybertec, LOCK TABLE can harm your database's health: https://www.cybertec-postgresql.com/en/lock-table-can-harm-your-database/
- pgsql-hackers, autovacuum scheduling starvation and frenzy (Jeff Janes, 2014): https://www.postgresql.org/message-id/20140515195506.GA7857%40eldon.alvh.no-ip.org
