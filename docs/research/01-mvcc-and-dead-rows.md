# 1. MVCC and dead rows

tl;dr: Postgres never changes a row in place. Every UPDATE writes a new copy of the row and marks the old copy as expired. Every DELETE only marks the row as expired. The old copies stay on disk as dead rows until cleanup removes them. Cleanup can only remove a dead row when no transaction can still see it. One old snapshot, one idle replication slot, or one forgotten prepared transaction can block cleanup for the whole cluster.

## Why Postgres keeps old row versions

Postgres uses multi-version concurrency control (MVCC). Under MVCC, readers do not block writers, and writers do not block readers. Postgres gets this property by keeping several versions of the same row at the same time. Each transaction sees the version that was current when its snapshot was taken.

The cost of this design is garbage. When a newer version exists, the older version is not deleted from disk. It becomes a dead row (the docs say "dead tuple") once no transaction can see it anymore. Chapter 2 covers how vacuum removes dead rows. This chapter covers how they come to exist and why they sometimes cannot be removed.

## Inside a heap page

A table is a set of 8 kB pages (the compile-time default is 8192 bytes). Each page has this layout:

- A 24-byte page header.
- An array of line pointers. Each line pointer is 4 bytes and points at one tuple on the page.
- Free space in the middle.
- The tuples themselves, filled from the end of the page backward.

Each tuple starts with a fixed 23-byte header, followed by an optional null bitmap and the column data. The header fields that matter for this book:

| Field         | Size    | Meaning                                                                     |
| ------------- | ------- | --------------------------------------------------------------------------- |
| `t_xmin`      | 4 bytes | ID of the transaction that inserted this version                            |
| `t_xmax`      | 4 bytes | ID of the transaction that deleted or locked it, 0 if none                  |
| `t_cid`       | 4 bytes | Command number inside the inserting transaction                             |
| `t_ctid`      | 6 bytes | Physical address (page, line pointer) of this or a newer version            |
| `t_infomask2` | 2 bytes | Column count plus flag bits (HOT flags live here)                           |
| `t_infomask`  | 2 bytes | 16 flag bits: null bitmap present, xmin committed, xmax is a lock, and more |
| `t_hoff`      | 1 byte  | Offset where the column data starts                                         |

Two fields carry the MVCC story. `t_xmin` says who created the version. `t_xmax` says who expired it. A transaction ID (XID) is a 32-bit counter. Chapter 5 covers what happens when that counter wraps around.

`t_ctid` points at the newest version of the row. In the newest version, it points at itself. A row's `ctid` is visible in SQL, so you can watch a row move:

```sql
SELECT ctid, xmin, xmax, * FROM account WHERE id = 1;
```

Note one trap: a nonzero `xmax` does not always mean "deleted". `SELECT ... FOR UPDATE` also writes its XID into `t_xmax`, with an infomask flag that marks it as a lock. Row locks therefore dirty pages and create WAL, but they do not create dead rows.

## Snapshots and visibility

A snapshot answers one question: which transactions count as "already committed" for me? A snapshot has three parts:

- `xmin`: the oldest transaction that was still running when the snapshot was taken. Everything older is decided.
- `xmax`: the first transaction ID not yet assigned. Everything at or above it is invisible.
- `xip_list`: the transactions between the two that were in progress. They are invisible even if they commit later.

You can look at your own snapshot (Postgres 13 and later):

```sql
SELECT pg_current_snapshot();
-- 751:754:751,753
```

The visibility rule for one tuple then reads: the tuple is visible when its `t_xmin` committed before my snapshot, and its `t_xmax` is 0, aborted, or not yet committed for my snapshot. Postgres checks commit status in the commit log (clog). The first reader that resolves a tuple's status caches the answer as hint bits in `t_infomask` (for example `HEAP_XMIN_COMMITTED`). This is why a first sequential scan after a bulk load writes pages.

The definition of a dead row follows directly. A row version is dead when its `t_xmax` committed, and every current and future snapshot has that commit in its past. Until then, the version is "recently dead": expired, but still needed by someone.

## UPDATE is INSERT plus DELETE

