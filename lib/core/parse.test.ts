import { describe, expect, it } from "vitest";
import { ParseError, parseSnapshotPaste } from "./parse";

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
