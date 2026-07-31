import { fmtCompact, fmtDur, fmtSecs } from "../../../lib/core/format";
import { threshold } from "../../../lib/core/model";
import { optimize } from "../../../lib/core/optimize";
import { SETTINGS, defaultValues, type Values } from "../../../lib/core/settings";
import {
  MIN_SAMPLE_SECONDS,
  SnapshotSchema,
  hasMeasuredRate,
  type Hints,
  type Snapshot,
} from "../../../lib/core/snapshot";

export type Row = Record<string, unknown>;

function num(row: Row, column: string): number {
  const v = row[column];
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (Number.isNaN(n)) {
    throw new Error(`column "${column}" is missing or not numeric in the provided row`);
  }
  return n;
}

/** Like num, but absent columns are fine: older snapshot SQL lacks them. */
function optNum(row: Row, column: string): number | undefined {
  if (row[column] === undefined || row[column] === null) return undefined;
  return num(row, column);
}

function text(row: Row, column: string): string | null {
  const v = row[column];
  return v === null || v === undefined ? null : String(v);
}

function reloptionsList(row: Row): string[] {
  const v = row.reloptions;
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v.map(String);
  // Some SQL tools serialize text[] as "{a=1,b=2}".
  return String(v)
    .replace(/^\{|\}$/g, "")
    .split(",")
    .filter(Boolean);
}

function globalSettings(row: Row): Map<string, string> {
  const v = row.global_settings;
  const obj = typeof v === "string" ? JSON.parse(v) : v;
  if (typeof obj !== "object" || obj === null) return new Map();
  return new Map(
    Object.entries(obj as Record<string, unknown>).map(([k, val]) => [k, String(val)]),
  );
}

function effectiveSettings(globals: Map<string, string>, reloptions: string[]): Values {
  const values = defaultValues();
  for (const d of SETTINGS) {
    const g = globals.get(d.key);
    if (g !== undefined) values[d.key] = Number(g);
  }
  for (const opt of reloptions) {
    const eq = opt.indexOf("=");
    if (eq < 0) continue;
    const key = opt.slice(0, eq).trim();
    if (SETTINGS.some((d) => d.key === key)) values[key] = Number(opt.slice(eq + 1));
  }
  // Per-table cost delay/limit of -1 mean "use the global value".
  if (values.autovacuum_vacuum_cost_delay < 0) {
    values.autovacuum_vacuum_cost_delay = Number(globals.get("vacuum_cost_delay") ?? 2);
  }
  if (values.autovacuum_vacuum_cost_limit < 0) {
    values.autovacuum_vacuum_cost_limit = Number(globals.get("vacuum_cost_limit") ?? 200);
  }
  return values;
}

function fmtLong(v: number): string {
  return v.toLocaleString("en-US");
}

function deadDelta(row: Row): number {
  return num(row, "n_tup_upd") - num(row, "n_tup_hot_upd") + num(row, "n_tup_del");
}

function parseCapturedAt(row: Row, which: string): number {
  const raw = text(row, "captured_at");
  const ms = raw ? Date.parse(raw) : NaN;
  if (Number.isNaN(ms)) throw new Error(`captured_at is missing or unparsable in the ${which} row`);
  return ms;
}

// The counters a reset shows up in. Checked before any delta divides.
const MONOTONIC_COUNTERS = ["n_tup_ins", "n_tup_upd", "n_tup_del", "n_tup_hot_upd", "xid_now"];

function detectReset(
  first: Row,
  second: Row,
): { counter: string; first: number; second: number } | undefined {
  let worst: { counter: string; first: number; second: number } | undefined;
  for (const counter of MONOTONIC_COUNTERS) {
    const a = num(first, counter);
    const b = num(second, counter);
    if (b < a && (!worst || a - b > worst.first - worst.second)) {
      worst = { counter, first: a, second: b };
    }
  }
  return worst;
}

