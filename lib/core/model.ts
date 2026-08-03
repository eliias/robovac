import type { Values } from "./settings";

export const WRAP = 2147483647;

/**
 * The row count autovacuum multiplies by the scale factor. Autovacuum reads
 * pg_class.reltuples, not the n_live_tup statistics estimate, and the two
 * drift apart on a table whose analyze is behind. Every trigger calculation
 * goes through here so the choice lives in one place.
 */
export function triggerRows(snap: { live: number; relTuples?: number }): number {
  // Postgres 14+ reports reltuples = -1 for a relation it has never
  // vacuumed or analyzed, which means "unknown", not "empty".
  const rt = snap.relTuples;
  return rt !== undefined && rt >= 0 ? rt : snap.live;
}

/** How far apart the two row counts are, as a ratio at or above 1. */
export function rowCountDrift(snap: { live: number; relTuples?: number }): number {
  const rt = snap.relTuples;
  if (rt === undefined || rt < 0) return 1;
  const a = Math.max(1, snap.live);
  const b = Math.max(1, rt);
  return Math.max(a, b) / Math.min(a, b);
}

export function threshold(values: Values, rows: number): number {
  return values.autovacuum_vacuum_threshold + values.autovacuum_vacuum_scale_factor * rows;
}

export interface RunCost {
  seconds: number;
  mbps: number;
  costUnits: number;
}

/**
 * Pages of work in one vacuum pass. Vacuum skips heap pages the visibility
 * map marks all-visible; each index adds a fixed 30% of the heap on top.
 * Both are stated assumptions, like the page mix in runCost, not
 * measurements. Old snapshots without relallvisible price the full heap.
 */
export const INDEX_HEAP_FRACTION = 0.3;

export function passPages(
  pages: number,
  allVisiblePages?: number,
  indexes?: number | null,
): number {
  const heap = Math.max(1, pages - (allVisiblePages ?? 0));
  return heap + INDEX_HEAP_FRACTION * (indexes ?? 0) * pages;
}

export function runCost(values: Values, pages: number): RunCost {
  const costUnits =
    pages *
    (0.55 * values.vacuum_cost_page_hit +
      0.25 * values.vacuum_cost_page_miss +
      0.2 * values.vacuum_cost_page_dirty);
  const limit = Math.max(1, values.autovacuum_vacuum_cost_limit);
  const delay = values.autovacuum_vacuum_cost_delay;
  const raw = delay > 0 ? (costUnits / limit) * (delay / 1000) : pages * 0.000004;
  const seconds = Math.max(raw, 1);
  const mb = (pages * 8192) / 1048576;
  return { seconds, mbps: mb / seconds, costUnits };
}

export function sawPath(
  thresholdRows: number,
  deadPerDay: number,
  days: number,
  w: number,
  h: number,
  yMax: number,
): string {
  const period = thresholdRows / deadPerDay;
  let d = "M 0 " + h;
  let t = 0;
  let i = 0;
  while (t < days && i < 500) {
    const t2 = Math.min(t + period, days);
    const y = h - Math.min(1, (deadPerDay * (t2 - t)) / yMax) * h;
    d += " L " + ((t2 / days) * w).toFixed(2) + " " + y.toFixed(2);
    if (t2 < days) d += " L " + ((t2 / days) * w).toFixed(2) + " " + h;
    t = t2;
    i++;
  }
  return d;
}

export function daysToAggressive(freezeMaxAge: number, xidAge: number, xidPerDay: number): number {
  return (freezeMaxAge - xidAge) / xidPerDay;
}

export function shutdownMarginDays(xidAge: number, xidPerDay: number): number {
  return (WRAP - xidAge) / xidPerDay;
}
