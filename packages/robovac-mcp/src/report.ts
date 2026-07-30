import { fmtCompact, fmtDur } from "../../../lib/core/format";
import { threshold } from "../../../lib/core/model";
import { optimize } from "../../../lib/core/optimize";
import { SETTINGS, defaultValues, type Values } from "../../../lib/core/settings";
import { SnapshotSchema, type Hints, type Snapshot } from "../../../lib/core/snapshot";

export type Row = Record<string, unknown>;

function num(row: Row, column: string): number {
  const v = row[column];
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (Number.isNaN(n)) {
    throw new Error(`column "${column}" is missing or not numeric in the provided row`);
  }
  return n;
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

function deadDelta(row: Row): number {
  return num(row, "n_tup_upd") - num(row, "n_tup_hot_upd") + num(row, "n_tup_del");
}

function parseCapturedAt(row: Row, which: string): number {
  const raw = text(row, "captured_at");
  const ms = raw ? Date.parse(raw) : NaN;
  if (Number.isNaN(ms)) throw new Error(`captured_at is missing or unparsable in the ${which} row`);
  return ms;
}

export function buildSnapshot(first: Row, second: Row, hints?: Hints): Snapshot {
  const aMs = parseCapturedAt(first, "first");
  const bMs = parseCapturedAt(second, "second");
  const dtSeconds = Math.max(1, (bMs - aMs) / 1000);
  const dtDays = dtSeconds / 86400;
  const deadDeltaRows = deadDelta(second) - deadDelta(first);
  const insDeltaRows = num(second, "n_tup_ins") - num(first, "n_tup_ins");
  const hotDelta = num(second, "n_tup_hot_upd") - num(first, "n_tup_hot_upd");
  const updDelta = num(second, "n_tup_upd") - num(first, "n_tup_upd");

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
    rateConfidence: (dtSeconds >= 30 && deadDeltaRows + insDeltaRows >= 50 ? "high" : "low") as
      | "high"
      | "low",
    hints,
  };
  const proposal = optimize(stats);
  return SnapshotSchema.parse({ ...stats, proposed: proposal.values });
}

export function verdict(snap: Snapshot): string {
  const thr = threshold(snap.current, snap.live);
  const period = snap.deadPerDay > 0 ? fmtDur(thr / snap.deadPerDay) : "∞";
  const aggressive = snap.xidAge > snap.current.autovacuum_freeze_max_age;
  return (
    `Autovacuum fires every ${period} at the observed write rate. ` +
    `The table reaches ${fmtCompact(thr)} dead tuples before each run` +
    (aggressive
      ? ", and relfrozenxid age is past autovacuum_freeze_max_age, so every run is aggressive."
      : ".")
  );
}
