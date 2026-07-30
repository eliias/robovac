# 9. War stories

tl;dr: Every failure mode in this book has taken down a real company. Sentry, Mandrill, and a mid-sized SaaS hit transaction ID wraparound and lost writes for hours or days. Joyent and Duffel lost whole services to a lock queue behind an anti-wraparound vacuum. Notion and Figma sharded their databases because vacuum could no longer keep up with one huge table. Metronome and GitLab hit the lesser-known 32-bit counters: multixact members and the subtransaction cache. The incidents span 2015 to 2026 and the pattern list at the end barely changes. Each story below gives the dates, the root cause, the fix, and the lesson that transfers.

## Sentry: transaction ID wraparound outage (2015)

- System: hosted Sentry, one primary Postgres server.
- Date: July 20, 2015, down for most of the US working day.
- Root cause: autovacuum could not freeze huge tables before the wraparound limit.
- Fix: failover to bigger hardware, then `TRUNCATE` of one disposable table.

Sentry, the error-tracking service, was down for most of the US working day on Monday, July 20, 2015. Their primary Postgres database stopped accepting writes. Postgres had reached the wraparound safety limit and blocked all writes to protect existing data (chapter 5 explains this limit).

The root cause was a write-heavy workload plus a freeze horizon set too far out. Autovacuum could not freeze the huge tables fast enough, and the oldest unfrozen transaction ID crossed the limit. The team first let the running autovacuums finish, which took about 3 hours. They also failed over to a bigger server (256 GB of memory, 24 cores) to make the vacuum faster.

One massive mapping table (events to rollups) still blocked recovery. The team decided the data in it was disposable and ran `TRUNCATE` on it. A truncate removes the table contents and its old transaction IDs with them. Service came back within 5 minutes of the truncate. On the old server, the offline vacuum was still running more than 24 hours later.

After the incident, Sentry ran 6 autovacuum workers with a 15-second naptime and `autovacuum_freeze_max_age = 500000000`. They also noted the hidden 1 GB cap on the memory that vacuum used for dead-row storage (removed in Postgres 17, see chapter 2).

**Lesson:** wraparound protection fails slowly and then all at once. Watch the age of the oldest unfrozen transaction ID, and know in advance which big tables you can truncate.

## Joyent: lock queue behind an anti-wraparound vacuum (2015)

- System: Manta object store, metadata on sharded Postgres clusters.
- Date: July 27, 2015, extended outage on one shard.
- Root cause: `DROP TRIGGER` queued behind an anti-wraparound vacuum, all queries queued behind the drop.
- Fix: live patch to remove vacuum sleep calls, then lock timeouts and vacuum dashboards.

On July 27, 2015, Joyent's Manta object store had an extended outage. Manta kept its metadata in sharded, replicated Postgres clusters. On one shard, autovacuum ran `VACUUM` on the main `manta` table "(to prevent wraparound)". That vacuum held a `SHARE UPDATE EXCLUSIVE` lock, and an anti-wraparound vacuum does not cancel itself when other work needs the table (chapter 3).

A deploy then ran `DROP TRIGGER`, which needs an `ACCESS EXCLUSIVE` lock. The drop queued behind the vacuum. Postgres queues every later query behind a waiting exclusive lock, so all reads and writes on the shard stopped. Worse, the cost-based vacuum delay (chapter 4) kept putting the vacuum to sleep while the whole shard waited on it. Joyent engineers live-patched the running process to remove the sleep calls and speed up the vacuum.

Joyent later built dashboards on `pg_stat_progress_vacuum`. Dave Pacheco's 2019 write-up gives the scale: vacuums of their shards took 5 to 10 days as a minimum, often 15 to 20 days, and sometimes more than 40 days. When the dead-row memory filled, vacuum repeated the index phase, and one extra index pass added about 3 days.

**Lesson:** an anti-wraparound vacuum does not yield. Give every DDL statement a `lock_timeout`, and treat a multi-day vacuum as a fact of life at multi-terabyte scale.

## Amazon RDS: an early warning system from fleet incidents (2016)

