import { z } from "zod";
import { PG_RANGE, SETTINGS, type SettingDef, type Values } from "./settings";

export type PatternName = "append-only" | "queue" | "large-update-heavy" | "mixed-oltp" | "cold";

export interface Hints {
  pattern?: PatternName;
  replicationLagBudget?: "none" | "tight" | "relaxed";
  storage?: "ssd" | "hdd";
  ramBytes?: number;
  maxWorkers?: number;
  longTransactions?: boolean;
  fkHeavy?: boolean;
  /**
   * Rates measured over hours from monitoring, which beat a two-sample
   * delta on any bursty table. Each one replaces the sampled rate.
   */
  measuredRates?: { deadPerDay?: number; insPerDay?: number; xidPerDay?: number };
}

export interface Snapshot {
  v: 1;
  db: string;
  table: string;
  capturedAt: string;
  live: number;
  dead: number;
  pages: number;
  deadPerDay: number;
  xidAge: number;
  xidPerDay: number;
  lastAutovacuum: string | null;
  indexes: number | null;
  current: Values;
  proposed: Values;
  // v2 optional fields (SENSE stage). Older links omit them.
  /**
   * pg_class.reltuples: the row count autovacuum's own scale-factor math
   * uses. n_live_tup is a statistics estimate and drifts from it, so every
   * trigger calculation reads this one through triggerRows(). Absent on
   * older links.
   */
  relTuples?: number;
  /** pg_is_in_recovery(): a replica keeps its own counters, all zero. */
  isReplica?: boolean;
  /**
   * How far the oldest snapshot in the cluster sits behind the current xid,
   * counting replication slots. Dead rows newer than this cannot be removed
   * by any vacuum, so it sets the floor a threshold has to clear.
   */
  horizonXids?: number;
  /** vacuum_failsafe_age, the point where vacuum drops every throttle. */
  failsafeAge?: number;
  /** The platform already meters vacuum I/O and memory against live load. */
  adaptiveVacuum?: boolean;
  /**
   * Dead rows per day read straight off n_dead_tup between two samples with
   * no vacuum in between. HOT pruning is already in this number, so it is
   * the cross-check on the modelled rate, which excludes HOT updates.
   */
  observedDeadPerDay?: number;
  insPerDay?: number;
  modPerDay?: number;
  hotFraction?: number;
  multixactAge?: number;
  versionNum?: number;
  isPartition?: boolean;
  hasToast?: boolean;
  rateConfidence?: "high" | "low";
  /** Seconds between the two statistics reads. Absent on older links. */
  sampleSeconds?: number;
  /** pg_class.relallvisible: heap pages a vacuum pass skips. Absent on older links. */
  allVisiblePages?: number;
  /** A statistics counter fell between the samples: reset, restart, or two servers. */
  countersReset?: { counter: string; first: number; second: number };
  /** pg_stat_user_tables.last_vacuum, when the snapshot SQL carried it. */
  lastVacuum?: string | null;
  /** reloptions carry autovacuum_enabled=false. */
  autovacuumOff?: boolean;
  /** One of the five /demo shapes, not a real table. The report says so. */
  demo?: true;
  hints?: Hints;
}

/** Below this interval a zero delta reads as "single sample", not "no writes". */
export const MIN_SAMPLE_SECONDS = 30;

/**
 * True when the two statistics reads span a real interval, so a zero delta
 * is a measured zero write rate, not a missing rate.
 */
export function hasMeasuredRate(snap: Snapshot): boolean {
  return !snap.countersReset && (snap.sampleSeconds ?? 0) >= MIN_SAMPLE_SECONDS;
}

/** Under this interval, one checkpoint or background job dominates the delta. */
export const NOISE_SAMPLE_SECONDS = 5;

/**
 * How much the rates can be trusted, one axis:
 * reset (a counter fell), single (one statistics read), noisy (interval
 * under 5 s), low (under 30 s), measured.
 */
export type RateStateName = "reset" | "single" | "noisy" | "low" | "measured";