An UPDATE never overwrites the row. It inserts a new version and expires the old one. A worked example with the `pageinspect` extension makes this concrete:

```sql
CREATE EXTENSION pageinspect;
CREATE TABLE account (id int PRIMARY KEY, balance int);
INSERT INTO account VALUES (1, 100);

SELECT lp, t_xmin, t_xmax, t_ctid
FROM heap_page_items(get_raw_page('account', 0));
--  lp | t_xmin | t_xmax | t_ctid
-- ----+--------+--------+--------
--   1 |    769 |      0 | (0,1)
```

One version, never expired (`t_xmax` = 0), pointing at itself. Now update it:

```sql
UPDATE account SET balance = 90 WHERE id = 1;

SELECT lp, t_xmin, t_xmax, t_ctid
FROM heap_page_items(get_raw_page('account', 0));
--  lp | t_xmin | t_xmax | t_ctid
-- ----+--------+--------+--------
--   1 |    769 |    770 | (0,2)
--   2 |    770 |      0 | (0,2)
```

Transaction 770 expired version (0,1) and inserted version (0,2). The old version's `t_ctid` now points forward to the new one. Both versions occupy space on the page. After 770 commits and falls behind every snapshot, version (0,1) is dead.

A DELETE is the same story without the insert: it sets `t_xmax` and leaves the row in place. A ROLLBACK also creates garbage. An aborted INSERT leaves a tuple whose `t_xmin` never committed, and that tuple is dead on arrival. So dead rows come from three verbs: UPDATE, DELETE, and any aborted write.

The multiplier that surprises people is indexes. A regular (non-HOT) UPDATE inserts a new entry into every index on the table, even indexes on columns the UPDATE did not touch. A table with 10 indexes pays 10 index inserts per updated row, plus the new heap version. Those extra index entries later become index garbage too.

## HOT updates

Heap-only tuple (HOT) updates are the escape hatch from the index multiplier. A HOT update stores the new version on the same page as the old one and skips all index inserts. Two conditions must both hold:

1. The UPDATE changes no indexed column. Since Postgres 16, columns covered only by summarizing indexes (BRIN) do not count.
2. The page that holds the old version has enough free space for the new version.

The index keeps pointing at the original line pointer, the root of a HOT chain. A reader arrives at the root and follows the `t_ctid` links to the visible version. When old chain members die, any backend can prune them during a normal read or write of that page. Pruning frees their space and turns the root line pointer into a 4-byte redirect. No vacuum is needed for this part of the cleanup, which makes HOT the cheapest kind of UPDATE by far.

When either condition fails, you get a regular UPDATE with the full index cost. The two failure modes:

- An indexed column changed. A common own goal is an index on `updated_at` while every write touches `updated_at`. That one index disables HOT for every UPDATE on the table.
- No room on the page. A full page forces the new version onto another page, and a cross-page move always needs new index entries.

Measure your HOT ratio per table:

```sql
SELECT relname, n_tup_upd, n_tup_hot_upd,
       round(100.0 * n_tup_hot_upd / nullif(n_tup_upd, 0), 1) AS hot_pct
FROM pg_stat_user_tables
ORDER BY n_tup_upd DESC;
```

Postgres 16 added `n_tup_newpage_upd`, which counts exactly the updates that failed condition 2. On update-heavy tables, treat a low `hot_pct` as a design smell: either drop the index on the hot column or fix the free-space problem with fillfactor.

## Fillfactor

`fillfactor` sets the percentage of each page that INSERTs may fill. The table default is 100. The B-tree index default is 90. With `fillfactor = 90` on a table, INSERTs stop at 90 percent, and the reserved 10 percent stays free for HOT updates of the rows on that page.

```sql
ALTER TABLE account SET (fillfactor = 90);
```

The setting applies only to pages written after the change. Existing full pages stay full until a rewrite (for example `VACUUM FULL` or `pg_repack`, see chapter 6). The trade is explicit: a fillfactor of 90 makes the table about 11 percent bigger on disk in exchange for a higher HOT ratio. For update-heavy tables with rows much smaller than 8 kB, values between 70 and 90 are the usual range. For append-only tables, keep 100.

