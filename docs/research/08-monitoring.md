# 8. Monitoring vacuum

tl;dr: You can watch vacuum from five angles. Table counters in `pg_stat_user_tables` tell you if vacuum keeps up. Progress views show a running vacuum phase by phase. The autovacuum log tells you what each run did and what it cost. The xmin horizon tells you what blocks cleanup. `age(relfrozenxid)` tells you the distance to wraparound. This chapter gives one query per check and a short alert list with thresholds. Postgres 18 adds cumulative per-table vacuum time and delay tracking.

## Table counters: pg_stat_user_tables

This view holds one row per table with dead tuple estimates and vacuum history. It is the first place to look when you suspect that vacuum does not keep up.

```sql
SELECT relname,
       n_live_tup,
       n_dead_tup,
       round(100.0 * n_dead_tup / nullif(n_live_tup + n_dead_tup, 0), 1) AS dead_pct,
       n_mod_since_analyze,
       n_ins_since_vacuum,
       last_vacuum, last_autovacuum,
       last_analyze, last_autoanalyze,
       vacuum_count, autovacuum_count,
       analyze_count, autoanalyze_count
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC
LIMIT 20;
```

Read the columns like this:

- `n_dead_tup`: the estimated count of dead tuples. Autovacuum compares this value against its threshold formula (chapter on autovacuum scheduling).
- `n_mod_since_analyze`: rows changed since the last analyze. A high value means stale planner statistics.
- `n_ins_since_vacuum`: rows inserted since the last vacuum. This drives the insert-based autovacuum trigger (Postgres 13 and later).
- `last_vacuum` and `vacuum_count`: manual `VACUUM` only. `last_autovacuum` and `autovacuum_count`: autovacuum only. Check both.

The counters have four gotchas:

1. All values are estimates from the statistics system, not exact counts. `ANALYZE` corrects `n_dead_tup` and `n_live_tup`, so the values can jump after an analyze.
2. `vacuum_count` and `last_vacuum` do not count `VACUUM FULL`. A table can show `last_vacuum = NULL` right after a `VACUUM FULL`.
3. `pg_stat_reset()` zeroes all these counters. Autovacuum then sees zero dead tuples and zero modifications, so it can skip needed work. The Postgres docs recommend a database-wide `ANALYZE` after a reset.
4. A crash or an immediate shutdown resets all cumulative statistics (Postgres 15 and later keep them in shared memory, with a disk copy only on clean shutdown). After a crash, treat `last_autovacuum = NULL` as "unknown", not as "never ran".

## Live progress: pg_stat_progress_vacuum

This view shows one row per running `VACUUM` or autovacuum worker. It covers the heap and index phases, not `VACUUM FULL` (that appears in `pg_stat_progress_cluster`).

```sql
SELECT p.pid,
       p.datname,
       p.relid::regclass AS table_name,
       p.phase,
       round(100.0 * p.heap_blks_scanned / nullif(p.heap_blks_total, 0), 1) AS heap_scanned_pct,
       round(100.0 * p.heap_blks_vacuumed / nullif(p.heap_blks_total, 0), 1) AS heap_vacuumed_pct,
       p.index_vacuum_count,
       p.indexes_processed || '/' || p.indexes_total AS indexes,      -- PG17+
       pg_size_pretty(p.dead_tuple_bytes) AS dead_tuple_mem,          -- PG17+
       now() - a.xact_start AS running_for,
       a.wait_event_type || ': ' || a.wait_event AS waiting_on
FROM pg_stat_progress_vacuum p
JOIN pg_stat_activity a USING (pid);
```

The `phase` column moves through seven values:

| Phase | What happens |
|---|---|
| `initializing` | The worker prepares to scan the heap. This phase is short. |
| `scanning heap` | The worker scans heap pages, prunes, defragments, and freezes tuples. Watch `heap_blks_scanned`. |
| `vacuuming indexes` | The worker removes dead item pointers from every index. This phase has no block-level progress before Postgres 17. Postgres 17 adds `indexes_processed`. |
| `vacuuming heap` | The worker marks the collected item pointers in the heap as reusable. Watch `heap_blks_vacuumed`. |
| `cleaning up indexes` | One final index pass after the full heap scan. |
| `truncating heap` | The worker returns empty pages at the end of the table to the operating system. This phase takes an exclusive lock in short bursts. |
| `performing final cleanup` | The worker frees memory, vacuums the free space map, and updates statistics. |

