# 2. What vacuum actually does

tl;dr: A vacuum pass walks the table in three phases. It scans the heap and collects the addresses of dead rows. It removes those addresses from every index. Then it returns to the heap and frees the row slots. The pass also updates two small side files, the visibility map and the free space map. Before Postgres 17, a memory limit could force vacuum to repeat the index phase many times. Postgres 17 replaced the memory structure and removed that problem for most tables.

## Why dead rows exist

Postgres never updates a row in place. An `UPDATE` writes a new row version and marks the old version as dead. A `DELETE` only marks the row as dead. Dead row versions stay on disk until vacuum removes them. Chapter 1 covers this MVCC design. Chapter 3 covers when autovacuum decides to run. This chapter covers what one vacuum pass does once it runs.

Two terms recur below:

- A "heap" is the main table file. It is a sequence of 8 kB pages.
- A "TID" (tuple identifier) is the address of one row version: a 4-byte page number plus a 2-byte slot number, 6 bytes total.

## The phases of one vacuum pass

The view `pg_stat_progress_vacuum` reports each phase of a running vacuum. The phases run in this order:

| Phase                      | What it does                                                   |
| -------------------------- | -------------------------------------------------------------- |
| `initializing`             | Prepares the scan. This takes milliseconds.                    |
| `scanning heap`            | Reads table pages, prunes dead rows, collects dead TIDs.       |
| `vacuuming indexes`        | Removes the collected TIDs from every index.                   |
| `vacuuming heap`           | Frees the dead row slots in the table pages.                   |
| `cleaning up indexes`      | Runs one cleanup callback per index, updates index statistics. |
| `truncating heap`          | Returns empty pages at the end of the table to the OS.         |
| `performing final cleanup` | Vacuums the free space map and updates `pg_class` statistics.  |

The middle three phases can loop. When the dead-TID store fills up, vacuum stops the scan, runs the index and heap phases, empties the store, and resumes the scan. The section on the dead-TID store below explains when this happens.

```sql
SELECT pid, phase, heap_blks_total, heap_blks_scanned, index_vacuum_count
FROM pg_stat_progress_vacuum;
```

### Phase 1: scan the heap

Vacuum reads the table page by page. On each page it prunes: it removes dead row versions and compacts the page. Each removed row leaves behind its 4-byte line pointer, the slot in the page header that indexes point at. Vacuum marks the pointer `LP_DEAD` and records the TID in the dead-TID store.

Vacuum cannot free the `LP_DEAD` pointer yet. Index entries still point at it. If vacuum reused the slot now, an index scan would land on the wrong row. The pointer must wait until phase 2 has removed the index entries.

The scan phase also does the freeze work on old rows. Chapter 5 covers freezing.

### Phase 2: vacuum the indexes

Vacuum now scans every index of the table and deletes each entry whose TID is in the dead-TID store. This is a bulk scan. Postgres reads the whole index, not only the dead entries. The cost of this phase depends on the total index size, not on the number of dead rows.

This makes index count and index size the main cost drivers of vacuum. A table with 8 indexes pays for 8 full index scans per index-vacuum cycle.

### Phase 3: vacuum the heap

Vacuum returns to each heap page that holds `LP_DEAD` pointers. No index points at them now, so vacuum sets them to `LP_UNUSED`. The slots and their space become free for new rows. Vacuum records the free space of each page in the free space map.

Note what this phase does not do. It does not shrink the table file. It does not move rows. The space stays inside the table, available for reuse by future inserts and updates. Chapter 8 covers what to do when the file itself must shrink.

### Truncation

If the table ends with a run of empty pages, vacuum tries to cut them off and return the space to the OS. The attempt has two conditions, from `vacuumlazy.c`: the empty tail must span at least 1,000 pages (8 MB), and at least 1/16 of the table. Truncation needs a short `ACCESS EXCLUSIVE` lock. Vacuum takes the lock only if it is free, and it releases the lock when another session starts to wait. On a hot table this lock can still cause a visible blip. Set the `TRUNCATE` option or the `vacuum_truncate` setting to `off` to skip this phase.

## The dead-TID store

Between phase 1 and phase 2, vacuum must remember every dead TID it found. The memory limit for this store is `maintenance_work_mem` (or `autovacuum_work_mem` when set, for autovacuum workers).