export function buildSnapshot(first: Row, secondRow?: Row, hints?: Hints): Snapshot {
  const two = secondRow !== undefined;
  const second = secondRow ?? first;
  const aMs = parseCapturedAt(first, "first");
  const bMs = parseCapturedAt(second, "second");
  const dtSeconds = Math.max(1, (bMs - aMs) / 1000);
  const dtDays = dtSeconds / 86400;
  const countersReset = two ? detectReset(first, second) : undefined;
  const deadDeltaRows = countersReset ? 0 : deadDelta(second) - deadDelta(first);
  const insDeltaRows = countersReset ? 0 : num(second, "n_tup_ins") - num(first, "n_tup_ins");
  const hotDelta = countersReset ? 0 : num(second, "n_tup_hot_upd") - num(first, "n_tup_hot_upd");
  const updDelta = countersReset ? 0 : num(second, "n_tup_upd") - num(first, "n_tup_upd");

  const stats = {
    v: 1 as const,
    db: text(second, "db") ?? "unknown",
    table: `${text(second, "schema_name")}.${text(second, "table_name")}`,
    capturedAt: new Date(bMs).toISOString(),
    live: num(second, "n_live_tup"),
    dead: num(second, "n_dead_tup"),
    pages: Math.max(1, num(second, "relpages")),
    deadPerDay: Math.max(0, Math.round(deadDeltaRows / dtDays)),
    xidAge: num(second, "xid_age"),
    xidPerDay: Math.max(
      1000,
      Math.round((num(second, "xid_now") - num(first, "xid_now")) / dtDays),
    ),
    lastAutovacuum: text(second, "last_autovacuum"),
    indexes: num(second, "index_count"),
    current: effectiveSettings(globalSettings(second), reloptionsList(second)),
    insPerDay: Math.max(0, Math.round(insDeltaRows / dtDays)),
    modPerDay: Math.max(0, Math.round((deadDeltaRows + insDeltaRows + hotDelta) / dtDays)),
    hotFraction: updDelta > 0 ? Math.min(1, Math.max(0, hotDelta / updDelta)) : undefined,
    multixactAge: num(second, "mxid_age"),
    versionNum: num(second, "version_num"),
    isPartition: Boolean(second.is_partition),
    hasToast: Boolean(second.has_toast),
    rateConfidence: (two &&
    !countersReset &&
    dtSeconds >= MIN_SAMPLE_SECONDS &&
    deadDeltaRows + insDeltaRows >= 50
      ? "high"
      : "low") as "high" | "low",
    sampleSeconds: two ? Math.round(dtSeconds) : undefined,
    allVisiblePages: optNum(second, "relallvisible"),
    countersReset,
    lastVacuum: "last_vacuum" in second ? text(second, "last_vacuum") : undefined,
    autovacuumOff: reloptionsList(second).includes("autovacuum_enabled=false") || undefined,
    hints,
  };
  const proposal = optimize(stats);
  return SnapshotSchema.parse({ ...stats, proposed: proposal.values });
}

export function verdict(snap: Snapshot): string {
  const thr = threshold(snap.current, snap.live);
  const aggressive = snap.xidAge > snap.current.autovacuum_freeze_max_age;
  const tail = aggressive
    ? ", and relfrozenxid age is past autovacuum_freeze_max_age, so every run is aggressive."
    : ".";
  if (snap.deadPerDay > 0) {
    return (
      `Autovacuum fires every ${fmtDur(thr / snap.deadPerDay)} at the observed write rate. ` +
      `The table reaches ${fmtCompact(thr)} dead tuples before each run${tail}`
    );
  }
  if (snap.countersReset) {
    const r = snap.countersReset;
    return (
      `${r.counter} fell from ${fmtLong(r.first)} to ${fmtLong(r.second)} between the two samples: ` +
      `statistics were reset, and rates are unknown. ` +
      `The trigger sits at ${fmtCompact(thr)} dead tuples${tail}`
    );
  }
  if (hasMeasuredRate(snap)) {
    return (
      `No writes landed in the ${fmtSecs(snap.sampleSeconds ?? 0)} between the two samples, ` +
      `so autovacuum never fires on dead tuples at this rate. ` +
      `The trigger sits at ${fmtCompact(thr)} dead tuples${tail}`
    );
  }
  return (
    `Autovacuum fires every ∞ at the observed write rate. ` +
    `The table reaches ${fmtCompact(thr)} dead tuples before each run${tail}`
  );
}
