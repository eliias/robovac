# 7. Tuning by workload

tl;dr: Global autovacuum settings fit no single table. Tune per table with reloptions: give append-only tables an insert threshold and an early freeze, give update-heavy tables a low scale factor plus a fillfactor below 100, and give big OLTP tables fixed thresholds instead of percentages. No reloption helps a table behind a long transaction or a stale replication slot, because the xmin horizon blocks cleanup. TOAST tables and partitions need their own settings.

All defaults and version notes in this chapter refer to Postgres 18 unless stated otherwise. Chapter 2 covers the vacuum mechanics, chapter 4 covers the freeze internals, and chapter 8 covers the monitoring queries.

## The tool: per-table reloptions

Postgres stores per-table overrides in `pg_class.reloptions`. You set them with `ALTER TABLE ... SET`. The change is metadata only, it does not rewrite the table, and it takes only a `SHARE UPDATE EXCLUSIVE` lock for the `autovacuum_*` options.

```sql
ALTER TABLE orders SET (autovacuum_vacuum_scale_factor = 0.02);
ALTER TABLE orders RESET (autovacuum_vacuum_scale_factor);  -- back to the global value
```

Two trigger formulas drive everything below. Autovacuum vacuums a table when dead tuples exceed `autovacuum_vacuum_threshold + autovacuum_vacuum_scale_factor * reltuples` (defaults: 50 + 20%). Since Postgres 13 it also vacuums when inserts since the last vacuum exceed `autovacuum_vacuum_insert_threshold + autovacuum_vacuum_insert_scale_factor * reltuples` (defaults: 1000 + 20%).

Postgres 18 changes both formulas in your favor. A new cap, `autovacuum_vacuum_max_threshold` (default 100,000,000), triggers vacuum on very large tables even when the 20% scale factor would wait longer. The insert scale factor now counts only the unfrozen part of the table, so a mostly frozen table triggers on the new 20%, not on 20% of all rows.

## Large append-only tables

The workload: event logs, time-series data, audit trails. Rows arrive, almost none change. There are close to zero dead tuples, so the dead-tuple formula never fires.

Before Postgres 13 this was the classic failure mode. The table got no vacuum at all until `autovacuum_freeze_max_age` (default 200 million transactions) forced an anti-wraparound vacuum, which then froze the whole table in one giant pass. Since Postgres 13 the insert trigger gives these tables regular vacuums.

The default insert trigger is still too lazy for big tables. 20% of a 1 TB table means each vacuum arrives late and processes 200 GB at once. Cybertec's recipe for insert-only tables: trigger on a fixed insert count, and freeze tuples on the first pass with `vacuum_freeze_min_age = 0`, so no second freeze pass is needed later.

```sql
ALTER TABLE events SET (
    autovacuum_vacuum_insert_scale_factor = 0,
    autovacuum_vacuum_insert_threshold   = 10000000,  -- size the batch to your insert rate
    vacuum_freeze_min_age                = 0
);
```

Why freeze early here: the rows will never change, so an immediate freeze wastes nothing. Each small vacuum freezes only the new pages and sets their visibility-map bits. That keeps index-only scans fast and makes the eventual anti-wraparound vacuum a no-op. Postgres 18 adds eager freezing (`vacuum_max_eager_freeze_failure_rate`) with a similar goal, but the explicit `vacuum_freeze_min_age = 0` remains the strongest setting for pure append-only tables.

Set `vacuum_freeze_min_age = 0` per table only. As Cybertec notes, a global value of 0 wastes work on rows that soon change. Do not set `autovacuum_enabled = off` on append-only tables. The anti-wraparound vacuum comes anyway, only later and bigger.

## Update-heavy tables and HOT

The workload: counters, session state, account balances, `last_seen_at` columns. Every update creates a dead tuple, so bloat grows at the update rate.

Two knobs work together here. First, vacuum much earlier than the 20% default. Data Egret's recipe for update-heavy tables drops the percentage entirely and uses a fixed threshold:

