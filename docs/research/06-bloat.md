# 6. Bloat

tl;dr: Bloat is space in table and index files that holds no live data. VACUUM recycles this space for reuse, but it almost never returns the space to the operating system. Measure bloat with pgstattuple for exact numbers, or with estimation queries for a cheap first pass (expect 10 to 30 percent error). Bloat costs you cache hits, scan time, WAL volume, and disk. To reclaim space online, use REINDEX CONCURRENTLY for indexes and pg_repack, pg_squeeze or pg-osc for tables. Most practitioners investigate above 20 to 30 percent bloat and act above 50 percent.

## What bloat is

Postgres never updates a row in place. An UPDATE writes a new row version and marks the old version as dead. A DELETE only marks the row as dead. The MVCC chapter explains this mechanism in full.

VACUUM removes dead row versions and records the freed space in the free space map. New rows can then reuse that space. The file itself keeps its size.

Bloat is the gap between the file size and the size the data needs. It has two parts:

- Dead tuples that VACUUM did not remove yet.
- Free space inside pages that current traffic does not fill again.

Both table files (the heap) and index files bloat. They bloat at different rates, and you fix them with different tools.

## Why VACUUM does not shrink files

Plain VACUUM works page by page inside the existing file. It cannot move a row to a different page, because every index still points to the old position. So VACUUM can only turn dead space into reusable space. The Postgres docs state this directly: VACUUM "will not return the space to the operating system, except in the special case where one or more pages at the end of a table become entirely free".

That special case is trailing truncation. When the pages at the end of the file are completely empty, VACUUM can cut the file at that point. The source (`src/backend/access/heap/vacuumlazy.c`) sets two thresholds: VACUUM attempts truncation when at least 1,000 trailing pages (8 MB) are free, or at least 1/16 of the table, whichever is less.

Truncation needs a short ACCESS EXCLUSIVE lock. VACUUM takes this lock conditionally. It gives up when it cannot get the lock, and it releases the lock when another session waits for more than about 5 seconds. On a hot standby, the truncation record can still cancel queries. Set the `vacuum_truncate` storage parameter (Postgres 12+) or the `vacuum_truncate` server setting (Postgres 18+) to `off` to skip this phase.

The practical rule: mass-delete patterns that empty the end of the table (for example, a drop of old rows in an append-only table) can shrink the file. Random deletes and updates cannot. A table that is 60 percent free space in the middle stays at full size forever unless you rebuild it.

## How to measure bloat

You have three tools with different cost and accuracy. Use them in this order.

| Method                                      | Cost                    | Accuracy                         | Covers                    |
| ------------------------------------------- | ----------------------- | -------------------------------- | ------------------------- |
| `pg_stat_user_tables.n_dead_tup`            | Free                    | Rough estimate, dead tuples only | Tables                    |
| Estimation queries (check_postgres, ioguix) | One catalog query       | 10 to 30 percent error is normal | Tables and B-tree indexes |
| pgstattuple / pgstatindex                   | Full scan of the object | Exact                            | Tables and indexes        |

**Dead tuple counts.** `pg_stat_user_tables` tracks `n_dead_tup` per table. It is free to read and good for trend alerts. It has two blind spots. The number is an estimate from the statistics system, not a count. And it shows only dead tuples, not free space. A table can be 50 percent bloat with `n_dead_tup = 0`, because VACUUM already converted the dead tuples to free space.

```sql
SELECT relname, n_live_tup, n_dead_tup,
       round(n_dead_tup * 100.0 / nullif(n_live_tup + n_dead_tup, 0), 1) AS dead_pct
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC LIMIT 10;
```

**Estimation queries.** The check_postgres query and its maintained successor (the ioguix/pgsql-bloat-estimation queries) estimate bloat from `pg_class` and `pg_stats`. They compute the expected size from the average row width and the row count, then compare it to the real size. They read no table data, so they are safe to run every few minutes.

Know their error sources before you alert on them:

- They ignore TOAST. Compressed or out-of-line values make the estimate wrong, sometimes negative.
- They count alignment padding as bloat. That alone can be 10 percent or more of the table.
- They depend on fresh ANALYZE statistics. Stale statistics give stale answers.
- Small tables show high percentages by construction. A 5-page table with one free page reads as 20 percent bloat.

In Cybertec's comparison test, the SQL estimate deviated about 3 percent from the exact pgstattuple numbers on plain tables. On tables with wide TOASTed columns (JSONB, long text), practitioners report 10 to 30 percent deviation. Treat the output as a screening signal, not as a measurement.

**pgstattuple.** The `pgstattuple` extension reads every page and returns exact numbers. On a 200 GB table this costs minutes of I/O and holds an ACCESS SHARE lock, so schedule it. `pgstattuple_approx()` uses the visibility map to skip all-visible pages and reported about 0.5 percent deviation in the same Cybertec test. For indexes, `pgstatindex()` returns `avg_leaf_density`, the percentage of leaf space in use.

### Worked example