- System: the Amazon RDS for PostgreSQL fleet.
- Date: guidance published October 31, 2016, after repeated customer incidents.
- Root cause across the fleet: no alarm on transaction ID age until the database went read-only.
- Fix: the `MaximumUsedTransactionIDs` CloudWatch metric with an alarm at 1 billion.

Amazon runs one of the largest Postgres fleets in the world. On October 31, 2016, AWS engineer Shawn McCoy published the guidance that came out of their support load: implement an early warning system for transaction ID wraparound. The post exists because customers kept hitting forced read-only mode, and recovery needs an offline vacuum that can take hours or days.

RDS exposes the CloudWatch metric `MaximumUsedTransactionIDs`, which is `SELECT max(age(datfrozenxid)) FROM pg_database`. AWS recommends an alarm at 1 billion, with an optional low-severity warning at 500 million. The hard limit sits near 2.1 billion, so a 1 billion alarm leaves weeks of margin to find the blocker.

**Lesson:** the wraparound counter is one number, and one alarm on it converts a multi-day outage into a routine ticket. Every story in this chapter that ends in read-only mode lacked this alarm.

## Mailchimp: Mandrill wraparound outage (2019)

- System: Mandrill transactional email, 5 physical Postgres servers.
- Date: February 4 to 5, 2019, about 41 hours of degraded service.
- Root cause: uneven shard load pushed shard4 into wraparound safety shutdown.
- Fix: full vacuum plus `TRUNCATE` of two terabyte-scale rebuildable tables.

Mandrill is Mailchimp's transactional email service. It was degraded from February 4, 2019, 05:35 UTC to February 5, 22:09 UTC, about 41 hours. One of its 5 physical Postgres servers, shard4, hit transaction ID wraparound and went into safety shutdown. During the outage, Mandrill sent only about 80% of queued email.

The causes stacked up. The hash function that balanced load favored shard4, so it took more writes than the other shards. A write spike on February 3 pushed it further, and autovacuum fell behind. The team had already seen the risk in November 2018, when transaction IDs climbed to about half the limit during peak load. They judged it not urgent and filed a monitoring ticket to the backlog. The ticket was still open when the shard shut down.

The wraparound errors also hid in logs among unrelated exceptions for more than 6 hours. The team started a full vacuum at 14:16 UTC on February 4. The worst-case estimate for the vacuum was 40 days. On February 5 at 19:12 UTC, they truncated two terabyte-scale tables (Search and Url) whose data was rebuildable. The vacuum finished about an hour later, and sending resumed at 21:36 UTC. Mailchimp refunded affected customers for the period January 1 to February 13, 2019.

**Lesson:** a known risk in the backlog is an incident with a start date. Uneven shard load concentrates transaction ID burn on one server, so monitor each shard alone.

## Figma: vacuum pressure forced a partition program (2020 to 2024)

- System: Figma product metadata on one Amazon RDS Postgres server.
- Date: pressure visible from 2020, partition and shard work through 2024.
- Root cause: multi-terabyte tables caused reliability impact during vacuums and neared RDS IOPS limits.
- Fix: vertical partitioning into separate databases, then horizontal sharding.

Figma ran all product metadata on one Amazon RDS Postgres server. In 2020, traffic grew about 3x per year, and peak CPU passed 65%. The 2024 retrospective names vacuum as a core limit: some tables held terabytes and billions of rows, and Figma saw reliability impact while Postgres vacuumed them. Their hottest tables also approached the maximum IOPS of RDS.

Figma bought time with a bigger instance (r5.12xlarge to r5.24xlarge), read replicas, and PgBouncer. The durable fix was vertical partitioning: they moved groups of related tables to separate databases. The last such move, in October 2022, carried 50 tables. CPU on the largest partition fell to about 10%. Smaller databases also mean smaller tables, so each vacuum has less work.

Vertical partitioning has a ceiling: a single table can still outgrow one server. Figma then spent about nine months building horizontal sharding on top of their DBProxy service, described in their April 2024 post. The database stack grew almost 100x from 2020 while staying on Postgres.

