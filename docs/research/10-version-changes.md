# 10. Vacuum across versions

tl;dr: Vacuum in Postgres 18 is a different machine than vacuum in Postgres 11. Postgres 12 made autovacuum 10x faster by default. Postgres 13 added parallel index vacuum and insert-triggered autovacuum. Postgres 14 added the wraparound failsafe and cut I/O cost penalties. Postgres 16 and 18 spread the freeze work out. Postgres 17 removed the 1 GB dead-TID memory cap and the multi-pass problem. Much tuning advice written for Postgres 11 or older is now wrong. This chapter lists what changed, version by version, and what each change means in practice.

Each item below is verified against the official release notes. The section for each version lists the changes in rough order of practical impact.

## Quick reference

| Version | Year | Headline vacuum changes | Key new settings |
|---|---|---|---|
| 12 | 2019 | Cost delay default 20ms to 2ms, `REINDEX CONCURRENTLY` | `vacuum_truncate` (table option), `INDEX_CLEANUP`, `SKIP_LOCKED` |
| 13 | 2020 | Parallel index vacuum, insert-triggered autovacuum, B-tree deduplication | `autovacuum_vacuum_insert_threshold`, `autovacuum_vacuum_insert_scale_factor` |
| 14 | 2021 | Wraparound failsafe, `vacuum_cost_page_miss` 10 to 2, bottom-up index deletion | `vacuum_failsafe_age`, `vacuum_multixact_failsafe_age` |
| 15 | 2022 | Accurate `relfrozenxid` advancement, autovacuum logging on by default | `log_autovacuum_min_duration` = 10min default |
| 16 | 2023 | Page-level freezing, configurable ring buffer, live cost-setting reload | `vacuum_buffer_usage_limit`, `BUFFER_USAGE_LIMIT` |
| 17 | 2024 | Radix-tree TID store, no 1 GB cap, one index pass, compact WAL | (none, removes a limit) |
| 18 | 2025 | Eager freezing, async I/O, runtime worker count, dead-tuple trigger cap | `vacuum_max_eager_freeze_failure_rate`, `autovacuum_vacuum_max_threshold`, `autovacuum_worker_slots`, `io_method` |

The table gives the shape. The sections give the numbers and the operational meaning.

Two reading notes. First, vacuum behavior changes only ship in major releases. Minor releases (for example 16.4) fix bugs and do not change defaults or add settings. Second, a new default applies only to fresh configs. An upgraded cluster keeps every value that its old `postgresql.conf` sets explicitly, even when the built-in default moved.

## Postgres 12 (October 2019)

**`autovacuum_vacuum_cost_delay` default: 20ms down to 2ms.** This is the single most important vacuum change of the decade. The default throttle budget went from about 8 MB/s of reads to about 80 MB/s (see chapter 4 for the math). Before Postgres 12, almost every sizable deployment had to lower this setting by hand. After Postgres 12, the default is workable for many mid-size systems. The setting also accepts fractional milliseconds now, so `0.5ms` is valid.

**`REINDEX CONCURRENTLY`.** Postgres can now rebuild an index without blocking writes to the table. Before this, the workaround was `CREATE INDEX CONCURRENTLY` plus a rename, or the pg_repack tool. This is the standard fix for index bloat from Postgres 12 on. The `reindexdb --concurrently` option scripts it.

**`VACUUM (INDEX_CLEANUP false)` and the `vacuum_index_cleanup` storage option.** Vacuum can now skip the index vacuum phase. This makes an emergency wraparound vacuum much faster, because the freeze work does not need the indexes. The cost is that dead index entries stay behind.

**`vacuum_truncate` storage option.** Vacuum truncates empty pages at the end of a table, and that truncation takes a short `ACCESS EXCLUSIVE` lock. On hot-standby setups this lock can cancel queries on replicas. The new table option turns the truncation off per table.

**`VACUUM (SKIP_LOCKED)`.** Manual vacuum can skip tables that it cannot lock at once, instead of waiting.

**Smaller items.** GiST index vacuum got faster and now deletes empty leaf pages. `vacuumdb` gained `--min-xid-age` for wraparound triage. `CLUSTER` and `VACUUM FULL` report progress in `pg_stat_progress_cluster`.

Practical impact: if you carry a Postgres 11-era config forward, delete the old `autovacuum_vacuum_cost_delay = 20ms` line. Keeping it now throttles vacuum 10x below the modern default.

## Postgres 13 (September 2020)