Build a 10 million row table with pgbench (scale 100), delete half of it, and vacuum. Numbers below are rounded and come from Postgres 18 defaults.

```sql
-- pgbench -i -s 100  →  pgbench_accounts: 10,000,000 rows, ~1281 MB
DELETE FROM pgbench_accounts WHERE aid % 2 = 0;   -- 5,000,000 rows dead
VACUUM pgbench_accounts;

SELECT * FROM pgstattuple('pgbench_accounts');
-- table_len          | ~1.34 GB   (unchanged: no trailing empty pages)
-- tuple_count        | 5,000,000
-- tuple_percent      | ~45
-- dead_tuple_count   | 0          (VACUUM removed them)
-- free_percent       | ~48
```

The file did not shrink by a single byte. VACUUM turned 5 million dead tuples into free space on every second slot of every page. `n_dead_tup` is back to 0, so the cheap counter reports a healthy table. Only pgstattuple (or an estimation query) shows that half the file is empty. New inserts will refill this space, so this state is only a problem when the table will not grow back.

## The real costs of bloat

Bloat is not only wasted disk. It taxes every read path.

- **Cache efficiency.** shared_buffers and the OS page cache store pages, not rows. A table at 50 percent bloat needs 2x the cache for the same working set. The evicted pages come from your other tables.
- **Sequential scan time.** A seq scan reads every page, dead or empty. At 50 percent bloat, every seq scan, every ANALYZE sample, and every VACUUM pass does 2x the I/O for the same rows.
- **Index scans.** A bloated index has more leaf pages for the same keys. Range scans touch more pages. In severe cases the tree grows an extra level, which adds one page read to every descent.
- **WAL volume.** Writes spread over more distinct pages produce more full-page images after each checkpoint. More WAL means more replication traffic, longer recovery, and larger backups.
- **VACUUM itself.** VACUUM must scan the bloat it cannot remove. Bloat makes vacuum runs longer, which delays cleanup, which creates more bloat. This feedback loop is how tables reach 90 percent bloat.
- **Disk.** The obvious cost, and on cloud storage a direct invoice line.

## B-tree index bloat

Indexes bloat faster than tables and recover worse. Three properties of the Postgres B-tree cause this.

**Page splits are permanent.** When an index page is full, Postgres splits it into two half-full pages. Pages never merge again. VACUUM can delete a page only when it becomes completely empty. Scattered deletes leave thousands of quarter-full pages that never empty and never merge. A table gets its space reused in place. An index keeps its split structure.

**Every update writes index entries.** Each row version needs an index entry in every index, unless the update qualifies as HOT (heap-only tuple, covered in the MVCC chapter). An index on an updated column collects one dead entry per update until cleanup runs.

Two features reduce this. State the version when you reason about a cluster:

- **Deduplication (Postgres 13+).** When a leaf page would split, Postgres first merges duplicate keys into one posting list tuple: the key once, plus a sorted array of row pointers. This absorbs both real duplicates and version churn, and it defers many splits. It is on by default (`deduplicate_items`). It cannot apply to numeric, jsonb, float4/float8, container types, text under nondeterministic collations, or INCLUDE indexes.
- **Bottom-up deletion (Postgres 14+).** Right before a page split, Postgres visits the heap to check whether entries on the page point to dead row versions, and removes them. This targets version churn from updates that do not change the indexed column. In the Postgres docs' words, some indexes never grow by a single page despite constant churn.

Both features help at the moment a split would happen. Neither one repairs an index that already split. For that, only a rebuild helps.

## Recovery options

VACUUM prevents bloat. It does not remove existing bloat, except by trailing truncation. These are the rebuild tools:

| Tool                 | Scope                   | Lock                                     | Extra disk      | Main risk                                                        |
| -------------------- | ----------------------- | ---------------------------------------- | --------------- | ---------------------------------------------------------------- |
| VACUUM FULL          | Table + its indexes     | ACCESS EXCLUSIVE, full duration          | ~1x table copy  | Blocks all reads and writes until done                           |
| REINDEX CONCURRENTLY | Indexes only            | Brief locks at phase changes             | ~1x index copy  | Invalid `_ccnew` index on failure                                |
| pg_repack            | Table + indexes, online | Brief ACCESS EXCLUSIVE at start and swap | ~1x table + WAL | Leftover artifacts on kill, DDL blocked during run               |
| pg_squeeze           | Table + indexes, online | Brief lock at swap only                  | ~1x table + WAL | Needs `wal_level = logical` and a restart to install             |
| pg-osc               | Table + indexes, online | Brief ACCESS EXCLUSIVE at swap           | ~1x table + WAL | Runs outside the server, an interrupted run needs manual cleanup |

**VACUUM FULL** rewrites the table into a new file and rebuilds all indexes. It removes all bloat. It holds an ACCESS EXCLUSIVE lock for the whole rewrite, which blocks reads and writes. On a 500 GB table that is hours of downtime. Use it only in a maintenance window, or on small tables. It also needs free disk for the full new copy.