**Lesson:** vacuum cost scales with table size, not with your hardware budget. Split the data before the biggest table dictates your reliability.

## Notion: the vacuum stall that forced a shard project (2021)

- System: Notion's product data in one Postgres monolith.
- Date: vacuum stalls from mid-2020, sharding completed in 2021.
- Root cause: vacuum stalled consistently on the monolith, with wraparound as the end state.
- Fix: application-level sharding into 480 logical shards on 32 servers.

Notion stored every workspace in one Postgres monolith. Around mid-2020, the `VACUUM` process on the monolith began to stall consistently. Dead rows accumulated and disk space stopped coming back. The team could add disk, but the real fear was transaction ID wraparound: if vacuum cannot finish, Postgres will eventually stop all writes. The engineering manager called this the inflection point for sharding.

Notion sharded at the application level in 2021. They split the `block` table and its relatives (`space`, `discussion`, `comment`) into 480 logical shards on 32 physical databases, 15 logical shards per server. They sized shards so no table passes 500 GB and no physical database passes 10 TB. The final switchover fit in a five-minute maintenance window. The October 6, 2021 post reports the result: enough IOPS headroom (they provisioned for 60,000 IOPS) and vacuum work that each small server can finish.

**Lesson:** a vacuum that stalls on a monolith is a capacity signal, not a tuning problem. Notion treated it as the trigger to re-architect before the wraparound deadline arrived.

## Helpshift: near wraparound on an append-only table (2021)

- System: Helpshift's production Postgres cluster.
- Date: May 2021, a near miss with emergency vacuums, no outage.
- Root cause: default trigger formula let a 4.3-billion-row table go 45 days between vacuums.
- Fix: per-table scale factor, earlier freeze passes, more vacuum memory.

In May 2021, Helpshift's Postgres cluster drifted toward transaction ID wraparound and caught the team off guard. No outage occurred, but the escape needed emergency vacuums. The write-up is one of the most concrete tuning journeys in public.

The root cause was the default trigger formula on a huge append-only log table (chapter 3). The table held 4.3 billion rows. With the default `autovacuum_vacuum_scale_factor` of 0.2, autovacuum waited for about 910 million dead rows, which took about 45 days. The table gained about 10 million rows per day, so freeze work piled up between the rare vacuum passes.

The fixes were per-table math, not folklore. They cut `autovacuum_vacuum_scale_factor` to 0.035, which triggers a vacuum about every 7.5 days at their dead-row rate of 20 million per day. They set `vacuum_freeze_table_age` to 160 million, 80% of the 200 million default freeze horizon, so aggressive passes happen on their schedule. They raised `maintenance_work_mem` from 64 MB to 1 GB so each pass finishes faster. Two years later, the cluster still ran without manual vacuum work.

**Lesson:** derive per-table settings from the table's own write rate. The defaults assume a small table, and a 4-billion-row table breaks every one of those assumptions.

## GitLab: subtransaction cache stalls (2021)

- System: GitLab.com's primary Postgres cluster and its replicas.
- Date: recurring stalls from June 24, 2021, fixed in September 2021.
- Root cause: `SAVEPOINT` during a long transaction overflowed the 65,000-entry subtransaction cache on replicas.
- Fix: removal of every `SAVEPOINT` from the application.

Starting June 24, 2021, GitLab.com saw the database stall for minutes at a time. Users got 500 errors, and queries piled up waiting on `SubtransControlLock`. The stalls looked random and resisted a month of investigation.

The mechanism was a hidden 32-bit counter, a cousin of the wraparound problem. Postgres tracks subtransactions (created by `SAVEPOINT`) in a small cache of 65,000 entries. When one long transaction was open on the primary, a single `SAVEPOINT` could push replicas into "suboverflow". Every visibility check then went to disk. In GitLab's benchmark, the cache filled in about 18 seconds, and throughput fell from 360,000 to 50,000 transactions per second. Long transactions were half of the trigger, and long transactions are also what holds back vacuum cleanup (chapter 1).