**Parallel index vacuum.** `VACUUM (PARALLEL n)` processes a table's indexes in parallel, one worker per index. This helps tables with many indexes the most. Two limits apply. Autovacuum does not use it (this is still true in Postgres 18). And indexes smaller than `min_parallel_index_scan_size` (default 512 kB) do not qualify. Manual vacuum uses it by default, sized by `max_parallel_maintenance_workers`.

**Insert-triggered autovacuum.** Inserts now trigger autovacuum, not only updates and deletes. The trigger is `autovacuum_vacuum_insert_threshold` (default 1000) plus `autovacuum_vacuum_insert_scale_factor` (default 0.2) times the table size. Before Postgres 13, an append-only table got no vacuum until the anti-wraparound threshold hit, and then got one giant freeze-everything vacuum. Now the freeze work spreads out, and the visibility map stays current, which helps index-only scans.

**B-tree deduplication.** B-tree indexes store duplicate keys once, with a list of row pointers. Indexes on low-cardinality columns shrink a lot, often 2-3x. Smaller indexes mean less index vacuum work per pass. Indexes carried over by `pg_upgrade` need a `REINDEX` to gain the new format.

Practical impact: the append-only-table wraparound surprise (chapter 7) is mostly a pre-13 problem. On Postgres 13 or later, an insert-only table gets regular small vacuums instead of one rare giant one.

## Postgres 14 (September 2021)

**The wraparound failsafe.** When a table's oldest transaction ID passes `vacuum_failsafe_age` (default 1.6 billion), vacuum drops all restraint. It stops the cost-based delay, skips index vacuuming and truncation, and races to freeze the table. This is the last automatic defense before the wraparound shutdown (chapter 5). `vacuum_multixact_failsafe_age` does the same for multixacts.

**`vacuum_cost_page_miss` default: 10 down to 2.** The cost model now charges a page read only 2x a cache hit, not 10x. This reflects SSD hardware. With the same delay settings, vacuum on a cold table runs several times faster than on Postgres 13.

**Index vacuum bypass.** `INDEX_CLEANUP` gained a new default, `auto`. Vacuum now skips the index phase entirely when the number of dead index entries is insignificant (the threshold is under 2 percent of heap pages with dead items). Small vacuums on large tables got much cheaper.

**Bottom-up index deletion.** When a B-tree page is about to split because of duplicate entries from updates, Postgres first tries to delete dead entries on that page directly. This prevents many page splits and much index bloat on update-heavy tables, without waiting for vacuum. This is why index bloat on Postgres 14+ grows much slower than folklore predicts.

**`CONCURRENTLY` no longer holds back vacuum elsewhere.** `CREATE INDEX CONCURRENTLY` and `REINDEX CONCURRENTLY` no longer hold the xmin horizon for other tables. Before Postgres 14, one long index build froze dead-row cleanup for the whole database. They also no longer wait for each other.

**Smaller items.** Vacuum reclaims unused trailing line pointers in heap pages. Deleted B-tree pages reach the free space map faster. `VACUUM (PROCESS_TOAST false)` skips the TOAST table. Autovacuum log output gained per-index detail.

Practical impact: Postgres 14 is the version where "vacuum will kill your database at wraparound" stopped being true in the common case. The failsafe catches the tables the scheduler missed.

## Postgres 15 (October 2022)

Postgres 15 is a quiet release for vacuum. Three items matter.

**Accurate `relfrozenxid` advancement.** Vacuum now sets `relfrozenxid` to the oldest transaction ID that actually remains in the table, not to the conservative cutoff it froze up to. On tables where most rows are already frozen, `relfrozenxid` advances further per vacuum. Anti-wraparound vacuums trigger less often as a result.

**Autovacuum logging on by default.** `log_autovacuum_min_duration` now defaults to 10 minutes (it was -1, meaning off). Every stock Postgres 15+ install logs slow autovacuum runs. Chapter 8 builds on these log lines.

**Richer `VACUUM VERBOSE` output.** The verbose output and the autovacuum log line gained detail, including frozen-page counts and I/O timings.

Practical impact: none of these need tuning. But "turn on autovacuum logging" moved from advice to default.

## Postgres 16 (September 2023)

**Page-level opportunistic freezing.** Normal vacuums now freeze all tuples on a page when the page is about to be marked all-visible and the freeze adds little extra cost (for example, when a full-page WAL image is written anyway). Release notes: "This makes full-table freeze vacuums less necessary." The freeze debt that used to pile up for one big aggressive vacuum now shrinks continuously.