```sql
ALTER TABLE account_balances SET (
    autovacuum_vacuum_scale_factor  = 0,
    autovacuum_vacuum_threshold     = 1000,
    autovacuum_vacuum_cost_delay    = 0,   -- vacuum this table at full speed
    fillfactor                      = 90
);
```

Second, `fillfactor` below 100 leaves free space in each page. When an update fits in the same page and touches no indexed column, Postgres performs a HOT update (heap-only tuple). A HOT update writes no index entries, and the page cleans itself without vacuum. Cybertec calls this combination the main defense for update-heavy tables. Start at `fillfactor = 90`, and try 80 or 70 for extreme cases. Michal Drozd reports about 60% less index bloat from `fillfactor = 85` plus HOT-friendly indexes on a payments workload.

Check the HOT ratio with `n_tup_hot_upd / n_tup_upd` from `pg_stat_user_tables`. A common target for hot tables is above 80%. If the ratio is low, look for an index on an updated column and remove it if you can. Note that `fillfactor` applies to new pages only. Existing pages keep their layout until a rewrite (`VACUUM FULL` or `pg_repack`).

For scale, GitLab runs its multi-terabyte database with a global `autovacuum_vacuum_scale_factor = 0.01` (they tested 0.005), `autovacuum_vacuum_cost_limit = 3000`, and 10 workers. Keith Fiske's per-table recipe for an 800-million-row table with about 400,000 daily changes: scale factors 0, `autovacuum_vacuum_threshold = 400000`, `autovacuum_analyze_threshold = 100000`.

### The queue-table pathology

A job queue table (pgq, delayed_job, que, good_job, Solid Queue) is the extreme case. Rows are inserted, read once, and deleted. Live size stays near zero while churn is enormous. Richard Yen documents queue tables that grew to tens of gigabytes while live data was a few megabytes. Brandur Leach describes the 2015 Heroku incident where the que table backed up by 60,000 jobs in one hour because every poll scanned piles of dead tuples.

The trap: aggressive reloptions alone do not fix this. PlanetScale's 2026 test ran a queue at 800 jobs per second next to analytics queries. The analytics transactions pinned the xmin horizon, 383,000 dead tuples piled up in 15 minutes, and lock acquisition went from 2 ms to over 300 ms. Vacuum ran, but it could remove nothing newer than the oldest open snapshot (see the next section).

The recipe for queue tables:

1. Set the update-heavy reloptions above (`scale_factor = 0`, `threshold = 1000`, `cost_delay = 0`, `fillfactor` 50 to 90).
2. Keep every transaction that touches the database short. One 2-minute report query pins the horizon for the full 2 minutes.
3. Keep only the indexes the dequeue query needs, and make updates HOT-eligible.
4. If bloat still wins, move old jobs out by partition drop or `TRUNCATE` instead of `DELETE`. PostgresAI recommends partitions even for small queue-like tables, because a dropped partition needs no vacuum at all.
5. Plan a periodic `REINDEX CONCURRENTLY` or `pg_repack` for the steady-state residue.

## Mixed OLTP tables

The workload: normal application tables with inserts, updates, and deletes. Here the defaults are the problem only at size. The default trigger of 20% means a 50-million-row table waits for 10,000,050 dead tuples before the first vacuum. The same math with `autovacuum_vacuum_scale_factor = 0.02` triggers at 1,000,050 dead tuples, ten times sooner.

A simple size-based policy works well in practice, close to what pgAssistant and the Azure Postgres guide recommend:

| Table size           | Recipe                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| < 1 GB or < 1 M rows | keep the defaults                                                                                                  |
| 1 to 50 M rows       | `autovacuum_vacuum_scale_factor = 0.02`, `autovacuum_analyze_scale_factor = 0.01`                                  |
| > 50 M rows          | scale factors 0, fixed thresholds sized to the daily change rate (for example vacuum at 500000, analyze at 100000) |