GitLab could not remove long transactions entirely, so they removed the other half: every `SAVEPOINT` in the application. They rewrote code paths with `INSERT ... ON CONFLICT`, moved updates out of subtransactions, and accepted non-atomic writes in a few places. The stalls stopped. GitLab also runs scheduled `pg_repack` jobs (their public runbook documents the tooling) to remove the bloat that vacuum cannot return to the operating system (chapter 6).

**Lesson:** transaction IDs are not the only 32-bit resource. Long transactions arm several failure modes at once, so treat them as a first-class operational metric.

## Duffel: partition job blocked behind an anti-wraparound vacuum (2021)

- System: Duffel's flight search API on Postgres.
- Date: November 22, 2021, 22:02 UTC, down 2 hours 18 minutes.
- Root cause: partition-creation DDL without a timeout queued behind an anti-wraparound vacuum.
- Fix: `lock_timeout` and `statement_timeout` on the partition job.

Duffel sells a flight search API. On November 22, 2021, at 22:02 UTC, search requests started failing. The outage lasted 2 hours and 18 minutes. It was the Joyent incident replayed six years later, which is why both stories are here.

The search results table had reached an `age(relfrozenxid)` of about 200 million, the `autovacuum_freeze_max_age` default. Autovacuum started a vacuum "(to prevent wraparound)" and held its `SHARE UPDATE EXCLUSIVE` lock. A scheduled job then tried to create the next partition of the table. The DDL needed a conflicting lock and waited without a timeout. Every later read and write queued behind the waiting DDL, and the API went down. A normal autovacuum cancels itself for a conflicting lock, but an anti-wraparound vacuum does not.

The fix was small. Duffel gave the partition job `lock_timeout` and `statement_timeout` values, the same guard rails their schema migrations already had. The post is also honest about detection: better lock-wait logging would have cut the diagnosis time.

**Lesson:** any scheduled DDL will one day meet an anti-wraparound vacuum. A one-line `lock_timeout` converts that meeting from an outage into a retry.

## Adyen: corruption from a freeze vacuum after an upgrade (2025)

- System: Adyen payment platform, Postgres clusters beyond 200 TB.
- Date: upgrade years earlier, corruption surfaced two years later, published January 27, 2025.
- Root cause: `rsync --size-only` left stale visibility maps, and a freeze vacuum froze invalid rows.
- Fix: row-by-row repair with `pg_surgery`, plus a safer upgrade runbook.

Adyen, the payment company, runs Postgres clusters beyond 200 TB. They upgraded from Postgres 9.6 to 13 with `pg_upgrade` in link mode, and synced replicas with `rsync --size-only`. Two years later, transaction errors surfaced. Millions of rows in TOAST storage (the side storage for oversized values) were corrupt. The January 27, 2025 post by their database engineers reconstructs the chain.

The `--size-only` flag skips files that changed but kept their size. The visibility map files changed exactly that way, so replicas kept stale maps. Pages were marked all-visible or all-frozen that were not. Adyen runs `autovacuum_freeze_max_age` at 1.2 billion, so the aggressive freeze vacuum came years later. When it came, it trusted the stale visibility map, froze invalid row versions, and made the damage permanent.

Recovery used the `pg_surgery` extension. The team extracted the damaged row addresses with `pg_visibility`, classified each row by its header flags, and applied `heap_force_freeze` or `heap_force_kill` row by row. They preserved ambiguous rows instead of deleting them. Their new upgrade runbook disables autovacuum during the upgrade window and restores replicas from disk snapshots instead of rsync.

**Lesson:** freeze vacuums trust the visibility map completely. A very high `autovacuum_freeze_max_age` also delays the moment a latent bug detonates, which makes the blast radius bigger.

## Metronome: multixact member exhaustion (2025)

- System: usage-based billing on Aurora Postgres 13.18, more than 30 TB.
- Date: May 10 to 17, 2025, 4 outages of more than 1 hour each.
- Root cause: backfill jobs plus billing locks exhausted the 4-billion-entry multixact member space.
- Fix: faster vacuums, more workers, a member-space metric, paused backfills.

