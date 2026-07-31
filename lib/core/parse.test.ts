import { describe, expect, it } from "vitest";
import { ParseError, classifyPaste, parseSnapshotPaste } from "./parse";

const block = (dead: number) => `
 relname   | n_dead_tup | xid_age
-----------+------------+-----------
 event_log |    ${dead} | 211480336
(1 row)
`;

describe("parseSnapshotPaste", () => {
  it("parses psql aligned output", () => {
    const text = `
 relname   | relpages | n_live_tup | n_dead_tup | xid_age
-----------+----------+------------+------------+-----------
 event_log |  1740000 |  412338901 |    3148772 | 211480336
(1 row)
`;
    const { first, second } = parseSnapshotPaste(text);
    expect(first.relname).toBe("event_log");
    expect(first.relpages).toBe("1740000");
    expect(second).toBeUndefined();
  });

  it("treats two aligned blocks as two samples", () => {
    const { first, second } = parseSnapshotPaste(block(100) + "\n" + block(200));
    expect(first.n_dead_tup).toBe("100");
    expect(second?.n_dead_tup).toBe("200");
  });

  it("parses psql expanded output with record separators", () => {
    const text = `
-[ RECORD 1 ]----+----------
relname          | event_log
n_dead_tup       | 3148772
-[ RECORD 2 ]----+----------
relname          | event_log
n_dead_tup       | 3150000
`;
    const { first, second } = parseSnapshotPaste(text);
    expect(first.n_dead_tup).toBe("3148772");
    expect(second?.n_dead_tup).toBe("3150000");
  });

  it("parses csv with quoted cells", () => {
    const text = `relname,n_dead_tup,reloptions
event_log,3148772,"{autovacuum_vacuum_threshold=5000,autovacuum_vacuum_scale_factor=0}"`;
    const { first } = parseSnapshotPaste(text);
    expect(first.reloptions).toBe(
      "{autovacuum_vacuum_threshold=5000,autovacuum_vacuum_scale_factor=0}",
    );
  });

  it("parses a json object and an array of two", () => {
    expect(parseSnapshotPaste('{"relname":"t","n_dead_tup":1}').first.relname).toBe("t");
    const two = parseSnapshotPaste(
      '[{"relname":"t","n_dead_tup":1},{"relname":"t","n_dead_tup":2}]',
    );
    expect(two.second?.n_dead_tup).toBe(2);
  });

  it("rejects unrecognisable text with a usable message", () => {
    expect(() => parseSnapshotPaste("hello world")).toThrow(ParseError);
    expect(() => parseSnapshotPaste("hello world")).toThrow(/headers included/);
  });
});

const FULL_HEADER =
  "relpages | n_live_tup | n_dead_tup | n_tup_ins | n_tup_upd | n_tup_del | n_tup_hot_upd | xid_age | mxid_age | index_count | reloptions | version_num | xid_now | global_settings | captured_at";
const FULL_ROW = (name: string, dead: number) =>
  `1740000 | 412338901 | ${dead} | 1 | 2 | 3 | 1 | 211480336 | 9 | 4 |  | 170000 | 900000000 | {} | 2026-07-30T12:00:00Z`;
const fullBlock = (rows: [string, number][]) =>
  ` table_name | ${FULL_HEADER}\n------------+${"-".repeat(40)}\n` +
  rows.map(([n, d]) => ` ${n} | ${FULL_ROW(n, d)}`).join("\n") +
  `\n(${rows.length} rows)\n`;

describe("classifyPaste", () => {
  it("P1: prose is unparseable", () => {
    const r = classifyPaste("the events table is bloated i think, vacuum runs");
    expect(r).toEqual({ ok: false, error: { kind: "unparseable" } });
  });

  it("P3: the query itself is recognised before format detection", () => {
    const r = classifyPaste(
      "SELECT\n  current_database() AS db\nFROM pg_stat_user_tables s\nWHERE 1=1",
    );
    expect(r).toEqual({ ok: false, error: { kind: "query" } });
  });

  it("P2: names every missing column in query order", () => {
    const r = classifyPaste(
      "   relname   | n_live_tup | n_dead_tup\n-------------+------------+------------\n event_log   |  412338901 |    3148772",
    );
    if (r.ok) throw new Error("expected error");
    expect(r.error.kind).toBe("missing-columns");
    if (r.error.kind !== "missing-columns") return;
    expect(r.error.columns[0]).toBe("relpages");
    expect(r.error.columns).toContain("xid_age");
    expect(r.error.columns).toContain("global_settings");
    const i = (c: string) => (r.error.kind === "missing-columns" ? r.error.columns.indexOf(c) : -1);
    expect(i("relpages")).toBeLessThan(i("xid_age"));
    expect(i("xid_age")).toBeLessThan(i("global_settings"));
  });

  it("P4: several tables become a ranked choice, not an error", () => {
    const r = classifyPaste(
      fullBlock([
        ["event_log", 3148772],
        ["sessions", 904118],
      ]),
    );
    if (r.ok) throw new Error("expected multiple-tables");
    expect(r.error.kind).toBe("multiple-tables");
    if (r.error.kind !== "multiple-tables") return;
    expect(r.error.tables.map((t) => t.name)).toContain("event_log");
    expect(r.error.tables).toHaveLength(2);
  });

  it("accepts a valid two-sample paste of one table", () => {
    const r = classifyPaste(
      fullBlock([["event_log", 100]]) + "\n" + fullBlock([["event_log", 200]]),
    );
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.second).toBeDefined();
  });
});