### Before Postgres 17: a flat array

Through Postgres 16, the store was a flat array of 6-byte TIDs. Two limits applied:

- The array could not exceed 1 GB, no matter how high you set `maintenance_work_mem`. That caps one cycle at about 178 million dead TIDs.
- With the default `maintenance_work_mem` of 64 MB, one cycle holds about 11 million TIDs.

When the array filled, vacuum ran phases 2 and 3 early, cleared the array, and resumed the scan. Each extra cycle repeats the full scan of every index.

Worked example: a table accumulates 100 million dead rows. `maintenance_work_mem` is at the 64 MB default and the table has 5 indexes. The store holds 11 million TIDs, so vacuum needs 10 index-vacuum cycles. That is 50 full index scans instead of 5. The fix on these versions is direct: raise `maintenance_work_mem` so one cycle covers all dead TIDs (here, about 600 MB).

### Postgres 17: the radix-tree TID store

Postgres 17 replaced the array with a TID store built on an adaptive radix tree. The tree keys on the page number and stores the slot numbers as compact bitmaps. Two things changed:

- The 1 GB cap is gone.
- The same dead TIDs need far less memory, because dead rows cluster on pages.

A pganalyze benchmark on a 100 million row table with 64 MB of `maintenance_work_mem` shows the effect. Postgres 16 ran 9 index-vacuum cycles in 773 seconds. Postgres 17 ran 1 cycle in 619 seconds and used 37 MB at peak. On Postgres 17 and later, multiple index passes are rare, and `maintenance_work_mem` is rarely the bottleneck.

### How to detect multiple passes

Watch `index_vacuum_count` in `pg_stat_progress_vacuum` during a run. A value above 1 means the store filled up. On Postgres 17 and later, the columns `max_dead_tuple_bytes` and `dead_tuple_bytes` show the store budget and its fill level (older versions report tuple counts instead). The `VACUUM (VERBOSE)` output and the autovacuum log line report "index scans: N" after the fact.

## The visibility map

Each table has a visibility map, a side file with the suffix `_vm`. It stores 2 bits per heap page:

- all-visible: every row on the page is visible to every transaction.
- all-frozen: every row on the page is frozen.

Vacuum sets these bits in phase 1 when a page qualifies. Any later `UPDATE`, `DELETE`, or `INSERT` on the page clears them. The map is small: 2 bits per 8 kB page means a 1 TB table has a visibility map of about 32 MB. It stays cached in practice.

The map serves two consumers. Vacuum itself uses it to skip clean pages (next section). Index-only scans use it to skip heap reads.

## The index-only scan connection

A normal index scan must visit the heap for every match, because only the heap row carries visibility information. An index-only scan checks the visibility map instead. If the row's page is all-visible, the scan answers from the index alone and skips the heap read.

This is why vacuum affects read performance, not only space. On a table that vacuum has not visited recently, few pages are all-visible, and "index-only" scans still hit the heap for most rows. `EXPLAIN (ANALYZE)` shows this as a high "Heap Fetches" count. A vacuum pass resets that count toward zero.

```sql
-- Fraction of pages that are all-visible, per table:
SELECT relname, relallvisible::float / GREATEST(relpages, 1) AS visible_frac
FROM pg_class WHERE relkind = 'r' ORDER BY relpages DESC LIMIT 10;
```

## The free space map

Each table also has a free space map (FSM), a side file with the suffix `_fsm`. It records the free space of every page in one byte, at a granularity of 1/256 of the page size (32 bytes on an 8 kB page). The bytes form a small tree, so an insert finds a page with enough space in a few reads. Vacuum updates the FSM in phase 3 and vacuums the FSM structure itself in the final phase.

The FSM is the mechanism behind "space is reused, not returned". After vacuum, inserts find the freed space through the FSM and fill it. The `pg_freespacemap` extension shows the recorded values per page.

## Skip-pages optimizations

Vacuum avoids work at two levels.

Page level: vacuum skips heap pages that the visibility map marks all-visible, because they hold no dead rows. It only skips runs of at least 32 consecutive pages (`SKIP_PAGES_THRESHOLD` in `vacuumlazy.c`), to keep the OS read-ahead effective. All-frozen pages are skipped even by an aggressive vacuum. On an append-mostly table, this makes vacuum cost proportional to the changed part, not the table size. The `DISABLE_PAGE_SKIPPING` option forces a full scan and exists for recovery from visibility-map corruption.