**REINDEX CONCURRENTLY** (Postgres 12+) rebuilds an index next to the old one, then swaps them. Reads and writes continue. It does roughly twice the work of a plain REINDEX and waits briefly for lock handoffs at phase boundaries. When it fails or is cancelled, it leaves an invalid index with the `_ccnew` suffix. That index serves no reads but still costs every write. Monitor for invalid indexes and drop them:

```sql
SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
```

Index bloat dominates in most deployments, so REINDEX CONCURRENTLY is the tool you will use most.

**pg_repack** rebuilds a table online. It copies rows into a new table, captures concurrent writes with triggers into a log table, replays them, and swaps the files under a brief ACCESS EXCLUSIVE lock. It needs a primary key or a unique index. Risks: it blocks DDL on the table for the whole run, a killed run leaves triggers and a `repack` schema to clean up, and the copy plus the swap produce a full extra table of disk and a large WAL burst.

**pg_squeeze** does the same job with logical decoding instead of triggers. A background worker inside Postgres copies the table, streams concurrent changes from a replication slot, and swaps with a short configurable lock. It can run on a schedule against registered tables. It needs `wal_level = logical`, a free replication slot, a replica identity (normally the primary key), and a restart to add it to `shared_preload_libraries`. It copies rows as stored, so it does not reclaim space from dropped columns.

**pg-osc** (pg-online-schema-change) is a client-side CLI, not an extension. It builds a shadow table, copies the rows, captures concurrent writes with triggers, and swaps the tables with a rename under a brief ACCESS EXCLUSIVE lock. Its purpose is the online schema change, and the removal of bloat is a side effect of the copy. It needs a primary key. It is the only option left when the provider installs no extensions at all. Because it runs outside the server, an interrupted run leaves the shadow table and its triggers for you to drop.

For all online tools, plan disk before you need them. You need free space for the full new table. A cluster at 95 percent disk from bloat can no longer run the tool that would fix it.

## Acceptable bloat in practice

Zero bloat is the wrong target. A table with steady UPDATE and DELETE traffic needs free space as headroom. Rows reuse that space, which is cheaper than extending the file. Crunchy Data notes that removing this steady-state bloat can reduce performance until the table re-bloats to its equilibrium. The Postgres docs describe the goal as "steady-state usage of disk space", not minimum size.

Practitioner thresholds cluster in a narrow band:

- Postgres.AI: below 40 percent is not a problem.
- Crunchy Bridge: below 50 percent is acceptable, above 50 percent can severely impact performance and disk.
- Postgres Monitor and AWS guidance: investigate above 20 to 30 percent.
- For indexes, AWS recommends action when `avg_leaf_density` from pgstatindex drops toward 50 percent (fresh B-tree leaves start near the fillfactor default of 90).

A workable policy for a large fleet: ignore objects under 1 GB, alert on estimated bloat above 30 percent, confirm with pgstattuple_approx, and rebuild above 50 percent or when the absolute waste exceeds tens of gigabytes. Watch the trend more than the level. Rising bloat means VACUUM does not keep up, and that is an autovacuum tuning problem (see the autovacuum chapter), not a rebuild problem.

## Sources

- https://www.postgresql.org/docs/current/routine-vacuuming.html
- https://www.postgresql.org/docs/current/sql-vacuum.html
- https://www.postgresql.org/docs/current/sql-reindex.html
- https://www.postgresql.org/docs/15/btree-implementation.html
- https://github.com/postgres/postgres/blob/master/src/backend/access/heap/vacuumlazy.c
- https://pgpedia.info/v/vacuum_truncate.html
- https://www.postgresql.org/docs/current/pgstattuple.html
- https://github.com/ioguix/pgsql-bloat-estimation
- https://www.cybertec-postgresql.com/en/estimating-table-bloat/
- https://www.crunchydata.com/blog/checking-for-postgresql-bloat
- https://pganalyze.com/docs/vacuum-advisor/what-is-bloat
- https://www.cybertec-postgresql.com/en/b-tree-index-deduplication/
- https://www.cybertec-postgresql.com/en/index-bloat-reduced-in-postgresql-v14/
- https://www.percona.com/blog/postgresql-14-b-tree-index-reduced-bloat-with-bottom-up-deletion/
- https://pganalyze.com/blog/5mins-postgres-hot-updates-vs-bottom-up-index-deletion
- https://boringsql.com/posts/the-bloat-busters-pg-repack-pg-squeeze/
- https://www.cybertec-postgresql.com/en/products/pg_squeeze/
- https://github.com/reorg/pg_repack
- https://github.com/shayonj/pg-online-schema-change
- https://kendralittle.com/2025/12/01/index-bloat-postgres-why-it-matters-how-to-identify-and-resolve/
- https://postgres.ai/docs/postgres-howtos/database-administration/maintenance/how-to-deal-with-bloat
- https://docs.crunchybridge.com/insights-metrics/bloat-and-vacuum
- https://postgresmonitor.com/docs/bloat-recommendation/