**Configurable ring buffer: `vacuum_buffer_usage_limit`.** Vacuum reads the table through a small ring of shared buffers so it does not evict the working set. That ring was hardcoded at 256 kB. Postgres 16 makes it a setting, default 256 kB, settable up to 16 GB, plus a per-command `BUFFER_USAGE_LIMIT` option and a `vacuumdb --buffer-usage-limit` flag. A larger ring makes one big vacuum faster at the cost of cache pressure. Setting it to 0 lets vacuum use shared buffers freely.

**Live cost-setting reload.** Autovacuum workers now re-read cost-delay settings at each block, not at each table. You can now speed up a running anti-wraparound vacuum by changing `autovacuum_vacuum_cost_delay` and reloading. Before Postgres 16, the running worker ignored the change until its next table.

**Smaller items.** `VACUUM (PROCESS_MAIN false)` vacuums only the TOAST table. `SKIP_DATABASE_STATS` and `ONLY_DATABASE_STATS` split off the `datfrozenxid` update, which speeds up `vacuumdb` over many tables.

Practical impact: the live reload changes incident response. "The wraparound vacuum runs too slow" now has a fix that does not restart the vacuum.

## Postgres 17 (September 2024)

**The radix-tree dead-TID store.** Vacuum used to collect dead row pointers in a flat array. That array was capped at 1 GB no matter how high `maintenance_work_mem` was set, which held about 179 million dead tuples. When the array filled, vacuum stopped, scanned every index, and resumed, in as many rounds as needed. Postgres 17 replaces the array with an adaptive radix tree (the `TidStore`). Three consequences follow:

- The 1 GB cap is gone. `maintenance_work_mem` and `autovacuum_work_mem` values above 1 GB now work.
- The same memory holds far more dead TIDs, often 10-20x more, because the tree stores page numbers once.
- Multiple index-vacuum passes became rare. One pass per vacuum is the normal case now.

**More compact vacuum WAL.** Vacuum's pruning and freezing now write combined WAL records. Release notes: vacuum removes and freezes tuples more efficiently, and "WAL traffic caused by vacuum is also more compact." Less WAL means less replication and archive load from big vacuums.

**Ring buffer default raised.** `vacuum_buffer_usage_limit` default went from 256 kB to 2 MB.

**Smaller items.** Vacuum of tables with no indexes got cheaper. `pg_stat_progress_vacuum` gained `indexes_total` and `indexes_processed`, and renamed `max_dead_tuples` to `max_dead_tuple_bytes` (a monitoring-query breaking change). The new `MAINTAIN` privilege and `pg_maintain` role let non-owners run `VACUUM` and `ANALYZE`.

Practical impact: the classic advice "raise `maintenance_work_mem`, but 1 GB is the vacuum ceiling" is obsolete. So is most worry about multi-pass index vacuuming. Postgres 17 also laid streaming-I/O groundwork that vacuum exploits fully in Postgres 18.

## Postgres 18 (September 2025)

**Eager freezing.** Normal vacuums now freeze some all-visible pages ahead of need. The setting `vacuum_max_eager_freeze_failure_rate` (default 0.03) caps how many failed freeze attempts vacuum tolerates per region before it stops trying eagerly. Before Postgres 18, normal vacuum skipped all-visible pages completely, so freeze debt accumulated until an aggressive vacuum paid it all at once. Together with the Postgres 16 page-freeze change, the giant periodic freeze spike mostly disappears.

**Insert threshold counts unfrozen pages.** `autovacuum_vacuum_insert_scale_factor` now applies to the unfrozen portion of the table, not the total size. On a large append-only table, old frozen data no longer inflates the trigger threshold, so insert-triggered vacuums keep coming at a steady rate.

**`autovacuum_vacuum_max_threshold`.** A new cap (default 100 million dead tuples) on the dead-tuple trigger. On very large tables, the scale-factor formula produced absurd trigger points (0.2 times 5 billion rows is 1 billion dead tuples). The cap bounds this without per-table `autovacuum_vacuum_scale_factor` overrides. The default cap is high, so most teams still want per-table settings on their biggest tables (chapter 3).

**`autovacuum_worker_slots`.** The server now reserves worker slots (default 16) at startup, and `autovacuum_max_workers` (still default 3) can change at runtime up to that slot count, with only a reload. Before Postgres 18, adding workers during an incident required a restart.

