import { describe, expect, it } from "vitest";
import { CANDIDATES_QUERY, SETTINGS_QUERY, SNAPSHOT_QUERY } from "./queries";

const WRITE_KEYWORDS =
  /\b(INSERT|UPDATE\s+\w+\s+SET|DELETE\s+FROM|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE)\b/i;

describe("mcp queries", () => {
  it("issue no writes", () => {
    for (const q of [SNAPSHOT_QUERY, SETTINGS_QUERY, CANDIDATES_QUERY]) {
      expect(q).not.toMatch(WRITE_KEYWORDS);
      expect(q.trim().toUpperCase().startsWith("SELECT")).toBe(true);
    }
  });

  it("selects what the snapshot schema needs", () => {
    for (const col of [
      "n_live_tup",
      "n_dead_tup",
      "n_tup_upd",
      "n_tup_hot_upd",
      "n_tup_del",
      "relpages",
      "xid_age",
      "reloptions",
      "last_autovacuum",
      "index_count",
      "xid_now",
      "n_mod_since_analyze",
      "mxid_age",
      "is_partition",
      "has_toast",
      "version_num",
    ]) {
      expect(SNAPSHOT_QUERY).toContain(col);
    }
  });

  it("ranks candidates by dead ratio plus xid age", () => {
    expect(CANDIDATES_QUERY).toContain("GREATEST(s.n_live_tup, 1)");
    expect(CANDIDATES_QUERY).toContain("2147483647");
  });
});
