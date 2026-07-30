# 4. Cost-based throttling

tl;dr: Vacuum limits its own I/O with a token budget. Each page it touches costs 1, 2, or 20 points. When the running total reaches `vacuum_cost_limit` (200), the process sleeps for `autovacuum_vacuum_cost_delay` (2 ms). The defaults allow at most 100,000 points per second: about 800 MB/s of cached reads, 400 MB/s of disk reads, or 40 MB/s of page writes. All autovacuum workers share this one budget, so more workers do not mean more total throughput. Before PostgreSQL 12 the budget was 10x smaller, and many tuning guides still reflect that era. Large deployments raise `vacuum_cost_limit` to 1,000 to 6,000, or turn throttling off for emergencies.

## Why vacuum throttles itself

Vacuum reads whole tables and indexes, and it dirties many pages. Without a limit, one vacuum run can saturate the disks and slow every foreground query. PostgreSQL added cost-based throttling in version 8.0 (2005) to cap this impact.

The mechanism is simple. Vacuum counts an estimated cost for each page it touches. When the count reaches a limit, vacuum sleeps. The sleep spreads the I/O over time instead of issuing it in one burst.

The throttle applies to `VACUUM` and to `ANALYZE`. Autovacuum enables it by default. A manual `VACUUM` runs unthrottled by default, because `vacuum_cost_delay` defaults to 0.

## The cost model: three page prices

Vacuum charges a fixed price per page, based on what it had to do with that page:

| Parameter | Default (PG 14+) | Charged when vacuum... |
|---|---|---|
| `vacuum_cost_page_hit` | 1 | reads a page that is already in shared buffers |
| `vacuum_cost_page_miss` | 2 | reads a page from disk (or the OS cache) |
| `vacuum_cost_page_dirty` | 20 | modifies a page that was clean before |

The prices are relative weights, not real I/O measurements. The model says: a disk read costs 2x a cache hit, and dirtying a page costs 10x a disk read. Dirtying is the most expensive action because the page must later be written to disk, and the change also produces WAL.

Version note: `vacuum_cost_page_miss` was 10 before PostgreSQL 14. Commit `e19594c5` lowered it to 2, because modern storage and larger memory made reads much cheaper relative to writes. On PostgreSQL 13 and older, read-heavy vacuums are throttled 5x harder than on 14+.

One structural detail makes misses and dirties common. Vacuum reads through a small ring buffer (256 KB by default, configurable with `vacuum_buffer_usage_limit` since PostgreSQL 16). A vacuum of a table larger than the ring is mostly page misses, no matter how big `shared_buffers` is.

## The budget and the sleep loop

The loop lives in `vacuum_delay_point()`, which vacuum calls about once per page:

1. Add the cost of the page action to a per-backend counter (the balance).
2. If the balance is below `vacuum_cost_limit` (default 200), continue.
3. If the balance reached the limit, sleep for `delay * balance / limit` milliseconds, capped at 4x the delay.
4. Reset the balance and continue.

So the delay is proportional: one full budget of work buys one `vacuum_cost_delay` of sleep. Code paths that hold critical locks skip the sleep and let the balance run over, which is why the 4x cap exists.

Two delay settings exist:

| Parameter | Default | Applies to |
|---|---|---|
| `vacuum_cost_delay` | 0 (throttling off) | manual `VACUUM` and `ANALYZE` |
| `autovacuum_vacuum_cost_delay` | 2 ms | autovacuum workers |
| `autovacuum_vacuum_cost_limit` | -1 (inherit `vacuum_cost_limit` = 200) | autovacuum workers |

Version note: `autovacuum_vacuum_cost_delay` was 20 ms before PostgreSQL 12. Version 12 lowered it to 2 ms and made the setting a float, so values below 1 ms are possible. This one change made autovacuum 10x faster by default.

Since PostgreSQL 16, a config reload (`SELECT pg_reload_conf()`) updates the cost settings inside a running vacuum (commit `7d71d3dd`). Before 16, a worker read the settings once at start, so a mid-flight tuning change only helped the next run.

## How workers share the budget

Autovacuum balances the cost limit across its workers. The active workers split `autovacuum_vacuum_cost_limit` so that their sum stays at the limit. With the defaults, 3 workers on 3 tables get about 67 points each per 2 ms, not 200 each.

The consequence surprises many operators: raising `autovacuum_max_workers` adds parallelism across tables but adds zero total throughput. Each table gets vacuumed slower. To scale throughput with workers, raise `autovacuum_vacuum_cost_limit` in proportion.

