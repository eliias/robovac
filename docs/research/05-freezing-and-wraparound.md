# 5. Freezing and wraparound

tl;dr: Postgres identifies write transactions with a 32-bit counter, the XID. The counter wraps, so each row can only stay "visible" for about 2.1 billion transactions. Vacuum freezes old rows to make them visible forever, and records progress in `relfrozenxid`. A ladder of defenses protects the counter: normal freezing at age 50 million, aggressive vacuums at 150 million, forced anti-wraparound autovacuums at 200 million, a failsafe at 1.6 billion, and a hard stop with 3 million XIDs left. Monitor `age(relfrozenxid)` so you never meet the higher rungs. Multixact IDs have the same problem and their own set of knobs.

## The 32-bit XID space

Every write transaction gets a transaction ID, the XID. The XID is a 32-bit number, so the space holds about 4.3 billion values. Read-only transactions do not consume an XID. Each row header stores the XID that created it (`xmin`) and the XID that deleted it (`xmax`).

Visibility checks compare XIDs: a row is visible to you when its `xmin` committed before your snapshot. But a 32-bit counter wraps back to zero, so Postgres cannot compare XIDs as plain integers. Instead it uses circular arithmetic. For any XID, about 2.1 billion XIDs count as "in the past" and about 2.1 billion count as "in the future".

This circular comparison is the root of the wraparound danger. If a row's `xmin` falls more than about 2.1 billion transactions behind the current XID, the comparison flips. The old committed row now looks like it comes from the future. Postgres treats it as not yet visible. The data is still on disk, but every query acts as if the row does not exist. That is silent data loss, which is why Postgres shuts down writes before it can happen.

## What freezing does

Freezing marks a row as "created so long ago that every current and future snapshot can see it". A frozen row no longer needs an XID comparison, so its real `xmin` can fall arbitrarily far behind without harm.

Since Postgres 9.4, freezing sets a flag in the row header (the two hint bits that form `HEAP_XMIN_FROZEN`). The original `xmin` value stays in place for forensic use. Before 9.4, vacuum overwrote `xmin` with the special value `FrozenTransactionId` (the number 2). Since 9.6, the visibility map also has an all-frozen bit per page, so later vacuums can skip pages that hold only frozen rows.

Vacuum tracks freeze progress in the catalog. `pg_class.relfrozenxid` is a per-table watermark: every row XID older than this value is frozen. `pg_database.datfrozenxid` is the minimum across all tables in a database. The function `age(relfrozenxid)` returns the distance between that watermark and the current XID. Keep this age low and wraparound stays a theory.

```sql
-- Freezing in action: xmin survives, the row becomes frozen
CREATE TABLE t (id int);
INSERT INTO t VALUES (1);
VACUUM (FREEZE) t;
SELECT relfrozenxid, age(relfrozenxid) FROM pg_class WHERE relname = 't';
```

## The freeze knobs

Four parameters control XID freezing. All defaults below are current in Postgres 18.

| Parameter | Default | Meaning |
|---|---|---|
| `vacuum_freeze_min_age` | 50 million | A vacuum freezes row XIDs older than this age |
| `vacuum_freeze_table_age` | 150 million | A vacuum on a table with `relfrozenxid` older than this becomes aggressive |
| `autovacuum_freeze_max_age` | 200 million | Postgres forces an anti-wraparound autovacuum at this table age |
| `vacuum_failsafe_age` | 1.6 billion | A running vacuum enters failsafe mode at this table age (PG14+) |

The knobs cap each other, so one bad setting cannot disable the ladder:

- Postgres silently limits `vacuum_freeze_min_age` to half of `autovacuum_freeze_max_age`.
- Postgres silently limits `vacuum_freeze_table_age` to 95% of `autovacuum_freeze_max_age`.
- Postgres silently raises `vacuum_failsafe_age` to at least 105% of `autovacuum_freeze_max_age`.