Two signals matter most. First, `index_vacuum_count` greater than 1 means the dead tuple memory filled up and vacuum made multiple index passes. Raise `autovacuum_work_mem` in that case. Postgres 17 replaced the dead tuple array with a radix tree, so multiple passes became rare. Second, a `wait_event` of `VacuumDelay` means the worker sleeps because of cost-based delay.

Version note: Postgres 17 renamed the memory columns to `max_dead_tuple_bytes`, `dead_tuple_bytes`, and `num_dead_item_ids`, and added `indexes_total` and `indexes_processed`. Postgres 16 and earlier show `max_dead_tuples` and `num_dead_tuples` instead. Postgres 18 adds `delay_time`.

## Live progress: pg_stat_progress_analyze

Analyze runs get their own view with the same shape.

```sql
SELECT pid, datname, relid::regclass AS table_name, phase,
       round(100.0 * sample_blks_scanned / nullif(sample_blks_total, 0), 1) AS sample_pct,
       child_tables_done || '/' || child_tables_total AS partitions,
       current_child_table_relid::regclass AS current_partition
FROM pg_stat_progress_analyze;
```

The phases are: `initializing`, `acquiring sample rows`, `acquiring inherited sample rows` (partitioned tables), `computing statistics`, `computing extended statistics`, and `finalizing analyze`. On partitioned tables, watch `child_tables_done` because the sample phase visits every partition. Postgres 18 adds `delay_time` here as well.

## The autovacuum log: log_autovacuum_min_duration

Set `log_autovacuum_min_duration = 0` to log every autovacuum run. The default is 10 minutes since Postgres 15 (`-1`, off, before that), which hides almost all runs. The log volume is small: one entry per completed run. Set `track_io_timing = on` and, on Postgres 18, `track_cost_delay_timing = on` to get the timing lines.

A complete Postgres 18 log entry, line by line:

```
LOG:  automatic vacuum of table "app.public.orders": index scans: 1
  pages: 0 removed, 745822 remain, 308451 scanned (41.36% of total), 1024 eagerly scanned
  tuples: 1543219 removed, 25482100 remain, 12040 are dead but not yet removable
  removable cutoff: 812345678, which was 9876 XIDs old when operation ended
  new relfrozenxid: 790123456, which is 38000000 XIDs ahead of previous value
  frozen: 12345 pages from table (1.66% of total) had 987654 tuples frozen
  visibility map: 250000 pages set all-visible, 12345 pages set all-frozen (0 were all-visible)
  index scan needed: 152340 pages from table (20.43% of total) had 1543219 dead item identifiers removed
  index "orders_pkey": pages: 68901 in total, 0 newly deleted, 0 currently deleted, 0 reusable
  delay time: 12345.678 ms
  I/O timings: read: 384.980 ms, write: 1032.635 ms
  avg read rate: 55.263 MB/s, avg write rate: 22.482 MB/s
  buffer usage: 452345 hits, 301234 reads, 98765 dirtied
  WAL usage: 361452 records, 8765 full page images, 213456789 bytes, 42 buffers full
  system usage: CPU: user: 4.12 s, system: 1.87 s, elapsed: 63.60 s
```

