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
});
