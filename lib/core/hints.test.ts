import { describe, expect, it } from "vitest";
import { buildSnapshot } from "./report";
import { HintsSchema } from "./snapshot";

/**
 * create_report destructures first, second and baseUrl and hands the rest
 * straight to buildSnapshot. That works only because the tool's parameter
 * names are the schema's field names, and there is no mapping step left to
 * catch a mismatch, so the contract is pinned here instead.
 */

const row = (capturedAt: string) => ({
  db: "d",
  schema_name: "public",
  table_name: "t",
  relpages: 1000,
  n_live_tup: 1_000_000,
  n_dead_tup: 1000,
  n_tup_ins: 10,
  n_tup_upd: 10,
  n_tup_del: 10,
  n_tup_hot_upd: 1,
  xid_age: 1000,
  mxid_age: 1,
  index_count: 1,
  reloptions: null,
  version_num: 160009,
  xid_now: 5000,
  global_settings: {},
  captured_at: capturedAt,
});

describe("hints", () => {
  // Zod leaves an unsupplied optional as an explicit undefined key, so the
  // rest-object always carries all eight names. .strict() has to accept that.
  it("accepts the handler's rest-object, undefined keys and all", () => {
    const provided = {
      pattern: "queue" as const,
      replicationLagBudget: undefined,
      storage: undefined,
      ramBytes: undefined,
      maxWorkers: undefined,
      longTransactions: undefined,
      fkHeavy: undefined,
      measuredRates: { deadPerDay: 500_000, insPerDay: undefined, xidPerDay: undefined },
    };
    expect(() => HintsSchema.parse(provided)).not.toThrow();

    const snap = buildSnapshot(row("2026-07-30T09:00:00Z"), row("2026-07-30T09:01:00Z"), provided);
    expect(snap.hints?.pattern).toBe("queue");
    expect(snap.hints?.measuredRates?.deadPerDay).toBe(500_000);
  });

  // The names moved from snake_case to camelCase. The tool layer refuses an
  // unknown argument by name (see the strict() wrapper in lib/mcp/tools.ts);
  // this is the second wall, for a payload that arrives inside a link.
  it("rejects the old snake_case names instead of dropping them", () => {
    expect(() => HintsSchema.parse({ replication_lag_budget: "tight" })).toThrow();
    expect(() => HintsSchema.parse({ measured_rates: { dead_per_day: 1 } })).toThrow();
    expect(() => HintsSchema.parse({ measuredRates: { dead_per_day: 1 } })).toThrow();
  });
});