Index level: since Postgres 14, vacuum skips phases 2 and 3 entirely when fewer than 2% of the table pages hold dead TIDs (`BYPASS_THRESHOLD_PAGES`). The few `LP_DEAD` pointers stay in place and wait for a later pass. The `INDEX_CLEANUP` option controls this: `AUTO` (default) applies the 2% rule, `ON` always vacuums indexes, `OFF` never does. `OFF` exists for wraparound emergencies, because skipped index vacuum accumulates as index bloat.

## Parallel index vacuum

Since Postgres 13, a manual `VACUUM` can process indexes in parallel. Rules:

- Only phases 2 and 5 (index vacuum and index cleanup) run in parallel. The heap phases stay single-threaded.
- One worker per index, so the useful worker count is the index count minus one (the leader also processes indexes).
- Only indexes larger than `min_parallel_index_scan_size` (default 512 kB) participate.
- `max_parallel_maintenance_workers` (default 2) caps the workers.

```sql
VACUUM (PARALLEL 4, VERBOSE) orders;
```

Autovacuum never uses parallel workers, on all versions through Postgres 18. This is a real operational gap: a manual vacuum on a table with 8 indexes can run the index phase about 8 times faster than the autovacuum on the same table.

## What ANALYZE does

`ANALYZE` is a separate job that often rides along with vacuum. It does not touch dead rows. It samples the table and writes planner statistics to `pg_statistic` (readable through the `pg_stats` view): the fraction of NULLs, the distinct-value estimate, the most common values, a value histogram, and the physical-order correlation per column.

The sample size is 300 times `default_statistics_target`. At the default target of 100, that is 30,000 rows, taken from randomly chosen pages. The sample size does not grow with the table, so `ANALYZE` stays cheap even on a 1 TB table. `ANALYZE` also refreshes `reltuples` and `relpages` in `pg_class`, which autovacuum uses for its thresholds.

`VACUUM (ANALYZE)` runs both jobs in one pass. Autovacuum schedules the two jobs on separate counters, which chapter 3 covers.

## VACUUM vs VACUUM FULL

The two commands share a name and little else.

|                    | `VACUUM`                                            | `VACUUM FULL`                                |
| ------------------ | --------------------------------------------------- | -------------------------------------------- |
| Method             | Cleans pages in place                               | Rewrites the table into a new file           |
| Table file size    | Shrinks only by tail truncation                     | Shrinks to the minimum                       |
| Lock               | `SHARE UPDATE EXCLUSIVE`, reads and writes continue | `ACCESS EXCLUSIVE`, blocks everything        |
| Extra disk         | None                                                | Up to the full table size during the rewrite |
| Indexes            | Entries removed                                     | Rebuilt from scratch                         |
| Autovacuum runs it | Yes                                                 | Never                                        |

`VACUUM FULL` copies every live row into a new file, rebuilds every index, and drops the old file at the end. The table is unreadable and unwritable for the whole rewrite. Treat it as an offline operation of last resort. Chapter 8 covers the online alternatives (for example `pg_repack`) for a table that is already bloated.

## Sources

- https://www.postgresql.org/docs/current/routine-vacuuming.html
- https://www.postgresql.org/docs/current/progress-reporting.html
- https://www.postgresql.org/docs/current/sql-vacuum.html
- https://www.postgresql.org/docs/current/storage-fsm.html
- https://www.postgresql.org/docs/current/storage-vm.html
- https://github.com/postgres/postgres/blob/master/src/backend/access/heap/vacuumlazy.c
- https://github.com/postgres/postgres/blob/master/src/backend/commands/analyze.c
- https://pganalyze.com/blog/5mins-postgres-17-faster-vacuum-adaptive-radix-trees
- https://pganalyze.com/blog/5mins-postgres-parallel-vacuum-sql-json-postgres-16
- http://rhaas.blogspot.com/2019/01/how-much-maintenanceworkmem-do-i-need.html
- https://www.cybertec-postgresql.com/en/when-the-dead-wont-die/
- https://blog.summercat.com/postgres-vacuum-taking-an-access-exclusive-lock.html
- https://www.mail-archive.com/pgsql-docs@lists.postgresql.org/msg05740.html