Tables with per-table cost settings opt out of balancing. A table with `ALTER TABLE t SET (autovacuum_vacuum_cost_delay = 0)` or a per-table cost limit gets its own private budget, and the remaining workers split the shared one. Parallel index vacuum workers (PG 13+) share the budget of their leader, so parallel vacuum does not dodge the throttle either.

## From cost points to MB/s

The budget refills once per delay, so the ceiling is:

```
points_per_second = vacuum_cost_limit / vacuum_cost_delay
pages_per_second  = points_per_second / cost_per_page
MB_per_second     = pages_per_second * 8 KB / 1024
```

With the defaults (limit 200, delay 2 ms): 200 / 0.002 = 100,000 points per second. That converts to these ceilings, one action type at a time:

| Action | Cost per page | Pages/s | Throughput |
|---|---|---|---|
| Read from shared buffers | 1 | 100,000 | ~800 MB/s |
| Read from disk | 2 | 50,000 | ~400 MB/s |
| Dirty a page | 20 | 5,000 | ~40 MB/s |

These are ceilings, not measurements. The sleep math ignores the time the work itself takes, so real throughput is lower. Real vacuums also mix all three actions, and the dirty price dominates the mix.

### Worked example: a 100 GB table

Take a 100 GB table, which is 13,107,200 pages of 8 KB. Assume vacuum reads every page from disk (the ring buffer makes this realistic) and dirties 25% of them.

Cost per page: 2 (miss) + 0.25 * 20 (dirty) = 7 points. Budget: 100,000 points per second. Rate: 100,000 / 7 = ~14,300 pages/s, which is ~112 MB/s. One heap pass takes 13,107,200 / 14,300 = ~917 seconds, about 15 minutes. Index scans and a second heap pass add more time on top.

Now the same table on PostgreSQL 11 defaults (delay 20 ms, miss cost 10). Budget: 200 / 0.020 = 10,000 points per second. Cost per page: 10 + 0.25 * 20 = 15 points. Rate: 667 pages/s, which is ~5 MB/s. One heap pass takes ~5.5 hours. This 22x gap is why so many pre-2019 war stories describe autovacuum as "too slow to ever finish".

## Defaults vs what large deployments set

The current defaults give a ~40 MB/s write ceiling. That is enough for tables up to a few hundred GB with moderate churn. It is not enough when one table takes hours per vacuum and dead rows pile up faster than vacuum removes them (chapter 3 covers the trigger math).

Common practice from published sources:

- Christophe Pettus (thebuild.com) recommends `vacuum_cost_limit` of at least 1,000 on contemporary hardware, and scaling it with the worker count.
- GitLab.com production issues document `autovacuum_vacuum_cost_limit = 6000` with `autovacuum_vacuum_cost_delay = 5 ms`, and a later change from 1,000 to 5,000. At 6000 / 5 ms the budget is 1,200,000 points per second, 12x the default.
- Azure's autovacuum tuning guide tells operators to raise the cost limit or lower the delay when `pg_stat_progress_vacuum` shows vacuums that do not keep up.

Prefer raising the limit over shrinking the delay. The delay is already 2 ms, and sub-millisecond sleeps are at the edge of what timers resolve well. A limit of 2,000 with the 2 ms delay gives a ~400 MB/s write ceiling, which a modern NVMe volume absorbs without drama.

Set the global limit for the fleet of workers, and use per-table settings only for outliers. Per-table cost settings remove the table from balancing, so each one is a small unaudited budget increase.

## The tradeoff: vacuum speed vs foreground work

Throttling trades vacuum speed for foreground latency. The costs of vacuuming too fast:

- Disk bandwidth and IOPS compete with queries. On provisioned-IOPS cloud volumes, vacuum I/O spends the same credits as user I/O.
- Dirtied pages become checkpoint and background-writer work.
- The WAL that vacuum produces must ship to every replica. A fast vacuum on a 500 GB table can produce a WAL burst that pushes replication lag from seconds to minutes, and stalls logical decoding behind it.

The costs of vacuuming too slowly are worse, only delayed:

- Dead rows accumulate as bloat, and every query pays for the bloat forever (chapter 2).
- Long vacuums hold back the xmin horizon and grow the risk that `autovacuum_max_workers` are all stuck on giant tables.
- In the limit, the wraparound clock wins (chapter 5 covers freezing).

A useful mental model: the throttle sets vacuum's steady-state throughput. Robovac's job, and any operator's job, is to make that throughput exceed the workload's steady-state garbage rate with headroom, while keeping the burst impact acceptable.

## WAL from vacuum

