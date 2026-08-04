import { describe, expect, it } from "vitest";
import { candidatesSql, snapshotSql } from "./queries";

const WRITE_KEYWORDS =
  /\b(INSERT|UPDATE\s+\w+\s+SET|DELETE\s+FROM|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE)\b/i;

describe("mcp sql", () => {
  it("issues no writes", () => {
    for (const q of [snapshotSql("public", "events"), candidatesSql(10)]) {
      expect(q).not.toMatch(WRITE_KEYWORDS);
      expect(q.trim().toUpperCase().startsWith("SELECT")).toBe(true);
    }
  });

  it("selects what create_report needs", () => {
    const q = snapshotSql("public", "events");
    for (const col of [
      "n_live_tup",
      "n_dead_tup",
      "n_tup_ins",
      "n_tup_upd",
      "n_tup_hot_upd",
      "n_tup_del",
      "relpages",
      "xid_age",
      "mxid_age",
      "reloptions",
      "last_autovacuum",
      "index_count",
      "xid_now",
      "is_partition",
      "has_toast",
      "reltuples",
      "is_replica",
      "horizon_xids",
      "slot_horizon_xids",
      "adaptive_vacuum",
      "vacuum_failsafe_age",
      "version_num",
      "global_settings",
      "captured_at",
    ]) {
      expect(q).toContain(col);
    }
    expect(q).toContain("'public'");
    expect(q).toContain("'events'");
  });

  it("rejects identifiers that need quoting", () => {
    expect(() => snapshotSql("public", "events; drop table x")).toThrow(/identifier/);
    expect(() => snapshotSql("we'ird", "events")).toThrow(/identifier/);
  });

  it("clamps the candidates limit", () => {
    expect(candidatesSql(500)).toContain("LIMIT 50");
    expect(candidatesSql(0)).toContain("LIMIT 1");
  });

  it("reads the current xid, not the horizon, for the rate", () => {
    // pg_snapshot_xmin is the oldest running transaction. Using it as the
    // clock reports a rate near zero exactly when something pins it.
    const q = snapshotSql("public", "events");
    expect(q).toMatch(/pg_snapshot_xmax\(pg_current_snapshot\(\)\)[^\n]*AS xid_now/);
  });

  it("ranks candidates by pages of work, and can see toast relations", () => {
    const q = candidatesSql(10);
    // pg_stat_user_tables hides toast, which on a wide table is the bigger
    // vacuum consumer of the two.
    expect(q).toContain("pg_stat_all_tables");
    expect(q).toContain("toast_parent");
    // A high dead ratio on a tiny table must not outrank a huge one.
    expect(q).toMatch(/relpages.*DESC/s);
  });
});
