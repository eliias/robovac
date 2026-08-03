import type { ComponentType, ReactNode } from "react";
import { CostDemo } from "@/components/explain/CostDemo";
import { FreezeDemo } from "@/components/explain/FreezeDemo";
import { HotDemo } from "@/components/explain/HotDemo";
import { TriggerDemo } from "@/components/explain/TriggerDemo";
import { XminDemo } from "@/components/explain/XminDemo";
import { C, MONO } from "@/components/ui";

export interface ExplainContent {
  definition: ReactNode;
  Demo?: ComponentType;
  seeAlso: string[];
  footnote: string;
}

const m = (text: string) => <span style={{ fontFamily: MONO, color: C.strong }}>{text}</span>;

export const CONTENT: Record<string, ExplainContent> = {
  xmin: {
    definition: (
      <>
        Every row version in a heap carries two hidden system columns: {m("xmin")}, the transaction
        id that created it, and {m("xmax")}, the transaction id that deleted or superseded it.
        Postgres never overwrites a row in place: an UPDATE writes a new version and stamps the old
        one&rsquo;s xmax. A transaction sees a version only if its xmin is committed and visible to
        that transaction&rsquo;s snapshot, and its xmax is not. Old versions stay on disk until
        vacuum proves no live snapshot can still need them; that backlog is what {m("n_dead_tup")}{" "}
        counts.
      </>
    ),
    Demo: XminDemo,
    seeAlso: ["xmax", "dead-tuple", "xmin-horizon"],
    footnote:
      "The demo shows one heap page and ignores HOT chains, index entries, and the visibility map. Real xids are 32-bit and compared modulo 2^31; see PostgreSQL docs §66.4 “Visibility Map” and §25.1.5 “Preventing Transaction ID Wraparound Failures”.",
  },
  xmax: {
    definition: (
      <>
        {m("xmax")} is the second half of every visibility check: the transaction id that deleted or
        superseded a row version. A DELETE stamps it on the current version; an UPDATE stamps it on
        the old version while writing the new one. It is set and never cleared: the version stays on
        disk, invisible to new snapshots, until vacuum removes it. A row with an empty xmax is
        simply alive.
      </>
    ),
    Demo: XminDemo,
    seeAlso: ["xmin", "dead-tuple"],
    footnote:
      "xmax also stores lock information: SELECT … FOR UPDATE writes a locker xid (or a multixact id) into xmax without killing the row. The demo shows only the delete/supersede meaning.",
  },
  "dead-tuple": {
    definition: (
      <>
        A dead tuple is a row version whose {m("xmax")} is committed and older than every live
        snapshot: nobody can see it anymore, but it still occupies its bytes on the page and its
        entries in every index. Vacuum exists to find these and free the space for reuse.{" "}
        {m("n_dead_tup")} in {m("pg_stat_user_tables")} is the running estimate, and the trigger
        formula compares exactly this number against the threshold.
      </>
    ),
    Demo: XminDemo,
    seeAlso: ["xmin", "bloat", "autovacuum_vacuum_scale_factor"],
    footnote:
      "The estimate comes from the statistics collector, not a count: it drifts between analyzes and resets on crash. Treat it as a signal, not an inventory.",
  },
  "xmin-horizon": {
    definition: (
      <>
        The xmin horizon is the oldest snapshot anyone in the cluster still holds. Vacuum may only
        remove row versions that died before it. Everything newer must be kept, because a running
        transaction could still read it. Four things pin the horizon: long-running transactions,
        stale or unused replication slots, prepared transactions, and standby feedback. While one of
        them holds it back, no autovacuum setting can remove a single dead row, and{" "}
        {m("n_dead_tup")} climbs on a perfectly tuned table.
      </>
    ),
    Demo: XminDemo,
    seeAlso: ["dead-tuple", "wraparound"],
    footnote:
      "Open a snapshot in the demo (BEGIN) and vacuum stops removing anything deleted after it: that is the horizon in one page. In production, find the holder in pg_stat_activity, pg_replication_slots, or pg_prepared_xacts before touching any knob.",
  },
  "hot-update": {
    definition: (
      <>
        A heap-only-tuple (HOT) update writes the new row version on the same page as the old one
        and touches no index at all: the old version&rsquo;s line pointer redirects to the new one.
        Two conditions, both required: the update changes no indexed column, and the page has free
        space. When either fails, the new version lands on another page and every index on the table
        gets a new entry. On update-heavy tables the HOT rate ({m("n_tup_hot_upd")} vs{" "}
        {m("n_tup_upd")}) decides the write amplification.
      </>
    ),
    Demo: HotDemo,
    seeAlso: ["fillfactor", "xmin"],
    footnote:
      "HOT chains are pruned by ordinary reads, not only by vacuum, which is why a hot page can stay small without ever being vacuumed. Postgres 16 relaxed the index condition for summarizing (BRIN) indexes.",
  },
  fillfactor: {
    definition: (
      <>
        {m("fillfactor")} is a table storage parameter: inserts stop filling a page when it is this
        percent full (default 100). The reserved remainder is not waste, it is the free space that
        lets an update stay on the same page, which is the second condition for a HOT update. On
        update-heavy tables a fillfactor of 90 trades 10% larger heap for a much higher HOT rate and
        far fewer index writes. It applies to newly written pages, so changing it needs a rewrite to
        affect existing data.
      </>
    ),
    Demo: HotDemo,
    seeAlso: ["hot-update", "bloat"],
    footnote:
      "Set it per table: ALTER TABLE t SET (fillfactor = 90). Append-only tables should keep 100: reserving space for updates that never come is pure bloat.",
  },
  bloat: {
    definition: (
      <>
        Bloat is space the table holds but does not use: dead tuples not yet vacuumed, plus free
        space from tuples vacuumed long ago that inserts never refilled. Vacuum makes space reusable
        inside the file; it almost never shrinks the file itself, so a table that once bloated stays
        big until a rewrite. The steady-state bloat of a healthy table is roughly the dead rows that
        accumulate between two vacuum runs, which is why the trigger cadence, not vacuum speed,
        decides how fat a table runs.
      </>
    ),
    Demo: TriggerDemo,
    seeAlso: ["dead-tuple", "autovacuum_vacuum_scale_factor", "pg_repack"],
    footnote:
      "Measure it exactly with pgstattuple, or estimate with the check_postgres queries (~3% off on plain tables, far more on TOAST-heavy ones). Practitioners investigate above ~20-30% and rebuild above ~50%.",
  },
  "visibility-map": {
    definition: (
      <>
        The visibility map is a tiny side file with two bits per heap page: all-visible (every row
        on the page is visible to every snapshot) and all-frozen (every row is frozen). A normal
        vacuum skips all-visible pages entirely (on a large, mostly-static table that is almost all
        of them), and index-only scans use the same bit to skip heap fetches. An aggressive vacuum
        trusts only the all-frozen bit.
      </>
    ),
    seeAlso: ["aggressive-vacuum", "freeze"],
    footnote:
      "About 32 MB of map per 1 TB of heap. The map is maintained by vacuum itself, which is the circular reason a long-unvacuumed table is also slow to vacuum.",
  },
  autovacuum_vacuum_scale_factor: {
    definition: (
      <>
        The trigger for a vacuum is {m("autovacuum_vacuum_threshold")} +{" "}
        {m("autovacuum_vacuum_scale_factor")} × {m("n_live_tup")}, and the default factor is 0.2:
        twenty percent of the table has to die before autovacuum looks at it. On a billion-row table
        that is 200M dead rows and often weeks between runs. Large tables converge on the opposite
        recipe: factor 0, and a fixed threshold sized to about an hour of the measured dead-row
        rate, so vacuum runs on a clock instead of on table size.
      </>
    ),
    Demo: TriggerDemo,
    seeAlso: ["autovacuum_vacuum_threshold", "bloat"],
    footnote:
      "Set per table via ALTER TABLE … SET (autovacuum_vacuum_scale_factor = …). Postgres 18 adds autovacuum_vacuum_max_threshold (default 100M) as a cap on what the formula can demand.",
  },
  autovacuum_vacuum_threshold: {
    definition: (
      <>
        The fixed part of the vacuum trigger, default 50 rows. On any real table the scale factor
        dwarfs it, until you set the factor to 0, at which point the threshold alone decides the
        cadence: dead rows arrive at your write rate, and vacuum fires every {m("threshold ÷ rate")}
        . That inversion is the core of cadence-first tuning, and it is why this obscure default
        matters more than it looks.
      </>
    ),
    Demo: TriggerDemo,
    seeAlso: ["autovacuum_vacuum_scale_factor", "autovacuum_naptime"],
    footnote:
      "The floor on the real cadence is autovacuum_naptime (default 1 min) and worker availability, not the threshold.",
  },
  autovacuum_vacuum_insert_scale_factor: {
    definition: (
      <>
        Since Postgres 13, inserts have their own trigger: {m("autovacuum_vacuum_insert_threshold")}{" "}
        + {m("autovacuum_vacuum_insert_scale_factor")} × {m("n_live_tup")}. Before it, an
        append-only table produced no dead rows, so nothing ever vacuumed it, until the forced
        anti-wraparound scan arrived and read the entire table cold. The insert trigger gets those
        pages vacuumed, frozen, and marked all-visible while they are still in cache.
      </>
    ),
    seeAlso: ["autovacuum_vacuum_insert_threshold", "vacuum_freeze_min_age"],
    footnote:
      "Postgres 18 scales the insert trigger by the unfrozen fraction of the table (relallfrozen), so a well-frozen append-only table triggers less often.",
  },
  autovacuum_vacuum_insert_threshold: {
    definition: (
      <>
        The fixed part of the insert trigger (default 1,000). On append-only tables the recipe
        mirrors the dead-row side: insert scale factor 0 and a threshold sized to about an hour of
        the insert rate. Pair it with a low {m("vacuum_freeze_min_age")} so the insert-triggered
        vacuums actually freeze what they visit: pages an append-only workload writes once and never
        touches again.
      </>
    ),
    seeAlso: ["autovacuum_vacuum_insert_scale_factor", "vacuum_freeze_min_age"],
    footnote: "Set to -1 to disable insert-triggered vacuums for a table. Needs Postgres 13+.",
  },
  autovacuum_analyze_scale_factor: {
    definition: (
      <>
        The analyze trigger is {m("autovacuum_analyze_threshold")} +{" "}
        {m("autovacuum_analyze_scale_factor")} × {m("n_live_tup")}, default factor 0.1. It refreshes
        the planner&rsquo;s statistics, and stale statistics are a quiet outage: row estimates
        drift, plans flip, partition pruning stops working. High-churn tables and partitions want a
        static trigger (factor 0, fixed threshold), because ten percent of a big partition is far
        past the point where plans went wrong.
      </>
    ),
    seeAlso: ["autovacuum_analyze_threshold", "autovacuum_vacuum_scale_factor"],
    footnote:
      "Autovacuum never analyzes a partitioned parent, only the leaves. Schedule a manual ANALYZE on the parent if planner estimates across partitions matter.",
  },
  autovacuum_analyze_threshold: {
    definition: (
      <>
        The fixed part of the analyze trigger, default 50 modified rows. Everything said about{" "}
        {m("autovacuum_vacuum_threshold")} applies: with the scale factor at 0 it sets an absolute
        cadence in rows, which is what you want on tables whose statistics must not lag: queue
        tables, hot partitions, anything the planner touches on every request.
      </>
    ),
    seeAlso: ["autovacuum_analyze_scale_factor"],
    footnote: "The counter behind it is n_mod_since_analyze in pg_stat_user_tables.",
  },
  autovacuum_naptime: {
    definition: (
      <>
        Every {m("autovacuum_naptime")} (default 1 min) the launcher wakes and considers one
        database, so with N databases a given database is visited about every N × naptime. That
        visit is when trigger formulas are evaluated, which makes naptime the floor on any cadence
        you can configure: a threshold sized to fire every 10 seconds still fires at most once per
        visit.
      </>
    ),
    seeAlso: ["autovacuum_max_workers", "autovacuum_vacuum_threshold"],
    footnote:
      "Cluster-wide GUC, not a per-table reloption. Lowering it below the default is rarely the bottleneck; worker count is.",
  },
  autovacuum_max_workers: {
    definition: (
      <>
        At most {m("autovacuum_max_workers")} tables cluster-wide are vacuumed at once, default 3. A
        multi-hour vacuum of one big table occupies a worker for the whole run, and with three
        workers, three big tables starve everything else, and small hot tables silently miss their
        cadence. The operational rule from production tuning: when workers saturate, raise the
        worker count; never respond by lowering per-table frequency.
      </>
    ),
    seeAlso: ["autovacuum_naptime", "autovacuum_vacuum_cost_limit"],
    footnote:
      "Workers share one cost budget, so more workers each run slower unless the limit rises too. Postgres 18 makes the setting reloadable via autovacuum_worker_slots; before that a change needs a restart.",
  },
  autovacuum_vacuum_cost_delay: {
    definition: (
      <>
        Vacuum meters itself with a token budget: page touches cost units, and when the running
        balance reaches {m("autovacuum_vacuum_cost_limit")}, the worker sleeps{" "}
        {m("autovacuum_vacuum_cost_delay")} milliseconds. The default fell from 20 ms to 2 ms in
        Postgres 12 (a 10× speedup), but clusters initialized earlier often still carry 20 ms in
        their config, throttling every vacuum to a crawl on hardware that stopped caring a decade
        ago.
      </>
    ),
    Demo: CostDemo,
    seeAlso: ["autovacuum_vacuum_cost_limit", "vacuum_cost_page_dirty"],
    footnote:
      "0 disables throttling entirely. Manual VACUUM uses vacuum_cost_delay, which defaults to 0, that is why a hand-run vacuum feels so much faster than autovacuum.",
  },
  autovacuum_vacuum_cost_limit: {
    definition: (
      <>
        The size of the token budget: cost units the worker may spend before sleeping{" "}
        {m("autovacuum_vacuum_cost_delay")}. Default 200, which with 2 ms delay caps a vacuum at
        roughly 100,000 units per second: fast for cached pages, slow the moment pages are dirtied.
        All autovacuum workers share this budget between them, so raising worker count without
        raising the limit makes each worker slower. Production values on large tables run 600 to a
        few thousand.
      </>
    ),
    Demo: CostDemo,
    seeAlso: ["autovacuum_vacuum_cost_delay", "autovacuum_max_workers"],
    footnote:
      "The real constraint is usually replication lag and WAL volume, not local I/O: a fast vacuum is a WAL burst the replicas must absorb.",
  },
  vacuum_cost_page_hit: {
    definition: (
      <>
        The price of touching a page already in {m("shared_buffers")}: 1 unit, the baseline of the
        cost model. It exists so even a fully cached vacuum pays something and yields the CPU on
        schedule. In a warm cache, hits dominate the page count but almost none of the budget: the
        dirty pages do.
      </>
    ),
    Demo: CostDemo,
    seeAlso: ["vacuum_cost_page_miss", "vacuum_cost_page_dirty"],
    footnote: "Shared by manual VACUUM and autovacuum; there is no autovacuum_-prefixed variant.",
  },
  vacuum_cost_page_miss: {
    definition: (
      <>
        The price of reading a page from disk. Postgres 14 dropped the default from 10 to 2: the old
        value priced spinning disks where a random read cost real time, and on SSDs it made vacuum
        pay a 5× penalty for I/O that no longer hurts. A cluster carrying the old 10 (upgraded
        in-place, or copied config) throttles cold-cache vacuums for no reason.
      </>
    ),
    Demo: CostDemo,
    seeAlso: ["vacuum_cost_page_hit", "vacuum_cost_page_dirty"],
    footnote:
      "If you still run spinning storage, 10 remains an honest price; the robovac optimizer keeps it when the storage hint says hdd.",
  },
  vacuum_cost_page_dirty: {
    definition: (
      <>
        The price of dirtying a page (modifying it so it must be written back): 20 units, the
        dominant term of the cost model. This is deliberate: reads are cheap and repeatable, but
        every dirtied page becomes a write plus WAL that the whole replication chain has to absorb.
        A vacuum that removes a lot of dead rows dirties most pages it visits, which is why the
        first pass after long neglect is the slow one.
      </>
    ),
    Demo: CostDemo,
    seeAlso: ["vacuum_cost_page_hit", "vacuum_cost_page_miss"],
    footnote:
      "Freezing dirties pages too: an aggressive vacuum over a cold table pays this price for nearly every page it freezes.",
  },
  maintenance_work_mem: {
    definition: (
      <>
        The memory a vacuum may use for its dead-TID store, default 64 MB. Before Postgres 17 this
        was the hidden multiplier on vacuum cost: 64 MB held about 11M TIDs, and a table with more
        dead rows than that forced vacuum to stop, scan every index, and start again: multiple full
        index passes per run, capped further by a hard 1 GB limit. Postgres 17 replaced the array
        with an adaptive radix tree: ~20× more TIDs per MB, no 1 GB cap, and almost always a single
        index pass.
      </>
    ),
    seeAlso: ["autovacuum_vacuum_cost_limit", "bloat"],
    footnote:
      "autovacuum_work_mem overrides it for autovacuum workers. Production guidance: ~1% of RAM capped around 1-5 GB; on 17+ the setting matters far less for vacuum.",
  },
  freeze: {
    definition: (
      <>
        Transaction ids are 32-bit and wrap. A row whose {m("xmin")} falls more than 2^31
        transactions behind the current xid would appear to be in the future, so Postgres must mark
        old rows frozen (permanently visible, their xmin no longer compared) before that happens.
        Freezing is vacuum&rsquo;s second job, and the quiet one: it happens per page, it dirties
        the page, and its schedule is controlled by three age settings that only make sense
        together.
      </>
    ),
    Demo: FreezeDemo,
    seeAlso: ["vacuum_freeze_min_age", "aggressive-vacuum", "wraparound"],
    footnote:
      "Since Postgres 16 whole pages freeze at once when it is cheap (the WAL is already being written); Postgres 18 adds eager freezing of all-visible pages during normal vacuums.",
  },
  relfrozenxid: {
    definition: (
      <>
        Every table carries {m("relfrozenxid")} in {m("pg_class")}: a promise that no unfrozen row
        older than this xid exists in the table. Vacuum advances it when it can prove the promise
        for a newer xid, and {m("age(relfrozenxid)")} (how far the promise lags the current xid) is
        the single number wraparound monitoring watches. The three freeze settings are all expressed
        against this age.
      </>
    ),
    Demo: FreezeDemo,
    seeAlso: ["freeze", "autovacuum_freeze_max_age", "wraparound"],
    footnote:
      "Databases carry the same idea as datfrozenxid, the max over their tables. Alert around age 500M-1B; the hard limit is ~2.1B.",
  },
  vacuum_freeze_min_age: {
    definition: (
      <>
        A normal vacuum freezes only rows older than {m("vacuum_freeze_min_age")} xids (default
        50M). The trap is that the setting is in xids but the vacuum cadence is in time: if 50M xids
        take longer to burn than the interval between vacuums, no row is ever old enough when the
        vacuum arrives, nothing freezes, and all freeze work piles up for the aggressive pass. The
        rule from production tuning: keep it shorter, in time, than one vacuum interval, because a
        page that goes all-visible unfrozen is skipped by every later normal vacuum.
      </>
    ),
    seeAlso: ["freeze", "vacuum_freeze_table_age", "autovacuum_vacuum_insert_threshold"],
    footnote:
      "Append-only tables want it low (1-20M): their pages are written once, and freezing them on the first insert-triggered vacuum means never reading them cold again.",
  },
  vacuum_freeze_table_age: {
    definition: (
      <>
        When a vacuum starts on a table whose {m("age(relfrozenxid)")} exceeds{" "}
        {m("vacuum_freeze_table_age")} (default 150M), that vacuum escalates itself to aggressive:
        it ignores the all-visible map bits and advances {m("relfrozenxid")}. This is the polite
        escalation: it rides a vacuum that was going to run anyway. Keep it well under{" "}
        {m("autovacuum_freeze_max_age")}, so aggressive passes happen on your trigger schedule
        rather than as the forced anti-wraparound scan.
      </>
    ),
    seeAlso: ["aggressive-vacuum", "autovacuum_freeze_max_age"],
    footnote: "Capped internally at 95% of autovacuum_freeze_max_age, so it always fires first.",
  },
  "aggressive-vacuum": {
    definition: (
      <>
        An aggressive vacuum is a normal vacuum that refuses shortcuts: it visits every page not
        marked all-frozen (including all of the all-visible pages a normal pass skips) freezes what
        qualifies, and advances {m("relfrozenxid")}. It gets triggered by table age, not dead rows:
        politely at {m("vacuum_freeze_table_age")}, forcibly at {m("autovacuum_freeze_max_age")}.
        The forced form runs even with autovacuum off and does not yield to lock waiters, which is
        how a scheduled DDL statement ends up queueing a whole application behind it.
      </>
    ),
    Demo: FreezeDemo,
    seeAlso: ["vacuum_freeze_table_age", "autovacuum_freeze_max_age", "wraparound"],
    footnote:
      "Give every scheduled DDL a lock_timeout: the Joyent (2015) and Duffel (2021) outages are the same incident six years apart: DDL queued behind an anti-wraparound vacuum, everything queued behind the DDL.",
  },
  autovacuum_freeze_max_age: {
    definition: (
      <>
        Transaction ids are 32-bit and wrap. A row whose{" "}
        <a
          href="/explain/xmin"
          style={{ fontFamily: MONO, color: C.strong, borderBottom: "1px dotted #45454c" }}
        >
          xmin
        </a>{" "}
        falls more than 2^31 transactions behind the current xid would appear to be in the future,
        so Postgres must mark old rows frozen before that happens. {m("autovacuum_freeze_max_age")}{" "}
        is the table age at which autovacuum stops being optional: a worker is launched even if the
        table is otherwise idle and autovacuum is switched off. Setting it low means frequent
        aggressive scans; setting it high means fewer, larger ones and less margin before the 2^31
        limit forces the cluster read-only.
      </>
    ),
    Demo: FreezeDemo,
    seeAlso: ["aggressive-vacuum", "vacuum_failsafe_age", "wraparound"],
    footnote:
      "Raising it above ~400M is only safe while eager freezing keeps age(relfrozenxid) flat. A very high value also delays the day a latent bug detonates, and the blast radius grows with it.",
  },
  wraparound: {
    definition: (
      <>
        With 2^31 usable xids, an unfrozen row can only age so far before comparisons would invert
        and committed data would appear to be from the future. Postgres defends in stages: warnings
        at 40M xids of headroom, then a hard stop (no new write transactions) at 3M. Recovery is a
        vacuum of the tables holding the oldest {m("relfrozenxid")}, at whatever speed the neglected
        table allows; the public postmortems measure it in hours to days, and two of them ended by
        truncating rebuildable terabyte tables instead.
      </>
    ),
    Demo: FreezeDemo,
    seeAlso: ["relfrozenxid", "autovacuum_freeze_max_age", "vacuum_failsafe_age"],
    footnote:
      "One alarm prevents all of it: max(age(datfrozenxid)) over the cluster, paged at 1B. Modern Postgres (14+) no longer requires single-user mode for recovery.",
  },
  vacuum_failsafe_age: {
    definition: (
      <>
        The emergency brake, added in Postgres 14. When a table&rsquo;s age crosses{" "}
        {m("vacuum_failsafe_age")} (default 1.6B) during a vacuum, that vacuum abandons everything
        optional (cost-based throttling off, index cleanup skipped, truncation skipped) and does
        nothing but freeze as fast as the hardware allows. It is the difference between a wraparound
        near-miss and a shutdown; you are not supposed to see it fire, and if you do, the freeze
        settings upstream were wrong.
      </>
    ),
    seeAlso: ["autovacuum_freeze_max_age", "wraparound"],
    footnote:
      "Skipped index cleanup means index bloat to clean up afterwards, and the failsafe trades it willingly.",
  },
  multixact: {
    definition: (
      <>
        When several transactions lock the same row (foreign-key checks, {m("SELECT … FOR SHARE")}),
        the row&rsquo;s {m("xmax")} cannot hold them all, so Postgres allocates a multixact id
        pointing to a member list stored out of line. Multixacts have their own 32-bit counter,
        their own age, their own freeze settings, and a second, less visible limit: the member
        space, about 4B entries with no built-in metric. Under heavy contention member lists grow
        quadratically, and member exhaustion stops writes while every age metric still looks
        healthy.
      </>
    ),
    seeAlso: ["autovacuum_multixact_freeze_max_age", "xmax"],
    footnote:
      "The 2025 Metronome outage is the reference case: multixact age at half its threshold, member space full. If FK checks or FOR UPDATE dominate your workload, measure members, not only ages.",
  },
  autovacuum_multixact_freeze_max_age: {
    definition: (
      <>
        The multixact counterpart of {m("autovacuum_freeze_max_age")}, default 400M: at this
        multixact age a forced aggressive vacuum runs to freeze old multixact references. Vacuum
        also triggers on member-space usage: once the member area passes half its capacity, the
        effective threshold drops automatically. Tune it with the same caution as the xid version,
        and remember that member space, not age, is the limit that fills silently.
      </>
    ),
    seeAlso: ["multixact", "autovacuum_freeze_max_age"],
    footnote:
      "The paired minimum is vacuum_multixact_freeze_min_age; the same shorter-in-time-than-the-cadence rule applies.",
  },
  toast: {
    definition: (
      <>
        Values too large for a page (beyond ~2 kB after compression) move to the table&rsquo;s TOAST
        relation: a hidden companion table in {m("pg_toast")}, chunked and indexed. It has its own
        statistics and its own autovacuum state, and it does not inherit the parent&rsquo;s tuning:
        a JSONB-heavy table can keep a tidy heap while its TOAST relation bloats or burns through
        xids unnoticed. You cannot ALTER the toast table directly; set {m("toast.autovacuum_*")}{" "}
        parameters on the parent.
      </>
    ),
    seeAlso: ["bloat", "autovacuum_vacuum_threshold"],
    footnote:
      "Monitoring that only watches public.* misses TOAST age entirely; the forced freeze scan of a multi-TB pg_toast table is a classic surprise.",
  },
  pg_repack: {
    definition: (
      <>
        Vacuum makes space reusable; it does not give pages back. {m("pg_repack")} does: it rebuilds
        a table (or index) online by copying live rows to a new file while capturing concurrent
        changes with triggers, then swaps the files, holding only brief exclusive locks at the start
        and end. The costs are real (double the disk during the rebuild, the full table written
        through WAL, and a reindex of everything), but it is the standard answer once bloat is
        already in the file.
      </>
    ),
    seeAlso: ["bloat", "fillfactor"],
    footnote:
      "Alternatives: VACUUM FULL (simple, but an exclusive lock for the whole rewrite) and pg_squeeze (logical-replication based, no triggers). Table storage parameters can be lost on rebuild tooling: re-apply reloptions afterwards.",
  },
};
