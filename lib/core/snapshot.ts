import { z } from "zod";
import { optimize } from "./optimize";
import { SETTINGS, type Values } from "./settings";

export type PatternName = "append-only" | "queue" | "large-update-heavy" | "mixed-oltp" | "cold";

export interface Hints {
  pattern?: PatternName;
  replicationLagBudget?: "none" | "tight" | "relaxed";
  storage?: "ssd" | "hdd";
  ramBytes?: number;
  maxWorkers?: number;
  longTransactions?: boolean;
  fkHeavy?: boolean;
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
  insPerDay?: number;
  modPerDay?: number;
  hotFraction?: number;
  multixactAge?: number;
  versionNum?: number;
  isPartition?: boolean;
  hasToast?: boolean;
  rateConfidence?: "high" | "low";
  hints?: Hints;
}

const valuesSchema = z.record(z.string(), z.number()).superRefine((vals, ctx) => {
  for (const d of SETTINGS) {
    const v = vals[d.key];
    if (v === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `missing setting ${d.key}` });
    } else if ((v < d.min && !(v === 0 && d.zeroOk)) || v > d.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${d.key} = ${v} outside [${d.min}, ${d.max}]`,
      });
    }
  }
});

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
    current: valuesSchema,
    proposed: valuesSchema,
    insPerDay: z.number().nonnegative().optional(),
    modPerDay: z.number().nonnegative().optional(),
    hotFraction: z.number().min(0).max(1).optional(),
    multixactAge: z.number().nonnegative().optional(),
    versionNum: z.number().int().positive().optional(),
    isPartition: z.boolean().optional(),
    hasToast: z.boolean().optional(),
    rateConfidence: z.enum(["high", "low"]).optional(),
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
      })
      .strict()
      .optional(),
  })
  .strict() as z.ZodType<Snapshot>;

const demoCurrent: Values = {
  autovacuum_vacuum_scale_factor: 0.2,
  autovacuum_vacuum_threshold: 50,
  autovacuum_vacuum_insert_scale_factor: 0.2,
  autovacuum_vacuum_insert_threshold: 1000,
  autovacuum_analyze_scale_factor: 0.1,
  autovacuum_analyze_threshold: 50,
  autovacuum_vacuum_cost_delay: 20,
  autovacuum_vacuum_cost_limit: 200,
  vacuum_cost_page_hit: 1,
  vacuum_cost_page_miss: 10,
  vacuum_cost_page_dirty: 20,
  vacuum_freeze_min_age: 50000000,
  vacuum_freeze_table_age: 150000000,
  autovacuum_freeze_max_age: 200000000,
  autovacuum_multixact_freeze_max_age: 400000000,
};

const demoStats = {
  v: 1 as const,
  db: "prod-eu-1",
  table: "events.event_log",
  capturedAt: "2026-07-30T09:14:00Z",
  live: 412338901,
  dead: 3148772,
  pages: 1740000,
  deadPerDay: 3637440,
  xidAge: 211480336,
  xidPerDay: 14200000,
  lastAutovacuum: "2026-07-24T05:14:00Z",
  indexes: 7,
  current: demoCurrent,
  insPerDay: 1400000,
  modPerDay: 5037440,
  hotFraction: 0.35,
  multixactAge: 12000000,
  versionNum: 160009,
  isPartition: false,
  hasToast: true,
  rateConfidence: "high" as const,
};

export const DEMO_SNAPSHOT: Snapshot = { ...demoStats, proposed: optimize(demoStats).values };