The interplay: `vacuum_freeze_min_age` decides which rows a vacuum freezes. `vacuum_freeze_table_age` decides when a vacuum must scan the whole table so `relfrozenxid` can advance far. `autovacuum_freeze_max_age` decides when Postgres stops waiting and forces that vacuum itself. A lower `vacuum_freeze_min_age` freezes rows earlier, which spreads the freeze work but can waste effort on rows that a later update rewrites anyway.

## Worked example: the ladder for one table

Take a table on default settings. Its `age(relfrozenxid)` climbs by one for every write transaction in the cluster, not only writes to this table. Assume the cluster burns 20 million XIDs per day, a realistic rate for a busy OLTP system. The table then climbs one rung of this ladder every few days:

| `age(relfrozenxid)` | Day | What happens |
|---|---|---|
| 50 million | 2.5 | Vacuums that visit a page freeze rows older than 50 million |
| 150 million | 7.5 | The next vacuum runs as an aggressive vacuum |
| 200 million | 10 | Postgres forces an anti-wraparound autovacuum |
| 1.6 billion | 80 | A running vacuum triggers the failsafe |
| ~2.107 billion | ~105 | 40 million XIDs left: warnings in the log |
| ~2.144 billion | ~107 | 3 million XIDs left: Postgres refuses new XIDs |

On a healthy system the ladder ends at day 10. The forced autovacuum resets `relfrozenxid` and the climb starts again. The higher rungs exist only for the case where vacuum cannot finish: a stuck lock, a forgotten `autovacuum = off`, a long-open transaction, or a stale replication slot that holds back the freeze horizon.

## Aggressive vacuum

A normal vacuum skips pages that the visibility map marks all-visible, because they hold no dead rows. That is fast, but skipped pages can still hold old unfrozen XIDs. So a normal vacuum can only advance `relfrozenxid` a little, or not at all.

An aggressive vacuum scans every page that is not already all-frozen, including all-visible pages. It freezes all eligible XIDs and multixact IDs. After it finishes, Postgres can advance `relfrozenxid` to a recent value. An aggressive vacuum is not a separate command. It is the same vacuum with a wider scan, and it still runs concurrently with normal traffic.

A vacuum escalates to aggressive in three cases:

1. The table's `relfrozenxid` is older than `vacuum_freeze_table_age` (150 million by default).
2. You run `VACUUM (FREEZE)`, which also sets the freeze cutoff to "now".
3. Every page that is not all-frozen needs vacuuming anyway, so the scan covers them by accident.

Since Postgres 15, vacuum sets `relfrozenxid` to the oldest XID that remains in the table, not to the freeze cutoff. So an aggressive vacuum on a fully frozen table can advance the watermark almost to the current XID.

## Anti-wraparound autovacuum

When `age(relfrozenxid)` passes `autovacuum_freeze_max_age` (200 million by default), Postgres launches an autovacuum on that table. This launch has two special properties.

First, it fires even when autovacuum is disabled. `autovacuum = off` turns off routine cleanup, not wraparound protection. Second, the worker does not yield to lock waiters. A regular autovacuum cancels itself when another session requests a conflicting lock, for example a DDL statement. An anti-wraparound autovacuum ignores that signal and keeps running. You can spot it in `pg_stat_activity`: the query text ends with `(to prevent wraparound)`.

This non-cancel behavior is a common source of production surprise. A migration that needs an `ACCESS EXCLUSIVE` lock queues behind the wraparound vacuum, and every later query queues behind the migration. The fix is prevention: keep table ages below 200 million so this vacuum type never starts. Chapter 4 covers the trigger scheduling that normally gets vacuums there first.

## The failsafe (PG14+)

Postgres 14 added a last defense inside vacuum itself. While a vacuum runs, it periodically checks the table age against `vacuum_failsafe_age` (1.6 billion by default). Past that age, the vacuum drops everything that is not essential for freezing:

- It stops applying the cost-based delay, so it runs at full speed.
- It skips index vacuuming and heap truncation.
- It disables its ring-buffer strategy, so it can use all of shared buffers.

The failsafe trades cleanup quality for speed. Indexes keep their dead entries and bloat grows, but `relfrozenxid` advances before the cluster hits the stop limit. If you see the failsafe message in the log, treat it as an incident: something blocked freezing for 1.4 billion XIDs past the normal forced trigger.

## The stop limit and recovery

Two hard thresholds sit at the end of the XID space. When the oldest database is 40 million XIDs from the wraparound point, Postgres writes warnings to the log on every XID assignment. When 3 million XIDs remain, Postgres refuses to assign new XIDs at all. Writes fail with an error. Read-only queries continue to work.

```
ERROR:  database is not accepting commands that assign new XIDs
        to avoid wraparound data loss in database "mydb"
HINT:  Execute a database-wide VACUUM in that database.
```

Recovery does not require single-user mode on any supported version. Postgres 13 and older printed a hint that told you to vacuum in single-user mode. Postgres 14 changed the hint, and the current documentation says to avoid single-user mode, because it takes the system down and disables the wraparound safeguards. Plain `VACUUM` runs fine in normal multi-user mode, because it does not need a new XID.

The recovery sequence, in order:

1. Find and remove whatever holds back the freeze horizon: commit or roll back long-open transactions (`pg_stat_activity`), resolve old prepared transactions (`pg_prepared_xacts`), and drop stale replication slots (`pg_replication_slots`).
2. Run plain `VACUUM` on the tables with the highest `age(relfrozenxid)` first, then database-wide.
3. Do not run `VACUUM FULL`. It needs an XID, so it fails, or in superuser mode it consumes one.
4. Do not run `VACUUM FREEZE`. It does more work than the minimum needed to reopen writes.

The 3-million-XID margin exists so an administrator can `TRUNCATE` or `DROP` disposable tables instead of vacuuming them. That is the only remaining use for single-user mode in this scenario.

## Multixact wraparound

When more than one transaction locks the same row, for example through `SELECT ... FOR SHARE` or foreign-key checks, Postgres replaces `xmax` with a multixact ID. The multixact ID points to a list of member transactions. Multixact IDs come from their own 32-bit counter, so they wrap exactly like XIDs and need their own freezing.

The knobs mirror the XID knobs:

| Parameter | Default |
|---|---|
| `vacuum_multixact_freeze_min_age` | 5 million |
| `vacuum_multixact_freeze_table_age` | 150 million |
| `autovacuum_multixact_freeze_max_age` | 400 million |
| `vacuum_multixact_failsafe_age` | 1.6 billion (PG14+) |

The watermarks are `pg_class.relminmxid` and `pg_database.datminmxid`, measured with `mxid_age()`. The same ladder applies: aggressive vacuums, forced autovacuums even with autovacuum off, a failsafe, warnings at 40 million remaining, and a stop at 3 million remaining. The multixact stop only blocks commands that would create a multixact, so most plain writes continue.

Multixacts add a second limit. The member lists live in a separate storage area that holds about 20 GB at most. When member storage passes about 10 GB, Postgres starts aggressive vacuums on the tables with the oldest multixact age, again even when autovacuum is off. Workloads with heavy foreign-key contention can hit the member limit long before the ID limit.

## Monitoring

Track two numbers per cluster: the maximum `age(datfrozenxid)` across databases and the maximum `mxid_age(datminmxid)`. Alert at 500 million, page at 1 billion. Both leave days of margin at most burn rates.

