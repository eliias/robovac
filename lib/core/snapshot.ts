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