export function rateState(snap: Snapshot): RateStateName {
  if (snap.countersReset) return "reset";
  if (snap.sampleSeconds === undefined) return "single";
  if (snap.sampleSeconds < NOISE_SAMPLE_SECONDS) return "noisy";
  if (snap.sampleSeconds < MIN_SAMPLE_SECONDS) return "low";
  return "measured";
}

/**
 * D5: under ~50k rows and ~100 MB, autovacuum fires on the 50-row floor and
 * a pass costs under a second. The defaults are correct; propose nothing.
 */
export function isSmallTable(snap: Snapshot): boolean {
  return snap.live < 50_000 && snap.pages * 8192 < 100 * 1024 * 1024;
}

const valuesSchema = (rangeOf: (d: SettingDef) => readonly [number, number]) =>
  z.record(z.string(), z.number()).superRefine((vals, ctx) => {
    for (const d of SETTINGS) {
      const v = vals[d.key];
      const [min, max] = rangeOf(d);
      if (v === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `missing setting ${d.key}` });
      } else if ((v < min && !(v === 0 && d.zeroOk)) || v > max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${d.key} = ${v} outside [${min}, ${max}]`,
        });
      }
    }
  });

// current holds what the database reports, so anything Postgres accepts is
// valid. proposed comes from the tuner and stays inside the tuning range.
const currentSchema = valuesSchema((d) => PG_RANGE[d.key]);
const proposedSchema = valuesSchema((d) => [d.min, d.max]);

export const SnapshotSchema: z.ZodType<Snapshot> = z
  .object({
    v: z.literal(1),
    db: z.string().min(1),
    table: z.string().min(1),
    capturedAt: z.string().min(1),
    live: z.number().nonnegative(),
    dead: z.number().nonnegative(),
    pages: z.number().positive(),
    deadPerDay: z.number().nonnegative(),
    xidAge: z.number().nonnegative(),
    xidPerDay: z.number().positive(),
    lastAutovacuum: z.string().nullable(),
    indexes: z.number().int().nonnegative().nullable(),
    current: currentSchema,
    proposed: proposedSchema,
    relTuples: z.number().optional(),
    isReplica: z.boolean().optional(),
    horizonXids: z.number().nonnegative().optional(),
    failsafeAge: z.number().positive().optional(),
    adaptiveVacuum: z.boolean().optional(),
    observedDeadPerDay: z.number().nonnegative().optional(),
    insPerDay: z.number().nonnegative().optional(),
    modPerDay: z.number().nonnegative().optional(),
    hotFraction: z.number().min(0).max(1).optional(),
    multixactAge: z.number().nonnegative().optional(),
    versionNum: z.number().int().positive().optional(),
    isPartition: z.boolean().optional(),
    hasToast: z.boolean().optional(),
    rateConfidence: z.enum(["high", "low"]).optional(),
    sampleSeconds: z.number().positive().optional(),
    allVisiblePages: z.number().nonnegative().optional(),
    countersReset: z
      .object({ counter: z.string(), first: z.number(), second: z.number() })
      .optional(),
    lastVacuum: z.string().nullable().optional(),
    autovacuumOff: z.boolean().optional(),
    demo: z.literal(true).optional(),
    hints: z
      .object({
        pattern: z
          .enum(["append-only", "queue", "large-update-heavy", "mixed-oltp", "cold"])
          .optional(),
        replicationLagBudget: z.enum(["none", "tight", "relaxed"]).optional(),
        storage: z.enum(["ssd", "hdd"]).optional(),
        ramBytes: z.number().positive().optional(),
        maxWorkers: z.number().int().positive().optional(),
        longTransactions: z.boolean().optional(),
        fkHeavy: z.boolean().optional(),
        measuredRates: z
          .object({
            deadPerDay: z.number().nonnegative().optional(),
            insPerDay: z.number().nonnegative().optional(),
            xidPerDay: z.number().positive().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict() as z.ZodType<Snapshot>;