**Asynchronous I/O.** The new AIO subsystem (`io_method`, default `worker`) lets vacuum queue multiple read requests instead of reading one page at a time. `maintenance_io_concurrency` and `effective_io_concurrency` defaults rose to 16. Cold-cache vacuums, where the table is not in memory, get large speedups, commonly 2-3x on network storage.

**Smaller items.** `vacuum_truncate` is now also a server-wide setting, not only a per-table option. `VACUUM` and `ANALYZE` on a parent table now process inheritance children too, and the new `ONLY` keyword restores the old behavior (a breaking change for scripts). With `track_cost_delay_timing` on, the time vacuum spent sleeping appears in the log and in `pg_stat_progress_vacuum`. `pg_stat_all_tables` gained `total_vacuum_time` and `total_autovacuum_time` columns.

Practical impact: Postgres 18 fixes the two remaining operational pains. Freeze debt on big tables melts continuously instead of exploding, and worker count is finally a runtime knob.

## What this means for tuning

Old advice ages badly here. Check the version before you apply any vacuum recipe from a blog post. The big items:

- **"Lower `autovacuum_vacuum_cost_delay` from 20ms."** Obsolete since Postgres 12. The default is 2ms. A pasted-forward 20ms line in an old config is now a 10x throttle. Remove it.
- **"Vacuum caps at 1 GB of memory, and big tables need multiple index passes."** Obsolete since Postgres 17. Set `maintenance_work_mem` freely, and expect one index pass.
- **"Watch append-only tables, they get no vacuum until wraparound."** Obsolete since Postgres 13, and fully solved in Postgres 18, where the insert trigger counts only unfrozen pages.
- **"An anti-wraparound emergency needs manual `VACUUM (INDEX_CLEANUP off, FREEZE)`."** Mostly obsolete since Postgres 14. The failsafe at `vacuum_failsafe_age` does this automatically. Your monitoring should page long before the failsafe fires, but the hard floor exists.
- **"Fixing index bloat needs a maintenance window."** Obsolete since Postgres 12. `REINDEX CONCURRENTLY` rebuilds the index under load.
- **"Indexes on frequently updated or low-cardinality columns bloat without limit."** Much weaker since Postgres 13 (deduplication) and 14 (bottom-up deletion). Measure before you schedule rebuilds.
- **"Cost-setting changes do not affect a running autovacuum."** Obsolete since Postgres 16. Change the setting, reload, and the running worker picks it up at the next block.
- **"Adding autovacuum workers needs a restart."** Obsolete since Postgres 18, up to `autovacuum_worker_slots`.
- **"Aggressive freeze vacuums will always be periodic I/O storms."** Fading since Postgres 16, mostly gone in Postgres 18 with eager freezing. On 18, a steady trickle of freeze work replaces the spike.
- **Still true on every version:** autovacuum does not run parallel index vacuum, `autovacuum_max_workers` shares one cost budget across all workers, the xmin horizon (chapter 1) blocks all cleanup, and partitioned parents need external ANALYZE scheduling.

The tuning chapters of this book (3, 4, 7) assume Postgres 14 or later and call out version differences where they matter. If you run Postgres 12 or 13, the biggest single win available is usually the upgrade itself.

## Sources

- Postgres 12 release notes: https://www.postgresql.org/docs/release/12.0/
- Postgres 13 release notes: https://www.postgresql.org/docs/release/13.0/
- Postgres 14 release notes: https://www.postgresql.org/docs/release/14.0/
- Postgres 15 release notes: https://www.postgresql.org/docs/release/15.0/
- Postgres 16 release notes: https://www.postgresql.org/docs/release/16.0/
- Postgres 17 release notes: https://www.postgresql.org/docs/release/17.0/
- Postgres 18 release notes: https://www.postgresql.org/docs/release/18.0/
- Postgres 18 vacuum settings reference (defaults): https://www.postgresql.org/docs/18/runtime-config-vacuum.html
- pganalyze, "Waiting for Postgres 17: Faster VACUUM with Adaptive Radix Trees": https://pganalyze.com/blog/5mins-postgres-17-faster-vacuum-adaptive-radix-trees
- Microsoft, "PostgreSQL 18 Vacuuming Improvements Explained": https://techcommunity.microsoft.com/blog/adforpostgresql/postgresql-18-vacuuming-improvements-explained/4459484
- Neon, "PostgreSQL 18 Autovacuum and Maintenance Configuration": https://neon.com/postgresql/postgresql-18/autovacuum-maintenance-configuration
