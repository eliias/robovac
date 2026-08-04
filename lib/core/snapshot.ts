import { z } from "zod";
import { PG_RANGE, SETTINGS, type SettingDef } from "./settings";

export const PATTERN_NAMES = [
  "append-only",
  "queue",
  "large-update-heavy",
  "mixed-oltp",
  "cold",
] as const;
export type PatternName = (typeof PATTERN_NAMES)[number];

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

/**
 * What the caller knows about the workload and the server that a statistics
 * read cannot show. One declaration: the MCP tool validates against this
 * schema, the codec validates the same schema inside a link, and Hints below
 * is read off it. A new hint is one entry here, never three.
 */
export const HintsSchema = z
  .object({
    pattern: z.enum(PATTERN_NAMES).optional(),
    replicationLagBudget: z.enum(["none", "tight", "relaxed"]).optional(),
    storage: z.enum(["ssd", "hdd"]).optional(),
    ramBytes: z.number().positive().optional(),
    maxWorkers: z.number().int().positive().optional(),
    longTransactions: z.boolean().optional(),
    fkHeavy: z.boolean().optional(),
    /**
     * Rates measured over hours from monitoring, which beat a two-sample
     * delta on any bursty table. Each one replaces the sampled rate.
     */
    measuredRates: z
      .object({
        deadPerDay: z.number().nonnegative().optional(),
        insPerDay: z.number().nonnegative().optional(),
        xidPerDay: z.number().positive().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type Hints = z.infer<typeof HintsSchema>;

/**
 * One statistics read of one table, plus what the tuner proposed for it.
 * This schema is the only declaration of the shape: every link decodes
 * through it, and Snapshot below is read off it.
 */
export const SnapshotSchema = z
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
    /**
     * pg_class.reltuples: the row count autovacuum's own scale-factor math
     * uses. n_live_tup is a statistics estimate and drifts from it, so every
     * trigger calculation reads this one through triggerRows(). A hand-built
     * paste can omit it.
     */
    relTuples: z.number().optional(),
    /** pg_is_in_recovery(): a replica keeps its own counters, all zero. */
    isReplica: z.boolean().optional(),
    /**
     * How far the oldest snapshot in the cluster sits behind the current xid,
     * counting replication slots. Dead rows newer than this cannot be removed
     * by any vacuum, so it sets the floor a threshold has to clear.
     */
    horizonXids: z.number().nonnegative().optional(),
    /** vacuum_failsafe_age, the point where vacuum drops every throttle. */
    failsafeAge: z.number().positive().optional(),
    /** The platform already meters vacuum I/O and memory against live load. */
    adaptiveVacuum: z.boolean().optional(),
    /**
     * Dead rows per day read straight off n_dead_tup between two samples with
     * no vacuum in between. HOT pruning is already in this number, so it is
     * the cross-check on the modelled rate, which excludes HOT updates.
     */
    observedDeadPerDay: z.number().nonnegative().optional(),
    insPerDay: z.number().nonnegative().optional(),
    modPerDay: z.number().nonnegative().optional(),
    hotFraction: z.number().min(0).max(1).optional(),
    multixactAge: z.number().nonnegative().optional(),
    versionNum: z.number().int().positive().optional(),
    isPartition: z.boolean().optional(),
    hasToast: z.boolean().optional(),
    rateConfidence: z.enum(["high", "low"]).optional(),
    /** Seconds between the two statistics reads. Absent on a single sample. */
    sampleSeconds: z.number().positive().optional(),
    /** pg_class.relallvisible: heap pages a vacuum pass skips. */
    allVisiblePages: z.number().nonnegative().optional(),
    /** A statistics counter fell between the samples: reset, restart, or two servers. */
    countersReset: z
      .object({ counter: z.string(), first: z.number(), second: z.number() })
      .optional(),
    /** pg_stat_user_tables.last_vacuum, when the snapshot SQL carried it. */
    lastVacuum: z.string().nullable().optional(),
    /** reloptions carry autovacuum_enabled=false. */
    autovacuumOff: z.boolean().optional(),
    /** One of the five /demo shapes, not a real table. The report says so. */
    demo: z.literal(true).optional(),
    hints: HintsSchema.optional(),
  })
  .strict();

export type Snapshot = z.infer<typeof SnapshotSchema>;

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
const NOISE_SAMPLE_SECONDS = 5;

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
