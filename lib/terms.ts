export interface TermEntry {
  slug: string;
  term: string;
  kind: string;
  blurb: string;
  tag: string;
  built: boolean;
}

export const TERMS: TermEntry[] = [
  {
    slug: "xmin",
    term: "xmin",
    kind: "system column",
    blurb: "The xid that created a row version. Half of every visibility check.",
    tag: "page + demo",
    built: true,
  },
  {
    slug: "xmax",
    term: "xmax",
    kind: "system column",
    blurb: "The xid that deleted or superseded a row version. Set, never cleared, until vacuum.",
    tag: "in /explain/xmin",
    built: false,
  },
  {
    slug: "dead-tuple",
    term: "dead tuple",
    kind: "concept",
    blurb:
      "A row version no live snapshot can reach. Occupies a page until vacuum frees the line pointer.",
    tag: "in /explain/xmin",
    built: false,
  },
  {
    slug: "bloat",
    term: "bloat",
    kind: "concept",
    blurb:
      "Pages kept only because dead tuples were never reclaimed. The file does not shrink without a rewrite.",
    tag: "draft",
    built: false,
  },
  {
    slug: "autovacuum_vacuum_scale_factor",
    term: "autovacuum_vacuum_scale_factor",
    kind: "setting",
    blurb:
      "Fraction of n_live_tup added to the trigger threshold. The single most misconfigured value on large tables.",
    tag: "draft",
    built: false,
  },
  {
    slug: "autovacuum_vacuum_cost_delay",
    term: "autovacuum_vacuum_cost_delay",
    kind: "setting",
    blurb:
      "Milliseconds the worker sleeps per cost_limit units. Pre-12 clusters still carry 20 ms.",
    tag: "draft",
    built: false,
  },
  {
    slug: "freeze",
    term: "freeze",
    kind: "concept",
    blurb: "Marking a row version permanently visible so its xmin can be forgotten.",
    tag: "in /explain/autovacuum_freeze_max_age",
    built: false,
  },
  {
    slug: "aggressive-vacuum",
    term: "aggressive vacuum",
    kind: "concept",
    blurb:
      "A pass that ignores the visibility map and cannot be skipped. Triggered by table age, not by dead rows.",
    tag: "in /explain/autovacuum_freeze_max_age",
    built: false,
  },
  {
    slug: "autovacuum_freeze_max_age",
    term: "autovacuum_freeze_max_age",
    kind: "setting",
    blurb: "Table age at which a freeze pass stops being optional, even with autovacuum off.",
    tag: "page + demo",
    built: true,
  },
  {
    slug: "wraparound",
    term: "wraparound",
    kind: "failure mode",
    blurb:
      "32-bit xids run out. At 1,000,000 remaining the cluster refuses writes and wants single-user mode.",
    tag: "in /explain/autovacuum_freeze_max_age",
    built: false,
  },
  {
    slug: "visibility-map",
    term: "visibility map",
    kind: "structure",
    blurb:
      "Two bits per page: all-visible, all-frozen. What lets a normal vacuum skip most of a big table.",
    tag: "draft",
    built: false,
  },
  {
    slug: "multixact",
    term: "multixact",
    kind: "structure",
    blurb:
      "Shared row locks stored out of line. Has its own age, its own freeze limit, its own way to fill a disk.",
    tag: "draft",
    built: false,
  },
];

const redirects: Record<string, string> = {
  xmax: "xmin",
  "dead-tuple": "xmin",
  freeze: "autovacuum_freeze_max_age",
  "aggressive-vacuum": "autovacuum_freeze_max_age",
  wraparound: "autovacuum_freeze_max_age",
};

export function termHref(slug: string): string {
  const entry = TERMS.find((t) => t.slug === slug);
  if (entry?.built) return `/explain/${slug}`;
  const target = redirects[slug];
  if (target) return `/explain/${target}`;
  return "/arcana";
}