Let ANALYZE run more often than VACUUM. Fresh statistics are cheap and protect the planner, while each vacuum pass costs real I/O. Keith Fiske's cluster-wide baseline reflects this: analyze at 5% + 500 rows, vacuum at 10% + 500 rows.

On Postgres 18 the `autovacuum_vacuum_max_threshold` cap of 100 million already bounds the worst case for huge tables. It is a backstop, not a tuning target. A table that accumulates 100 million dead tuples between vacuums is already in trouble.

## Tables behind long transactions or replication slots

Vacuum can only remove dead tuples that no snapshot can still see. The oldest such point is the xmin horizon. Cybertec lists the four holders of the horizon:

1. A long-running transaction on the primary (including idle-in-transaction sessions).
2. An abandoned or lagging replication slot (check `pg_replication_slots.xmin`, and `catalog_xmin` for logical slots).
3. A long query on a standby with `hot_standby_feedback = on`.
4. An orphaned prepared transaction (`pg_prepared_xacts`).

While any of these holds the horizon, no reloption in this chapter helps. Autovacuum runs on schedule, reports the rows as "dead but not yet removable", and removes zero. Lowering the scale factor only makes it fail more often. The fix is always to release the horizon, not to tune the table:

- Set `idle_in_transaction_session_timeout` (for example 5 minutes) for application roles.
- On Postgres 17 or later, set `transaction_timeout` as a hard cap.
- Drop replication slots that no consumer reads. On Postgres 18, `idle_replication_slot_timeout` invalidates them automatically.
- Run heavy analytics on a replica without `hot_standby_feedback`, and accept query cancellations there instead of bloat on the primary.

Chapter 8 shows the monitoring queries for the horizon. The rule of thumb from PostgresAI: alert when the horizon is more than 1 hour old on an OLTP system.

## TOAST tables

Postgres stores values wider than about 2 kB in a hidden companion table, the TOAST table (`pg_toast.pg_toast_<oid>`). The TOAST table is a separate relation with its own autovacuum trigger math and its own reloptions. Tuning the main table does not tune its TOAST table.

This bites tables with hot `jsonb`, `text`, or `bytea` columns. The main table can look calm while the TOAST table churns, because every update of a toasted value deletes and reinserts the TOAST rows. With defaults, a TOAST table of 51 million chunks waits for over 10 million dead chunks before a vacuum.

Set TOAST options through the main table with the `toast.` prefix:

```sql
ALTER TABLE documents SET (
    autovacuum_vacuum_scale_factor       = 0.02,
    toast.autovacuum_vacuum_scale_factor = 0.02,
    toast.autovacuum_vacuum_cost_delay   = 0
);
```

Mirror your main-table vacuum settings onto the TOAST table whenever the wide columns change. ANALYZE options do not apply, because TOAST tables hold no planner statistics. Find bloated TOAST tables by joining `pg_class.reltoastrelid`, chapter 8 has the query.

## Partitioned tables

Autovacuum treats every partition as an ordinary table. Each partition gets its own trigger math on its own row counts. This is the good news: partitions turn one 2 TB vacuum problem into 100 problems of 20 GB, and a dropped partition removes its dead tuples for free.

Two traps remain. First, reloptions on the partitioned parent do not propagate to partitions. You must set them on each partition, and on each future partition. With pg_partman (4.5.1 or later), put the reloptions on the template table and new partitions inherit them. With native partition creation, add the `ALTER TABLE` to the script that creates partitions.

Second, autovacuum never runs ANALYZE on the partitioned parent, in all versions through Postgres 18. The parent stores no rows, so nothing triggers it, yet the planner uses the parent's inheritance statistics for queries on the whole table. Without a manual ANALYZE these statistics go stale or never exist. GitLab schedules exactly this as a cron job. Do the same:

```sql
ANALYZE measurements;  -- the parent: samples all partitions, run on a schedule
```