- Header: the database, schema, and table, plus the count of index vacuum cycles. A count above 1 means the dead tuple memory filled up. The header says "aggressive vacuum" for an aggressive run and "to prevent wraparound" for a forced anti-wraparound run.
- `pages`: pages removed from the end of the table, pages that remain, and pages scanned. A low scan percentage is good: the visibility map let vacuum skip clean pages. "eagerly scanned" (Postgres 18) counts pages that the eager freeze scan visited.
- `tuples`: tuples removed and tuples that remain. "dead but not yet removable" is the key health field. A high number here means the xmin horizon blocked cleanup. Investigate with the horizon queries below.
- `removable cutoff`: the oldest XID whose effects vacuum could remove. The "XIDs old when operation ended" number shows how far the horizon lagged. A number in the millions points at a long transaction or a stale slot.
- `new relfrozenxid`: vacuum advanced the table freeze marker by this many XIDs. No line here means the run did not advance it (chapter on freeze semantics).
- `frozen`: pages and tuples frozen in this run.
- `visibility map` (Postgres 18): pages newly marked all-visible and all-frozen.
- `index scan needed`: pages that carried dead item pointers, and the count removed. "index scan bypassed" means too few dead items to justify index passes. "bypassed by failsafe" means the wraparound failsafe kicked in and skipped index cleanup.
- `index "..."`: per-index page counts, one line per index.
- `delay time` (Postgres 18, needs `track_cost_delay_timing`): total sleep time from cost-based delay. Compare it against elapsed time. In this example the run spent 12 of 64 seconds sleeping.
- `I/O timings` (needs `track_io_timing`): time spent in read and write system calls.
- `avg read rate` and `avg write rate`: throughput over the whole run, sleeps included.
- `buffer usage`: buffer cache hits, reads from disk, and pages dirtied. Postgres 16 and earlier print "misses" instead of "reads".
- `WAL usage`: WAL records, full page images, and bytes written by this run. "buffers full" (Postgres 18) counts WAL buffer stalls.
- `system usage`: CPU time and wall clock time.

## Running vacuums in pg_stat_activity

Autovacuum workers appear as normal backends with `backend_type = 'autovacuum worker'`. The query text shows the target table, and a forced run carries the suffix "(to prevent wraparound)".

```sql
SELECT pid, datname, state, wait_event_type, wait_event,
       now() - xact_start AS running_for, query
FROM pg_stat_activity
WHERE backend_type = 'autovacuum worker'
   OR query ILIKE 'vacuum%' OR query ILIKE 'autovacuum:%';
```

Also watch worker saturation. When every worker slot is busy for hours, small tables queue behind big ones.

```sql
SELECT count(*) AS active_workers,
       current_setting('autovacuum_max_workers')::int AS max_workers
FROM pg_stat_activity
WHERE backend_type = 'autovacuum worker';
```

## The xmin horizon: what blocks cleanup

Vacuum can only remove tuples that are dead to every current snapshot. The oldest snapshot XID in the system is the xmin horizon. Four sources can pin it. Check all four, because each one is invisible to the others.

Long transactions on the primary:

```sql
SELECT pid, usename, state, xact_start,
       now() - xact_start AS duration,
       age(backend_xmin) AS xmin_age,
       left(query, 60) AS query
FROM pg_stat_activity
WHERE backend_xmin IS NOT NULL
ORDER BY age(backend_xmin) DESC
LIMIT 10;
```

Note that `state = 'idle in transaction'` sessions count too. A session that opened a transaction and went idle pins the horizon just like a running query.

Replication slots (`xmin` for physical slots with feedback, `catalog_xmin` for logical slots):

```sql
SELECT slot_name, slot_type, active,
       age(xmin) AS xmin_age,
       age(catalog_xmin) AS catalog_xmin_age,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained_wal
FROM pg_replication_slots;
```

An inactive slot with a growing `xmin_age` is the classic silent killer. Drop slots that no consumer will resume.

Prepared transactions (two-phase commit):

```sql
SELECT gid, owner, database, prepared,
       now() - prepared AS pending_for,
       age(transaction) AS xid_age
FROM pg_prepared_xacts
ORDER BY prepared;
```

A prepared transaction survives restarts and holds locks and the horizon until someone runs `COMMIT PREPARED` or `ROLLBACK PREPARED`.

Standbys with `hot_standby_feedback = on`:

```sql
SELECT application_name, client_addr, state,
       age(backend_xmin) AS xmin_age
FROM pg_stat_replication
WHERE backend_xmin IS NOT NULL;
```