Metronome runs usage-based billing on an Aurora Postgres 13.18 cluster larger than 30 TB. Between May 10 and May 17, 2025, they had 4 outages of more than 1 hour each. Writes through the API failed while reads kept working. The cause was not transaction IDs. It was the multixact member space, the storage behind row locks shared by several transactions (chapter 5 introduces multixacts).

A partition migration ran backfill jobs while the billing pipeline locked the same rows. Foreign key checks and `SELECT ... FOR UPDATE` create multixacts, and each new locker copies the old member list plus one. Member growth is therefore quadratic under contention. The member space holds about 4 billion entries, and when it filled, Postgres refused new writes.

Their monitoring made the failure invisible in advance. They tracked multixact ID age, which sat below half of their 400 million threshold. Postgres exposes no SQL metric for member space use, so nothing watched the resource that actually ran out. Emergency freeze vacuums also arrived earlier than expected, near 200 million multixact IDs. The fixes: a faster data-only vacuum strategy, more autovacuum workers, a member-space metric derived from the on-disk SLRU files, and a paused backfill pending redesign.

**Lesson:** Postgres has several finite ID spaces, and the documented one is not always the one that fills first. If your workload locks the same rows from many transactions, measure multixact members, not only ages.

## Anonymous B2B SaaS: autovacuum off, database read-only (2026)

- System: production Postgres at a mid-sized B2B SaaS company.
- Date: published February 13, 2026, incident months after autovacuum was disabled.
- Root cause: autovacuum disabled on several tables, transaction IDs aged to the limit.
- Fix: terminate long transactions, then manual `VACUUM FREEZE`.

A February 13, 2026 write-up by engineer Chandan Shukla describes a mid-sized B2B SaaS company whose production Postgres went read-only. All writes failed at once. Nothing had changed recently: no deploy, no load spike, no infrastructure event.

Months earlier, someone had disabled autovacuum on several tables as a performance workaround. The database processed about 10 transactions per second, roughly 864,000 transaction IDs per day. At that rate, the tables aged toward the wraparound limit in about 7.5 months. The counter advanced silently the whole time, and the deadline arrived on an otherwise normal day.

Recovery was manual. The team terminated long-running transactions that pinned old snapshots, then ran `VACUUM FREEZE` on the affected tables until the oldest ages fell back below the limit. The transferable math is the arrival time: divide 2 billion by your daily transaction rate, and that is your fuse length after someone turns autovacuum off.

**Lesson:** disabling autovacuum does not remove its work, it only schedules the work as an outage. Low traffic does not protect you, it only makes the fuse longer.

## Patterns

Twelve stories, eleven years, and the same few shapes repeat. These are the patterns robovac exists to catch.

1. **The counter was visible for months and nobody watched it.** Sentry, Mandrill, and the anonymous SaaS all had a linear counter marching toward a known limit. One query (`max(age(datfrozenxid))`) and one alarm at 1 billion, per AWS guidance, turns each of these outages into a ticket. Mandrill even saw the risk in advance and filed it to the backlog.

2. **An anti-wraparound vacuum plus one DDL statement stops the world.** The vacuum holds its lock and will not cancel. A waiting exclusive lock queues every later query. Joyent 2015 and Duffel 2021 are the same outage. The defense is a `lock_timeout` on every scheduled or migration DDL.

3. **At the limit, the fastest vacuum is `TRUNCATE`.** Sentry and Mandrill both escaped by truncating large disposable tables, minutes instead of days. This only works if you decided before the incident which data is rebuildable.

4. **Default autovacuum triggers fail on big tables.** A 20% scale factor on a billion-row table means hundreds of millions of dead rows before work starts, and 45-day gaps on Helpshift's log table. The fix is per-table settings derived from the table's own write rate (chapter 3, chapter 7).

5. **When vacuum cannot keep up with one table, the fix is architecture.** Notion, Figma, and Mandrill's hot shard show the same limit: vacuum cost scales with table size, and one huge or uneven table sets the risk for the whole system. Partitioning and sharding shrink the unit of vacuum work.

