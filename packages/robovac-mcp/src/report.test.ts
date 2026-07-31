import { describe, expect, it } from "vitest";
import { buildSnapshot, verdict, type Row } from "./report";

// Rows as a generic SQL tool would return them: numbers as strings, arrays as
// text, jsonb as an object.
function row(overrides: Row = {}): Row {
  return {
    db: "prod",
    schema_name: "public",
    table_name: "events",
    relpages: "100000",
    n_live_tup: "50000000",
    n_dead_tup: "200000",
    n_tup_ins: "1000000",
    n_tup_upd: "5000000",
    n_tup_del: "300000",
    n_tup_hot_upd: "2000000",
    last_autovacuum: "2026-07-30 08:00:00+00",
    n_mod_since_analyze: "40000",
    xid_age: "150000000",
    mxid_age: "9000000",
    index_count: "4",
    reloptions: null,
    is_partition: false,
    has_toast: true,
    version_num: 170004,
    xid_now: "900000000",
    global_settings: { autovacuum_vacuum_scale_factor: "0.2", autovacuum_vacuum_cost_delay: "2" },
    captured_at: "2026-07-30T12:00:00+00:00",
    ...overrides,
  };
}

describe("buildSnapshot", () => {
  it("derives rates from two rows and validates", () => {
    const first = row();
    const second = row({
      captured_at: "2026-07-30T12:01:00+00:00",
      n_tup_upd: "5010000",
      n_tup_hot_upd: "2004000",
      n_tup_del: "301000",
      n_tup_ins: "1002000",
      xid_now: "900050000",
    });
    const snap = buildSnapshot(first, second);
    // 60 s window: (10000 - 4000 + 1000) dead rows -> * 1440 per day
    expect(snap.deadPerDay).toBe(7000 * 1440);
    expect(snap.insPerDay).toBe(2000 * 1440);
    expect(snap.xidPerDay).toBe(50000 * 1440);
    expect(snap.rateConfidence).toBe("high");
    expect(snap.table).toBe("public.events");
    expect(snap.current.autovacuum_vacuum_scale_factor).toBe(0.2);
    expect(snap.proposed.autovacuum_vacuum_scale_factor).toBeDefined();
  });

  it("applies reloptions over globals, also in text-array form", () => {
    const second = row({
      captured_at: "2026-07-30T12:01:00+00:00",
      reloptions: "{autovacuum_vacuum_threshold=5000,autovacuum_vacuum_scale_factor=0}",
    });
    const snap = buildSnapshot(row(), second);
    expect(snap.current.autovacuum_vacuum_threshold).toBe(5000);
    expect(snap.current.autovacuum_vacuum_scale_factor).toBe(0);
  });

  it("marks short samples as low confidence", () => {
    const second = row({ captured_at: "2026-07-30T12:00:05+00:00" });
    expect(buildSnapshot(row(), second).rateConfidence).toBe("low");
  });

  it("records the interval between the two samples", () => {
    const second = row({ captured_at: "2026-07-30T12:00:40+00:00" });
    // Identical counters over a real interval: the rate is a measured zero,
    // not an unknown. The interval is what lets the UI tell them apart.
    const snap = buildSnapshot(row(), second);
    expect(snap.sampleSeconds).toBe(40);
    expect(snap.deadPerDay).toBe(0);
  });

  it("gives a duplicated row a one-second interval", () => {
    const only = row();
    expect(buildSnapshot(only, only).sampleSeconds).toBe(1);
  });

  it("reads relallvisible when present and tolerates its absence", () => {
    const second = row({ captured_at: "2026-07-30T12:01:00+00:00", relallvisible: "95000" });
    expect(buildSnapshot(row(), second).allVisiblePages).toBe(95000);
    const old = row({ captured_at: "2026-07-30T12:01:00+00:00" });
    expect(buildSnapshot(row(), old).allVisiblePages).toBeUndefined();
  });

  it("says no writes, not one sample, for a measured zero rate", () => {
    const second = row({ captured_at: "2026-07-30T12:00:40+00:00" });
    expect(verdict(buildSnapshot(row(), second))).toMatch(/No writes landed in the 40 s/);
  });

  it("fails with a clear error when a column is missing", () => {
    const broken = row();
    delete broken.n_dead_tup;
    expect(() => buildSnapshot(row(), broken)).toThrow(/n_dead_tup/);
  });

  it("fails when captured_at is unparsable", () => {
    expect(() => buildSnapshot(row({ captured_at: "yesterday-ish" }), row())).toThrow(
      /captured_at/,
    );
  });
});

describe("degraded-state detection", () => {
  it("D3: a counter going backwards is flagged, rates zeroed", () => {
    const second = row({
      captured_at: "2026-07-30T12:01:00+00:00",
      n_tup_upd: "118402",
    });
    const snap = buildSnapshot(row({ n_tup_upd: "41882004" }), second);
    expect(snap.countersReset).toEqual({ counter: "n_tup_upd", first: 41882004, second: 118402 });
    expect(snap.deadPerDay).toBe(0);
    expect(verdict(snap)).toMatch(/n_tup_upd fell from 41,882,004 to 118,402/);
  });

  it("D1: a missing second row omits sampleSeconds", () => {
    const snap = buildSnapshot(row());
    expect(snap.sampleSeconds).toBeUndefined();
  });

  it("D6: autovacuum_enabled=false in reloptions sets autovacuumOff", () => {
    const second = row({
      captured_at: "2026-07-30T12:01:00+00:00",
      reloptions: "{autovacuum_enabled=false}",
    });
    expect(buildSnapshot(row(), second).autovacuumOff).toBe(true);
    expect(
      buildSnapshot(row(), row({ captured_at: "2026-07-30T12:01:00+00:00" })).autovacuumOff,
    ).toBeUndefined();
  });

  it("D6: last_vacuum is carried when the column is present", () => {
    const second = row({ captured_at: "2026-07-30T12:01:00+00:00", last_vacuum: null });
    expect(buildSnapshot(row(), second).lastVacuum).toBeNull();
  });
});
