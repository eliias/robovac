export interface TermEntry {
  slug: string;
  term: string;
  kind: string;
  blurb: string;
  tag: string;
  built: boolean;
}

// "Everything vacuum-adjacent that is worth knowing, in the order it tends to
// hurt you." Every entry has a page; tags mark the ones with a live demo.
export const TERMS: TermEntry[] = [
  {
    slug: "xmin",
    term: "xmin",
    kind: "system column",
    built: true,
    tag: "page + demo",
    blurb: "The xid that created a row version. Half of every visibility check.",
  },
  {
    slug: "xmax",
    term: "xmax",
    kind: "system column",
    built: true,
    tag: "page + demo",
    blurb: "The xid that deleted or superseded a row version. Set, never cleared, until vacuum.",
  },
  {
    slug: "dead-tuple",
    term: "dead tuple",
    kind: "concept",
    built: true,
    tag: "page + demo",
    blurb:
      "A row version no live snapshot can reach. Occupies a page until vacuum frees the line pointer.",
  },
  {
    slug: "xmin-horizon",
    term: "xmin horizon",
    kind: "concept",
    built: true,
    tag: "page + demo",
    blurb:
      "The oldest snapshot anyone still holds. Vacuum may not touch anything newer, no matter how you tune it.",
  },
  {
    slug: "hot-update",
    term: "HOT update",
    kind: "concept",
    built: true,
    tag: "page + demo",
    blurb:
      "An update that stays on the same page and touches no indexed column: no index writes at all.",
  },
  {
    slug: "fillfactor",
    term: "fillfactor",
    kind: "setting",
    built: true,
    tag: "page + demo",
    blurb:
      "How full inserts pack a page. Below 100, the reserve is what makes HOT updates possible.",
  },
  {
    slug: "bloat",
    term: "bloat",
    kind: "concept",
    built: true,
    tag: "page + demo",
    blurb:
      "Pages kept only because dead tuples were never reclaimed. The file does not shrink without a rewrite.",
  },
  {
    slug: "visibility-map",
    term: "visibility map",
    kind: "structure",
    built: true,
    tag: "page",
    blurb:
      "Two bits per page: all-visible, all-frozen. What lets a normal vacuum skip most of a big table.",
  },
  {
    slug: "autovacuum_vacuum_scale_factor",
    term: "autovacuum_vacuum_scale_factor",
    kind: "setting",
    built: true,
    tag: "page + demo",
    blurb:
      "Fraction of n_live_tup added to the trigger threshold. The single most misconfigured value on large tables.",
  },
  {
    slug: "autovacuum_vacuum_threshold",
    term: "autovacuum_vacuum_threshold",
    kind: "setting",
    built: true,
    tag: "page + demo",
    blurb:
      "The fixed part of the trigger. With scale factor 0, it alone decides the vacuum cadence.",
  },
  {
    slug: "autovacuum_vacuum_insert_scale_factor",
    term: "autovacuum_vacuum_insert_scale_factor",
    kind: "setting",
    built: true,
    tag: "page",
    blurb:
      "The insert-side scale factor (Postgres 13+). What gets append-only tables vacuumed at all.",
  },
  {
    slug: "autovacuum_vacuum_insert_threshold",
    term: "autovacuum_vacuum_insert_threshold",
    kind: "setting",
    built: true,
    tag: "page",
    blurb:
      "Inserted rows before an insert-triggered vacuum. Freezes append-only pages while they are still in cache.",
  },
  {
    slug: "autovacuum_analyze_scale_factor",
    term: "autovacuum_analyze_scale_factor",
    kind: "setting",
    built: true,
    tag: "page",
    blurb:
      "When the planner's statistics refresh. Stale statistics break plans, partition pruning included.",
  },
  {
    slug: "autovacuum_analyze_threshold",
    term: "autovacuum_analyze_threshold",
    kind: "setting",
    built: true,
    tag: "page",
    blurb: "The fixed part of the analyze trigger, same shape as the vacuum threshold.",
  },
  {
    slug: "autovacuum_naptime",
    term: "autovacuum_naptime",
    kind: "setting",
    built: true,
    tag: "page",
    blurb:
      "How often the launcher visits each database. The floor on any vacuum cadence you can configure.",
  },
  {
    slug: "autovacuum_max_workers",
    term: "autovacuum_max_workers",
    kind: "setting",
    built: true,
    tag: "page",
    blurb:
      "Workers across the whole cluster, default 3. Big tables occupy them for hours and starve the rest.",
  },
  {
    slug: "autovacuum_vacuum_cost_delay",
    term: "autovacuum_vacuum_cost_delay",
    kind: "setting",
    built: true,
    tag: "page + demo",
    blurb:
      "Milliseconds the worker sleeps per cost_limit units. Pre-12 clusters still carry 20 ms.",
  },
  {
    slug: "autovacuum_vacuum_cost_limit",
    term: "autovacuum_vacuum_cost_limit",
    kind: "setting",
    built: true,
    tag: "page + demo",
    blurb: "Cost units the worker may spend before it sleeps. The budget all workers share.",
  },
  {
    slug: "vacuum_cost_page_hit",
    term: "vacuum_cost_page_hit",
    kind: "setting",
    built: true,
    tag: "page + demo",
    blurb: "Price of a page found in shared_buffers: 1 unit. The cheap end of the cost model.",
  },
  {
    slug: "vacuum_cost_page_miss",
    term: "vacuum_cost_page_miss",
    kind: "setting",
    built: true,
    tag: "page + demo",
    blurb:
      "Price of reading a page from disk. 2 since Postgres 14; the old 10 priced spinning rust.",
  },
  {
    slug: "vacuum_cost_page_dirty",
    term: "vacuum_cost_page_dirty",
    kind: "setting",
    built: true,
    tag: "page + demo",
    blurb:
      "Price of dirtying a page: 20 units, the dominant term. Writes are what the throttle really meters.",
  },
  {
    slug: "maintenance_work_mem",
    term: "maintenance_work_mem",
    kind: "setting",
    built: true,
    tag: "page",
    blurb:
      "Memory for the dead-TID store. Too small meant multiple index passes, until Postgres 17.",
  },
  {
    slug: "freeze",
    term: "freeze",
    kind: "concept",
    built: true,
    tag: "page + demo",
    blurb: "Marking a row version permanently visible so its xmin can be forgotten.",
  },
  {
    slug: "relfrozenxid",
    term: "relfrozenxid",
    kind: "system column",
    built: true,
    tag: "page + demo",
    blurb:
      "The oldest unfrozen xid a table can contain. Its age is the number wraparound monitoring watches.",
  },
  {
    slug: "vacuum_freeze_min_age",
    term: "vacuum_freeze_min_age",
    kind: "setting",
    built: true,
    tag: "page",
    blurb:
      "How old a row must be before a vacuum freezes it. Must be shorter, in time, than the vacuum interval.",
  },
  {
    slug: "vacuum_freeze_table_age",
    term: "vacuum_freeze_table_age",
    kind: "setting",
    built: true,
    tag: "page",
    blurb:
      "Table age that escalates the next vacuum to aggressive, on your schedule instead of the forced one.",
  },
  {
    slug: "aggressive-vacuum",
    term: "aggressive vacuum",
    kind: "concept",
    built: true,
    tag: "page + demo",
    blurb:
      "A pass that ignores the visibility map and cannot be skipped. Triggered by table age, not by dead rows.",
  },
  {
    slug: "autovacuum_freeze_max_age",
    term: "autovacuum_freeze_max_age",
    kind: "setting",
    built: true,
    tag: "page + demo",
    blurb: "Table age at which a freeze pass stops being optional, even with autovacuum off.",
  },
  {
    slug: "wraparound",
    term: "wraparound",
    kind: "failure mode",
    built: true,
    tag: "page + demo",
    blurb:
      "32-bit xids run out. At 3M remaining the cluster refuses writes until a vacuum catches up.",
  },
  {
    slug: "vacuum_failsafe_age",
    term: "vacuum_failsafe_age",
    kind: "setting",
    built: true,
    tag: "page",
    blurb:
      "The emergency brake (Postgres 14+): at this age vacuum drops throttling and index cleanup to freeze faster.",
  },
  {
    slug: "multixact",
    term: "multixact",
    kind: "structure",
    built: true,
    tag: "page",
    blurb:
      "Shared row locks stored out of line. Has its own age, its own freeze limit, its own way to fill a disk.",
  },
  {
    slug: "autovacuum_multixact_freeze_max_age",
    term: "autovacuum_multixact_freeze_max_age",
    kind: "setting",
    built: true,
    tag: "page",
    blurb:
      "The multixact counterpart of freeze_max_age. Member space can run out long before this age looks bad.",
  },
  {
    slug: "toast",
    term: "TOAST",
    kind: "structure",
    built: true,
    tag: "page",
    blurb:
      "Side storage for oversized values. A separate table with its own autovacuum settings, tuned via the toast. prefix.",
  },
  {
    slug: "pg_repack",
    term: "pg_repack",
    kind: "tool",
    built: true,
    tag: "page",
    blurb:
      "Rewrites a bloated table online, holding only brief locks. What vacuum cannot do: give pages back.",
  },
];

export function termHref(slug: string): string {
  const entry = TERMS.find((t) => t.slug === slug);
  return entry ? `/explain/${slug}` : "/arcana";
}

function trigrams(s: string): Set<string> {
  const padded = `  ${s.toLowerCase()} `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

/**
 * N1: nearest built terms for a slug that matches none of them. Exact, then
 * prefix, then trigram similarity over slug and title, so a dropped
 * vacuum_ prefix or a typo still resolves.
 */
export function suggestTerms(slug: string, count = 3): TermEntry[] {
  const built = TERMS.filter((t) => t.built);
  const q = slug.toLowerCase();
  const query = trigrams(q);
  return built
    .map((t) => {
      let score = 0;
      if (t.slug === q) score += 10;
      if (t.slug.startsWith(q) || q.startsWith(t.slug)) score += 0.5;
      const own = trigrams(`${t.slug} ${t.term}`);
      let hits = 0;
      for (const g of query) if (own.has(g)) hits++;
      score += hits / Math.max(1, query.size);
      return { t, score };
    })
    .toSorted((a, b) => b.score - a.score)
    .slice(0, count)
    .map((x) => x.t);
}