6. **Vacuum runtime at scale is days, so treat it as a monitored production process.** Joyent measured 5 to 40 days per pass, with extra index passes adding days when the dead-row memory filled. Watch `pg_stat_progress_vacuum`, size `maintenance_work_mem`, and prefer Postgres 17+ where the 1 GB structure is gone (chapter 2).

7. **Transaction IDs are not the only 32-bit resource.** Metronome exhausted multixact member space with no metric watching it. GitLab's subtransaction cache overflowed at 65,000 entries. Inventory every small ID space your workload touches, and measure the one without a built-in metric.

8. **Long transactions and disabled autovacuum are silent time bombs.** A long transaction pins cleanup, arms the subtransaction overflow, and blocks member-space reclamation. Disabling autovacuum sets a fuse measured in months. Both look harmless on the day someone does them.

## Sources

- Sentry, "Transaction ID Wraparound in Postgres" (July 23, 2015): https://blog.sentry.io/transaction-id-wraparound-in-postgres
- Hacker News discussion of the Sentry outage: https://news.ycombinator.com/item?id=9936711
- Joyent, "Postmortem for July 27 outage of the Manta service" (August 2015): https://tritondatacenter.com/blog/postmortem-for-july-27-outage-of-the-manta-service
- Lobsters discussion of the Joyent postmortem: https://lobste.rs/s/gknr2c/postmortem_for_july_27_outage_joyent
- Dave Pacheco, "Visualizing PostgreSQL Vacuum Progress" (2019): https://www.davepacheco.net/blog/2019/visualizing-postgresql-vacuum-progress/
- AWS Database Blog, "Implement an Early Warning System for Transaction ID Wraparound in Amazon RDS for PostgreSQL" (October 31, 2016): https://aws.amazon.com/blogs/database/implement-an-early-warning-system-for-transaction-id-wraparound-in-amazon-rds-for-postgresql/
- Mailchimp, "What We Learned from the Recent Mandrill Outage" (February 2019): https://mailchimp.com/what-we-learned-from-the-recent-mandrill-outage/
- Hacker News thread on the Mandrill outage email: https://news.ycombinator.com/item?id=19086626
- Figma, "The growing pains of database architecture" (2023): https://www.figma.com/blog/how-figma-scaled-to-multiple-databases/
- Figma, "How Figma's databases team lived to tell the scale" (2024): https://www.figma.com/blog/how-figmas-databases-team-lived-to-tell-the-scale/
- Notion, "Herding elephants: Lessons learned from sharding Postgres at Notion" (October 6, 2021): https://www.notion.com/blog/sharding-postgres-at-notion
- Helpshift Engineering, "Auto-vacuum tuning in PostgreSQL" (2021): https://medium.com/helpshift-engineering/auto-vacuum-tuning-in-postgresql-3408f8b62ad8
- GitLab, "Why we spent the last month eliminating PostgreSQL subtransactions" (September 29, 2021): https://about.gitlab.com/blog/why-we-spent-the-last-month-eliminating-postgresql-subtransactions/
- GitLab runbook, "Pg_repack using gitlab-pgrepack": https://runbooks.gitlab.com/patroni/pg_repack/
- Duffel, "Understanding an outage: concurrency control & vacuuming in PostgreSQL" (2021): https://duffel.com/blog/understanding-outage-concurrency-vacuum-postgresql
- Adyen, "Database corruption in PostgreSQL: our journey to improving our upgrade process" (January 27, 2025): https://medium.com/adyen/database-corruption-in-postgresql-our-journey-to-improving-our-upgrade-process-d76d39e5b696
- Metronome, "Root Cause Analysis: PostgreSQL MultiXact member exhaustion incidents (May 2025)": https://metronome.com/blog/root-cause-analysis-postgresql-multixact-member-exhaustion-incidents-may-2025
- Chandan Shukla, "Downtime Caused by the Postgres Transaction ID Wraparound Problem" (February 13, 2026): https://www.sqlservercentral.com/articles/i-too-have-a-production-story-a-downtime-caused-by-postgres-transaction-id-wraparound-problem
- Hacker News thread on the SQLServerCentral incident: https://news.ycombinator.com/item?id=47819305