Vacuum writes WAL for almost everything it does: pruning dead tuples, marking pages all-visible, freezing rows, and deleting index entries. The first change to a page after a checkpoint also writes a full-page image of 8 KB (before compression). A vacuum that dirties most of a large table can therefore produce WAL on the order of the table size.

The cost model does not count WAL bytes at all. The dirty price of 20 is the only proxy, so two vacuums with the same cost can produce very different WAL volumes. A freeze-heavy vacuum (chapter 5) is the worst case, because freezing rewrites tuple headers across the whole table.

Mitigations, in order of impact:

1. Throttle enough that WAL production stays under the replicas' replay and network capacity. This is the one lever the cost model gives you.
2. Turn on `wal_compression`, which shrinks full-page images.
3. Run PostgreSQL 17 or newer. Version 17 merged the prune and freeze WAL records into one, which cut WAL records by ~30% and WAL bytes by ~12% in the committer's tests.

## When to disable throttling

Turn the throttle off when finishing fast matters more than foreground impact:

- Emergency bloat or wraparound cleanup: run a manual `VACUUM`, which is unthrottled by default. For autovacuum, set `ALTER TABLE t SET (autovacuum_vacuum_cost_delay = 0)` on the affected table.
- Maintenance windows: batch jobs at night can run unthrottled and finish in a fraction of the time.
- Restores and migrations before traffic arrives: there is no foreground work to protect.

PostgreSQL 14+ does one of these automatically. When a table's oldest transaction ID passes `vacuum_failsafe_age` (default 1.6 billion), vacuum enters failsafe mode: it drops the cost delay, skips index vacuuming, and stops using the ring buffer. If you see the failsafe trigger, your throttle was too tight for far too long.

Do not set the global `autovacuum_vacuum_cost_delay` to 0 as a permanent policy on a busy cluster. Unthrottled autovacuum plus a large `shared_buffers` write burst is a common source of latency spikes and replica lag. A high limit with the 2 ms delay keeps a ceiling in place while removing the practical bottleneck.

## Measuring the throttle

You can now measure sleep time directly. PostgreSQL 18 adds `track_cost_delay_timing` (off by default). With it on, `pg_stat_progress_vacuum.delay_time` reports the milliseconds a vacuum spent sleeping, `VACUUM (VERBOSE)` prints it, and autovacuum log lines include it when `log_autovacuum_min_duration` is set.

```sql
-- PostgreSQL 18+
SET track_cost_delay_timing = on;   -- or ALTER SYSTEM + reload
SELECT pid, relid::regclass, phase,
       delay_time,                   -- ms spent sleeping
       heap_blks_scanned, heap_blks_total
FROM pg_stat_progress_vacuum;
```

A `delay_time` near the vacuum's wall-clock time means the throttle, not the disk, sets the pace. That is the signal to raise `vacuum_cost_limit`. On older versions, compare a vacuum's actual MB/s (from `log_autovacuum_min_duration` output) against the computed ceiling. On Amazon RDS, the wait event `Timeout:VacuumDelay` in Performance Insights shows the same thing.

## Sources

- https://www.postgresql.org/docs/current/runtime-config-vacuum.html
- https://pganalyze.com/docs/vacuum-advisor/how-does-the-vacuum-cost-model-work
- https://pganalyze.com/blog/5mins-postgres-16-vacuum-cost-limit-parallel-aggregate
- https://github.com/postgres/postgres/commit/7d71d3dd
- https://github.com/postgres/postgres/commit/e19594c5
- https://www.postgresql.org/message-id/CAH2-WzmLPFnkWT8xMjmcsm7YS3+_Qi3iRWAb2+_Bc8UhVyHfuA@mail.gmail.com
- https://thebuild.com/blog/all-your-gucs-in-a-row-autovacuumnaptime-autovacuumvacuumcostdelay-autovacuumvacuumcostlimit/
- https://thebuild.com/blog/all-your-gucs-in-a-row-autovacuummaxworkers/
- https://learn.microsoft.com/en-us/azure/postgresql/troubleshoot/how-to-autovacuum-tuning
- https://gitlab.com/gitlab-com/gl-infra/production/-/work_items/1387
- https://gitlab.com/gitlab-com/gl-infra/reliability/-/issues/2108
- https://www.percona.com/blog/tuning-autovacuum-in-postgresql-and-autovacuum-internals/
- https://www.postgresql.org/docs/release/17.0/
- https://www.depesz.com/2025/02/13/waiting-for-postgresql-18-add-cost-based-vacuum-delay-time-to-progress-views/
- https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/wait-event.timeoutvacuumdelay.html
- https://www.postgresql.org/docs/current/routine-vacuuming.html
