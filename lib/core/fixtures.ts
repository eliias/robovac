// Test fixture only: an anonymised production-shaped table. Never shipped —
// the app has no placeholder data, a report exists only from a real payload.
import { optimize } from "./optimize";
import type { Snapshot } from "./snapshot";
import type { Values } from "./settings";

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
