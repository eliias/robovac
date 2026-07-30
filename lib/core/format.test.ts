import { describe, expect, it } from "vitest";
import { fmtCompact, fmtDur, fmtInt, fmtSecs, fmtVal, fromPos, toPos } from "./format";
import { SETTINGS } from "./settings";
import { DEMO_SNAPSHOT } from "./fixtures";
import { SnapshotSchema } from "./snapshot";

const byKey = (key: string) => {
  const d = SETTINGS.find((s) => s.key === key);
  if (!d) throw new Error(key);
  return d;
};

describe("formatters", () => {
  it("formats integers with en-US thousands separators", () => {
    expect(fmtInt(82467830.2)).toBe("82,467,830");
  });

  it("formats compact values", () => {
    expect(fmtCompact(82467830)).toBe("82.47 M");
    expect(fmtCompact(2147483647)).toBe("2.15 B");
    expect(fmtCompact(1500)).toBe("1.5 k");
    expect(fmtCompact(999)).toBe("999");
  });

  it("formats durations", () => {
    expect(fmtDur(22.7)).toBe("22.7 d");
    expect(fmtDur(0.5708)).toBe("13.7 h");
    expect(fmtDur(0.01)).toBe("14 min");
  });

  it("formats seconds", () => {
    expect(fmtSecs(1226.7)).toBe("20 min");
    expect(fmtSecs(7200)).toBe("2.0 h");
    expect(fmtSecs(42)).toBe("42 s");
  });

  it("formats fractions with 3 or 4 decimals", () => {
    expect(fmtVal({ fmt: "frac" }, 0.2)).toBe("0.200");
    expect(fmtVal({ fmt: "frac" }, 0.005)).toBe("0.0050");
  });
});

describe("slider position mapping", () => {
  it("snaps log settings to round values", () => {
    const d = byKey("autovacuum_freeze_max_age");
    const v = fromPos(d, 0.5);
    expect(v % 1e6).toBe(0);
    expect(v).toBeGreaterThanOrEqual(d.min);
    expect(v).toBeLessThanOrEqual(d.max);
  });

  it("snaps frac settings to 2 significant digits", () => {
    const d = byKey("autovacuum_vacuum_scale_factor");
    const v = fromPos(d, 0.37);
    expect(Number(v.toPrecision(2))).toBe(v);
  });

  it("rounds linear settings to their step", () => {
    const d = byKey("autovacuum_vacuum_threshold");
    expect(fromPos(d, 0.5001) % 50).toBe(0);
  });

  it("round-trips within one snap step", () => {
    for (const d of SETTINGS) {
      const v = fromPos(d, 0.42);
      const back = fromPos(d, toPos(d, v));
      expect(back).toBe(v);
    }
  });

  it("clamps outside positions", () => {
    const d = byKey("autovacuum_vacuum_cost_delay");
    expect(fromPos(d, -1)).toBe(d.min);
    expect(fromPos(d, 2)).toBe(d.max);
  });
});

describe("snapshot schema", () => {
  it("accepts the demo snapshot", () => {
    expect(SnapshotSchema.parse(DEMO_SNAPSHOT)).toEqual(DEMO_SNAPSHOT);
  });

  it("rejects negative counts", () => {
    expect(() => SnapshotSchema.parse({ ...DEMO_SNAPSHOT, live: -1 })).toThrow();
  });

  it("rejects a settings map with a missing key", () => {
    const { autovacuum_vacuum_threshold: _omit, ...rest } = DEMO_SNAPSHOT.current;
    expect(() => SnapshotSchema.parse({ ...DEMO_SNAPSHOT, current: rest })).toThrow(
      /missing setting/,
    );
  });

  it("rejects out-of-range settings", () => {
    const current = { ...DEMO_SNAPSHOT.current, autovacuum_vacuum_cost_delay: 500 };
    expect(() => SnapshotSchema.parse({ ...DEMO_SNAPSHOT, current })).toThrow(/outside/);
  });
});