One combined query for dashboards, sorted by the worst offender:

```sql
WITH horizon AS (
  SELECT 'backend' AS source, pid::text AS id, backend_xmin AS xmin_value
    FROM pg_stat_activity WHERE backend_xmin IS NOT NULL
  UNION ALL
  SELECT 'prepared xact', gid, transaction FROM pg_prepared_xacts
  UNION ALL
  SELECT 'slot xmin', slot_name, xmin
    FROM pg_replication_slots WHERE xmin IS NOT NULL
  UNION ALL
  SELECT 'slot catalog_xmin', slot_name, catalog_xmin
    FROM pg_replication_slots WHERE catalog_xmin IS NOT NULL
  UNION ALL
  SELECT 'standby feedback', application_name, backend_xmin
    FROM pg_stat_replication WHERE backend_xmin IS NOT NULL
)
SELECT source, id, xmin_value, age(xmin_value) AS xid_age
FROM horizon
ORDER BY age(xmin_value) DESC;
```

## Wraparound distance: age(relfrozenxid)

Every table carries `relfrozenxid`, every database carries `datfrozenxid` (the minimum over its tables). `age()` gives the distance in XIDs from that marker to the current XID. The hard limit is about 2.1 billion. At `autovacuum_freeze_max_age` (default 200 million) autovacuum forces an anti-wraparound run.

Per database:

```sql
SELECT datname,
       age(datfrozenxid) AS xid_age,
       mxid_age(datminmxid) AS mxid_age,
       round(100.0 * age(datfrozenxid) / 2000000000, 1) AS pct_towards_wraparound,
       round(100.0 * age(datfrozenxid)
             / current_setting('autovacuum_freeze_max_age')::numeric, 1) AS pct_towards_forced_vacuum
FROM pg_database
ORDER BY age(datfrozenxid) DESC;
```

Per table, to find what holds the database value back:

```sql
SELECT c.oid::regclass AS table_name,
       age(c.relfrozenxid) AS xid_age,
       mxid_age(c.relminmxid) AS mxid_age,
       pg_size_pretty(pg_table_size(c.oid)) AS table_size
FROM pg_class c
WHERE c.relkind IN ('r', 'm', 't')
ORDER BY age(c.relfrozenxid) DESC
LIMIT 20;
```

Practitioners alert in two steps. Warn at 500 million (25% of the limit): forced vacuums already run, find out why they do not finish. Page at 1 billion (50%): act now, hours matter on multi-terabyte tables. Monitor `mxid_age()` with the same thresholds, because multixact wraparound has the same failure mode.

## XID burn rate

The thresholds above only mean something relative to consumption speed. A system that burns 5,000 XIDs per second crosses 500 million in 28 hours. Measure the rate by sampling the 64-bit transaction counter:

```sql
SELECT pg_current_xact_id()::text::bigint AS xid_start \gset
SELECT pg_sleep(60);
SELECT (pg_current_xact_id()::text::bigint - :xid_start) / 60.0 AS xids_per_second;
```

`pg_current_xact_id()` (Postgres 13 and later, `txid_current()` before) assigns one XID per call, so run it at a low frequency. Monitoring agents (postgres_exporter, Datadog, pganalyze) sample this counter and compute the rate for you. From the rate, alert on time to wraparound, not only on the raw age.

## New in Postgres 18

Postgres 18 has no view named `pg_stat_vacuum`. A patch with that name was discussed on the hackers list, but the release shipped cumulative counters inside the existing views instead:

- `pg_stat_all_tables` (and `pg_stat_user_tables`) adds four columns: `total_vacuum_time`, `total_autovacuum_time`, `total_analyze_time`, and `total_autoanalyze_time`, in milliseconds. They turn "which tables eat my maintenance window" into one query:

```sql
SELECT relname,
       round(total_autovacuum_time / 1000) AS autovacuum_s,
       round(total_vacuum_time / 1000) AS manual_vacuum_s,
       autovacuum_count, vacuum_count
FROM pg_stat_user_tables
ORDER BY total_autovacuum_time DESC
LIMIT 10;
```