Run it after the first data load, after each large partition change, and otherwise on a fixed schedule (daily is a common choice).

## Summary: workload to settings

| Workload                | Key reloptions                                                                                                                                                                           | Reason                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Append-only, large      | `autovacuum_vacuum_insert_scale_factor = 0`, `autovacuum_vacuum_insert_threshold` sized to insert rate, `vacuum_freeze_min_age = 0`                                                      | Freeze once, early, in small batches. Keep the visibility map set.     |
| Update-heavy, hot       | `autovacuum_vacuum_scale_factor = 0`, `autovacuum_vacuum_threshold = 1000`, `autovacuum_vacuum_cost_delay = 0`, `fillfactor = 90` (50 to 90 when extreme), no indexes on updated columns | Vacuum by count, not percent. HOT updates avoid index writes.          |
| Queue table             | Update-heavy settings, plus short transactions everywhere, plus partition drop or `TRUNCATE` for cleanup                                                                                 | Reloptions cannot beat a pinned xmin horizon.                          |
| Mixed OLTP, > 1 M rows  | `autovacuum_vacuum_scale_factor = 0.02`, `autovacuum_analyze_scale_factor = 0.01`, fixed thresholds above 50 M rows                                                                      | The 20% default scales badly with row count.                           |
| Behind long xact / slot | None. Fix timeouts (`idle_in_transaction_session_timeout`, `transaction_timeout` on 17+) and drop stale slots                                                                            | Vacuum cannot remove tuples the horizon still protects.                |
| Wide columns (TOAST)    | Repeat vacuum settings with the `toast.` prefix                                                                                                                                          | The TOAST table has separate settings and defaults.                    |
| Partitioned             | Reloptions per partition (pg_partman template), scheduled `ANALYZE` on the parent                                                                                                        | Parent options do not propagate. Autovacuum never analyzes the parent. |

Treat every number above as a starting point. Measure the dead-tuple curve and the vacuum frequency per table (chapter 8), change one setting, and measure again.

## Sources

- https://www.postgresql.org/docs/current/runtime-config-autovacuum.html
- https://www.postgresql.org/docs/current/routine-vacuuming.html
- https://www.cybertec-postgresql.com/en/postgresql-autovacuum-insert-only-tables/
- https://www.cybertec-postgresql.com/en/hot-updates-in-postgresql-for-better-performance/
- https://www.cybertec-postgresql.com/en/reasons-why-vacuum-wont-remove-dead-rows/
- https://www.keithf4.com/per-table-autovacuum-tuning/
- https://dataegret.com/2022/02/vacuuming-update-heavy-tables/
- https://planetscale.com/blog/keeping-a-postgres-queue-healthy
- https://brandur.org/postgres-queues
- https://richyen.com/postgres/2026/05/04/postgres_job_queue.html
- https://gitlab.com/gitlab-com/gl-infra/production/-/work_items/1387
- https://gitlab.com/gitlab-org/gitlab/-/issues/423135
- https://pganalyze.com/blog/5mins-postgres-autovacuum-dead-tuples-not-yet-removable-postgres-xmin-horizon
- https://postgres.ai/docs/postgres-howtos/database-administration/maintenance/how-to-deal-with-bloat
- https://postgres.ai/docs/postgres-howtos/performance-optimization/monitoring/how-to-monitor-xmin-horizon
- https://www.dbi-services.com/blog/postgresql-18-introduce-autovacuum_vacuum_max_threshold/
- https://techcommunity.microsoft.com/blog/adforpostgresql/postgresql-18-vacuuming-improvements-explained/4459484
- https://learn.microsoft.com/en-us/azure/postgresql/troubleshoot/how-to-autovacuum-tuning
- https://github.com/pgpartman/pg_partman/discussions/625
- https://www.michal-drozd.com/en/blog/postgresql-hot-updates-fillfactor/
- https://beh74.github.io/pgassistant-blog/post/vaccum/