```sql
-- Per database: distance to forced autovacuum and to shutdown
SELECT datname,
       age(datfrozenxid) AS xid_age,
       mxid_age(datminmxid) AS mxid_age
FROM pg_database
ORDER BY 2 DESC;

-- Worst tables in the current database
SELECT c.oid::regclass AS table_name,
       age(c.relfrozenxid) AS xid_age,
       mxid_age(c.relminmxid) AS mxid_age,
       pg_size_pretty(pg_table_size(c.oid)) AS size
FROM pg_class c
WHERE c.relkind IN ('r', 'm', 't')
ORDER BY 2 DESC
LIMIT 20;

-- Is an anti-wraparound vacuum running right now?
SELECT pid, datname, query, xact_start
FROM pg_stat_activity
WHERE query LIKE '%to prevent wraparound%';
```

Also watch the horizon holders, because they block freezing no matter how hard vacuum works: `age(backend_xmin)` in `pg_stat_activity`, `age(transaction)` in `pg_prepared_xacts`, and `age(xmin)` in `pg_replication_slots`.

## How freezing got more eager (PG15 to PG18)

The classic design deferred all freeze work, which produced rare but giant aggressive vacuums. Recent releases spread that work out:

- Postgres 15: vacuum sets `relfrozenxid` to the oldest XID that remains after the scan, instead of the conservative freeze cutoff. Watermarks now advance on every qualifying vacuum, and by a larger amount.
- Postgres 16: vacuum decides freezing per page, not per tuple. When it prunes a page and would emit a full-page WAL image anyway, it can freeze all rows on that page at once, ahead of `vacuum_freeze_min_age`. This makes full-table freeze vacuums less necessary.
- Postgres 17: pruning and freezing share one WAL record, so freeze work writes less WAL. A new memory structure for dead-tuple IDs also removed the 1 GB memory limit, which helps big aggressive vacuums finish in one pass.
- Postgres 18: normal vacuums eagerly scan a portion of all-visible but not all-frozen pages and try to freeze them. The knob `vacuum_max_eager_freeze_failure_rate` (default 0.03) stops eager scanning after failed freeze attempts on 3% of the table's pages. Successful eager freezes are capped at 20% of the all-visible, not all-frozen pages per vacuum, which amortizes the work across cycles.

The practical effect: on Postgres 18 an insert-mostly table freezes gradually during normal vacuums. On Postgres 14 the same table accumulated hundreds of millions of unfrozen XIDs and then paid for them in one aggressive vacuum.

## Field notes: real wraparound outages

Sentry (July 2015) lost most of a US working day when wraparound protection stopped writes, and recovery meant vacuuming huge relations under time pressure. Mandrill (February 2019) had identified rising XID ages months earlier and put monitoring in a backlog ticket. Autovacuum then fell behind on one hot shard, the stop limit hit, and the outage ran about 40 hours of truncations and manual vacuums.

Both incidents share one lesson: the database gave days of warning through `age(relfrozenxid)`, and nobody was watching the number. The ladder of automatic defenses works, but each rung is slower and more disruptive than the one below it. Cheap monitoring keeps you on the bottom rung.

## Sources

- https://www.postgresql.org/docs/current/routine-vacuuming.html
- https://www.postgresql.org/docs/current/runtime-config-vacuum.html
- https://www.postgresql.org/docs/current/sql-vacuum.html
- https://www.postgresql.org/docs/release/18.0/
- https://www.postgresql.org/docs/release/17.0/
- https://www.postgresql.org/docs/16/release-16.html
- https://postgresqlco.nf/doc/en/param/vacuum_max_eager_freeze_failure_rate/
- https://techcommunity.microsoft.com/blog/adforpostgresql/postgresql-18-vacuuming-improvements-explained/4459484
- https://www.postgresql.org/message-id/CAMT0RQTmRj_Egtmre6fbiMA9E2hM3BsLULiV8W00stwa3URvzA@mail.gmail.com (single-user mode discussion)
- https://wiki.postgresql.org/wiki/Freezing/skipping_strategies_patch:_motivating_examples
- https://blog.sentry.io/2015/07/23/transaction-id-wraparound-in-postgres/
- https://mailchimp.com/what-we-learned-from-the-recent-mandrill-outage/
- https://cloud.google.com/sql/docs/postgres/txid-wraparound
