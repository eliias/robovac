# Postgres vacuum, researched

This folder is a small book about Postgres vacuum. It collects what the documentation says, what the internals do, and what engineers at large deployments report. It is the domain foundation for robovac (see `../design-brief.md` and the technical spec).

Each chapter is one file. Each chapter ends with its sources.

## Table of contents

1. [MVCC and dead rows](01-mvcc-and-dead-rows.md): how updates and deletes create dead rows, xmin/xmax, HOT updates, the xmin horizon.
2. [What vacuum actually does](02-what-vacuum-does.md): the phases of a vacuum pass, the dead-TID store, visibility map, ANALYZE, VACUUM FULL.
3. [Autovacuum scheduling](03-autovacuum-scheduling.md): the trigger formulas, naptime, workers, why the defaults fail on big tables.
4. [Cost-based throttling](04-cost-throttling.md): the cost model, converting knobs to MB/s, the speed vs foreground I/O tradeoff.
5. [Freezing and wraparound](05-freezing-and-wraparound.md): the 32-bit XID space, freeze ages, aggressive vacuum, the failsafe, the shutdown.
6. [Bloat](06-bloat.md): measuring it, what it costs, and how to recover (VACUUM FULL, pg_repack, pg_squeeze, pg-osc).
7. [Tuning by workload](07-workload-tuning.md): recipes for append-only, update-heavy, queue, TOAST, and partitioned tables.
8. [Monitoring vacuum](08-monitoring.md): progress views, log lines, xmin horizon queries, the alerts a team should have.
9. [War stories](09-war-stories.md): sourced production incidents (Sentry, Mailchimp, Joyent, and more) and the patterns behind them.
10. [Vacuum across versions](10-version-changes.md): what changed from Postgres 12 to 18, and which old advice is obsolete.
