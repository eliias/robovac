import { optimize } from "./optimize";
import { defaultValues, type Values } from "./settings";
import { SnapshotSchema, type Snapshot } from "./snapshot";

/**
 * The five /demo shapes. Each is a full snapshot payload that opens the
 * ordinary report route: same formulas, same sliders, no separate code
 * path. Names are invented; the statistics are shaped after production
 * tables of that kind, round enough to check by hand.
 *
 * The proposal rule (easy to get wrong): a scenario that declares any
 * proposal treats every unlisted setting as "leave at current". Only
 * event_log takes the optimizer's own proposal. Without that rule the
 * append-only partition would offer to lower a trigger its prose calls
 * irrelevant, and the tuned table would offer six changes one line under
 * a sentence saying it offers none.
 */
export interface DemoScenario {
  key: string;
  shape: string;
  teach: string;
  snap: Snapshot;
}

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

interface Shape {
  key: string;
  table: string;
  shape: string;
  teach: string;
  live: number;
  dead: number;
  pages: number;
  allVisiblePages: number;
  deadPerDay: number;
  insPerDay: number;
  xidAge: number;
  xidPerDay: number;
  /** ms before capture; null means never. */
  lastVacuumAgoMs: number | null;
  indexes: number;
  hotFraction: number;
  isPartition?: boolean;
  cur?: Record<string, number>;
  /** Changes on top of current; absent means the optimizer proposes. */
  prop?: Record<string, number> | "nothing";
  pattern?: "queue" | "append-only";
}

const SHAPES: Shape[] = [
  {
    key: "event_log",
    table: "events.event_log",
    shape: "scale factor never revisited",
    teach:
      "The default 0.2 scale factor on a 412 M-row table. Nobody set it wrong; nobody set it at all.",
    live: 412_338_901,
    dead: 3_148_772,
    pages: 1_740_000,
    allVisiblePages: 1_220_000,
    deadPerDay: 3_637_440,
    insPerDay: 2_000_000,
    xidAge: 211_480_336,
    xidPerDay: 14_200_000,
    lastVacuumAgoMs: 6 * DAY + 4 * HOUR,
    indexes: 7,
    hotFraction: 0.3,
    cur: { autovacuum_vacuum_cost_delay: 20, vacuum_cost_page_miss: 10 },
  },
  {
    key: "sessions",
    table: "public.sessions",
    shape: "fillfactor 100, no HOT updates",
    teach: "A table where the vacuum settings are not the problem. The fix is fillfactor.",
    live: 18_402_211,
    dead: 9_104_118,
    pages: 1_180_000,
    allVisiblePages: 350_000,
    deadPerDay: 41_220_000,
    insPerDay: 6_000_000,
    xidAge: 47_118_203,
    xidPerDay: 61_400_000,
    lastVacuumAgoMs: 11 * MIN,
    indexes: 4,
    hotFraction: 0.02,
    cur: { autovacuum_vacuum_scale_factor: 0.05 },
    prop: { autovacuum_vacuum_scale_factor: 0.02, autovacuum_vacuum_cost_limit: 4000 },
  },
  {
    key: "page_views",
    table: "analytics.page_views_2026_07",
    shape: "append-only, never vacuumed",
    teach: "Dead tuples are irrelevant here. The whole report is the freeze horizon.",
    live: 1_904_118_400,
    dead: 41_022,
    pages: 9_840_000,
    allVisiblePages: 0,
    deadPerDay: 12_400,
    insPerDay: 61_000_000,
    xidAge: 1_684_209_118,
    xidPerDay: 96_200_000,
    lastVacuumAgoMs: null,
    indexes: 2,
    hotFraction: 0,
    isPartition: true,
    prop: {
      autovacuum_vacuum_insert_scale_factor: 0.02,
      vacuum_freeze_min_age: 0,
      autovacuum_freeze_max_age: 400_000_000,
      vacuum_freeze_table_age: 100_000_000,
      autovacuum_vacuum_cost_limit: 4000,
    },
  },
  {
    key: "job_queue",
    table: "public.job_queue",
    shape: "xmin horizon pinned",
    teach: "The state no setting fixes. Every slider here is already correct.",
    live: 84_102,
    dead: 3_140_882,
    pages: 412_000,
    allVisiblePages: 20_000,
    deadPerDay: 74_600_000,
    insPerDay: 74_000_000,
    xidAge: 12_408_119,
    // Busy, but with 50+ days of wraparound headroom: the lesson here is
    // the pinned horizon, not an unrelated shutdown countdown.
    xidPerDay: 40_000_000,
    lastVacuumAgoMs: 41_000,
    indexes: 3,
    hotFraction: 0.05,
    cur: { autovacuum_vacuum_scale_factor: 0.01, autovacuum_vacuum_threshold: 1000 },
    prop: "nothing",
    pattern: "queue",
  },
  {
    key: "invoices",
    table: "billing.invoices",
    shape: "already correct",
    teach:
      "A tuned table. The report says so and proposes nothing, which is the result most tools refuse to give.",
    live: 41_208_119,
    dead: 782_114,
    pages: 604_000,
    allVisiblePages: 510_000,
    deadPerDay: 1_840_000,
    insPerDay: 1_800_000,
    xidAge: 38_204_118,
    xidPerDay: 8_400_000,
    lastVacuumAgoMs: 4 * HOUR + 12 * MIN,
    indexes: 5,
    hotFraction: 0.6,
    cur: {
      autovacuum_vacuum_scale_factor: 0.02,
      autovacuum_vacuum_threshold: 5000,
      autovacuum_vacuum_cost_limit: 1200,
    },
    prop: "nothing",
  },
];

function build(s: Shape, nowMs: number): Snapshot {
  const current: Values = { ...defaultValues(), ...s.cur };
  const capturedMs = nowMs - 2 * HOUR;
  const stats = {
    v: 1 as const,
    db: "prod-eu-1",
    table: s.table,
    capturedAt: iso(capturedMs),
    live: s.live,
    dead: s.dead,
    pages: s.pages,
    deadPerDay: s.deadPerDay,
    xidAge: s.xidAge,
    xidPerDay: s.xidPerDay,
    lastAutovacuum: s.lastVacuumAgoMs === null ? null : iso(capturedMs - s.lastVacuumAgoMs),
    lastVacuum: null,
    indexes: s.indexes,
    current,
    insPerDay: s.insPerDay,
    modPerDay: s.deadPerDay + s.insPerDay,
    hotFraction: s.hotFraction,
    multixactAge: 9_000_000,
    versionNum: 170_004,
    isPartition: s.isPartition ?? false,
    hasToast: true,
    rateConfidence: "high" as const,
    sampleSeconds: 45,
    allVisiblePages: s.allVisiblePages,
    demo: true as const,
    hints: s.pattern ? { pattern: s.pattern } : undefined,
  };
  const proposed: Values =
    s.prop === "nothing"
      ? { ...current }
      : s.prop
        ? { ...current, ...s.prop }
        : optimize(stats).values;
  return SnapshotSchema.parse({ ...stats, proposed });
}

export function demoScenarios(nowMs: number): DemoScenario[] {
  return SHAPES.map((s) => ({ key: s.key, shape: s.shape, teach: s.teach, snap: build(s, nowMs) }));
}