- The new setting `track_cost_delay_timing` (default off) measures sleep time from cost-based delay. It feeds the `delay_time` column in `pg_stat_progress_vacuum` and `pg_stat_progress_analyze`, the "delay time" log line, and `VACUUM (VERBOSE)`. A run with 90% delay time is throttled, not slow, so tune the cost limit instead of the hardware.
- The autovacuum log gains the "visibility map" line, the "eagerly scanned" page count, and the "buffers full" WAL counter.

## The alert list

A team that runs large Postgres deployments should carry these alerts. Tune the numbers to your workload, but start here.

| Alert | Source | Warn | Page |
|---|---|---|---|
| Wraparound distance | `age(datfrozenxid)`, `mxid_age(datminmxid)` | 500 million | 1 billion |
| Xmin horizon age | combined horizon query, max `age(xmin_value)` | 100 million XIDs or 1 hour behind | 500 million XIDs |
| Long transaction | `pg_stat_activity`, `now() - xact_start` | 1 hour | 6 hours |
| Idle in transaction | `pg_stat_activity`, `state = 'idle in transaction'` | 10 minutes | 1 hour |
| Inactive replication slot | `pg_replication_slots`, `active = false` | 15 minutes | retained WAL > 10% of disk |
| Prepared transaction age | `pg_prepared_xacts` | 5 minutes | 1 hour |
| Dead tuple ratio | `n_dead_tup / (n_live_tup + n_dead_tup)` | 10% on tables > 1 GB | 30% |
| Table not vacuumed | `greatest(last_vacuum, last_autovacuum)` on churn tables | 1 day | 7 days |
| Table not analyzed | `greatest(last_analyze, last_autoanalyze)` | 1 day | 7 days |
| Worker saturation | active workers = `autovacuum_max_workers` | 1 hour sustained | 6 hours sustained |
| Single vacuum runtime | `pg_stat_progress_vacuum` join `pg_stat_activity` | 6 hours on one table | 24 hours |
| Multiple index passes | `index_vacuum_count` > 1 (view or log) | any occurrence | not needed |
| XID burn vs headroom | burn rate and `age(datfrozenxid)` | time to 2 billion < 14 days | < 3 days |

Two notes on the list. The dead tuple ratio alert needs a size floor, because a 100-row config table with 30 dead rows is noise. The "not vacuumed" alerts only fit tables with steady churn, so scope them to a known list instead of every table.

## Sources

- https://www.postgresql.org/docs/current/progress-reporting.html
- https://www.postgresql.org/docs/current/monitoring-stats.html
- https://www.postgresql.org/docs/current/routine-vacuuming.html
- https://www.postgresql.org/docs/current/runtime-config-vacuum.html
- https://raw.githubusercontent.com/postgres/postgres/REL_18_STABLE/src/backend/access/heap/vacuumlazy.c (log format, verified against REL_17_STABLE and REL_16_STABLE)
- https://www.dbi-services.com/blog/postgresql-18-per-relation-statistics-for-autovacuum-and-autoanalyze/
- https://www.depesz.com/2025/02/19/waiting-for-postgresql-18-add-delay-time-to-vacuum-analyze-verbose-and-autovacuum-logs/
- https://www.depesz.com/2020/04/17/waiting-for-postgresql-13-allow-autovacuum-to-log-wal-usage-statistics/
- https://pganalyze.com/blog/5mins-postgres-17-faster-vacuum-adaptive-radix-trees
- https://blog.keikooda.net/2023/03/05/xmin-horizon/
- https://www.cybertec-postgresql.com/en/reasons-why-vacuum-wont-remove-dead-rows/
- https://www.crunchydata.com/blog/managing-transaction-id-wraparound-in-postgresql
- https://techcommunity.microsoft.com/blog/adforpostgresql/postgresql-18-vacuuming-improvements-explained/4459484
- https://www.percona.com/blog/tuning-autovacuum-in-postgresql-and-autovacuum-internals/