## The xmin horizon

A dead row can only be removed when no snapshot can still see the old version. Postgres computes this cutoff as the xmin horizon: the oldest `xmin` any current snapshot holds, across the whole cluster. Everything that died before the horizon is removable. Everything that died after it must wait, no matter how aggressively vacuum runs. Vacuum log output states this directly: "tuples: 0 removed, 5000000 remain, 4900000 are dead but not yet removable".

The horizon is a single scalar per database cluster. One holder pins it for every table in every database. Four things hold it back:

1. Long-running transactions. Any transaction with an open snapshot pins the horizon at its start. This includes idle-in-transaction sessions: a connection that ran `BEGIN`, executed one SELECT, and then sat idle for 6 hours pins 6 hours of garbage. Find them by `backend_xmin` age:

```sql
SELECT pid, datname, state, xact_start,
       age(backend_xmin) AS xmin_age
FROM pg_stat_activity
WHERE backend_xmin IS NOT NULL
ORDER BY age(backend_xmin) DESC;
```

2. Replication slots. A physical slot with `hot_standby_feedback = on` relays the standby's oldest snapshot to the primary, and the slot remembers it even while the standby is down. A logical slot pins `catalog_xmin` for the system catalogs. Slots survive restarts, so a slot for a decommissioned replica pins the horizon forever until someone drops it:

```sql
SELECT slot_name, slot_type, active,
       age(xmin) AS xmin_age,
       age(catalog_xmin) AS catalog_xmin_age
FROM pg_replication_slots;
```

3. Prepared transactions. Two-phase commit parks a transaction in the prepared state, where it survives crashes and restarts. A prepared transaction that nobody commits or rolls back pins the horizon indefinitely. The feature is off by default (`max_prepared_transactions = 0`), but XA-style middleware turns it on:

```sql
SELECT gid, prepared, owner, age(transaction) AS xmin_age
FROM pg_prepared_xacts
ORDER BY age(transaction) DESC;
```

4. Standby feedback without a slot. With `hot_standby_feedback = on` (default off), every connected standby reports its oldest query snapshot through `pg_stat_replication.backend_xmin`. A 4-hour report query on a read replica then pins 4 hours of garbage on the primary. The alternative is `max_standby_streaming_delay`, which cancels standby queries instead of pinning the primary. You choose which side pays.

The failure pattern at large deployments is always the same shape. Dead rows accumulate, `n_dead_tup` in `pg_stat_user_tables` climbs, vacuum runs report "dead but not yet removable", and the table grows even though vacuum runs constantly. The fix is never a vacuum setting. The fix is to find and remove the horizon holder: kill the idle transaction, drop the stale slot, resolve the prepared transaction. Chapter 8 turns the four queries above into standing alerts.

## Sources

- https://www.postgresql.org/docs/current/storage-page-layout.html
- https://www.postgresql.org/docs/current/storage-hot.html
- https://www.postgresql.org/docs/current/mvcc-intro.html
- https://www.postgresql.org/docs/current/routine-vacuuming.html
- https://www.postgresql.org/docs/current/pageinspect.html
- https://www.postgresql.org/docs/current/sql-createtable.html
- https://www.postgresql.org/docs/current/runtime-config-replication.html
- https://www.interdb.jp/pg/pgsql05.html
- https://pganalyze.com/docs/checks/vacuum/xmin_horizon
- https://pganalyze.com/docs/vacuum-advisor/what-is-bloat
- https://pganalyze.com/blog/5mins-postgres-autovacuum-dead-tuples-not-yet-removable-postgres-xmin-horizon
- https://www.cybertec-postgresql.com/en/reasons-why-vacuum-wont-remove-dead-rows/
- https://www.cybertec-postgresql.com/en/hot-updates-in-postgresql-for-better-performance/
- https://www.cybertec-postgresql.com/en/what-is-fillfactor-and-how-does-it-affect-postgresql-performance/
- https://www.citusdata.com/blog/2022/07/28/debugging-postgres-autovacuum-problems-13-tips/
