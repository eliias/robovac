import { describe, expect, it } from "vitest";
import {
  WRAP,
  daysToAggressive,
  passPages,
  runCost,
  sawPath,
  shutdownMarginDays,
  threshold,
} from "./model";
import { DEMO_SNAPSHOT } from "./fixtures";

const snap = DEMO_SNAPSHOT;

describe("threshold", () => {
  it("matches the trigger formula on the demo snapshot", () => {
    expect(threshold(snap.current, snap.live)).toBeCloseTo(82467830.2, 1);
  });

  it("gives a 22.7 day period for the demo current settings", () => {
    const days = threshold(snap.current, snap.live) / snap.deadPerDay;
    expect(days).toBeCloseTo(22.67, 1);
  });
});

describe("passPages", () => {
  it("skips all-visible pages on the heap side", () => {
    expect(passPages(1000, 900, 0)).toBe(100);
  });

  it("adds 30% of the heap per index", () => {
    expect(passPages(1000, undefined, 3)).toBe(1000 + 0.3 * 3 * 1000);
  });

  it("floors the heap side at one page", () => {
    expect(passPages(1000, 1200, 0)).toBe(1);
  });

  it("treats null indexes as zero", () => {
    expect(passPages(1000, undefined, null)).toBe(1000);
  });
});

describe("runCost", () => {
  it("computes the demo current cost", () => {
    const c = runCost(snap.current, snap.pages);
    expect(c.costUnits).toBeCloseTo(12267000, 0);
    expect(c.seconds).toBeCloseTo(1226.7, 1);
    expect(c.mbps).toBeCloseTo(11.08, 1);
  });

  it("falls back to 4 us per page when delay is 0", () => {
    const c = runCost({ ...snap.current, autovacuum_vacuum_cost_delay: 0 }, snap.pages);
    expect(c.seconds).toBeCloseTo(snap.pages * 0.000004, 3);
  });

  it("floors the duration at 1 second", () => {
    const c = runCost({ ...snap.current, autovacuum_vacuum_cost_delay: 0 }, 100);
    expect(c.seconds).toBe(1);
  });
});

describe("sawPath", () => {
  it("starts at the baseline", () => {
    const d = sawPath(82467830, snap.deadPerDay, 60, 496, 172, 82467830);
    expect(d.startsWith("M 0 172")).toBe(true);
  });

  it("never rises above the frame", () => {
    const d = sawPath(1000000, snap.deadPerDay, 60, 496, 172, 82467830);
    const ys = [...d.matchAll(/L [\d.]+ ([\d.]+)/g)].map((m) => Number(m[1]));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(172);
  });

  it("caps at 500 segments", () => {
    const d = sawPath(1, snap.deadPerDay, 60, 496, 172, 82467830);
    expect((d.match(/ L /g) ?? []).length).toBeLessThanOrEqual(1000);
  });
});

describe("freeze math", () => {
  it("reports the demo table as past the freeze limit", () => {
    expect(
      daysToAggressive(snap.current.autovacuum_freeze_max_age, snap.xidAge, snap.xidPerDay),
    ).toBeLessThan(0);
  });

  it("computes the shutdown margin", () => {
    expect(shutdownMarginDays(snap.xidAge, snap.xidPerDay)).toBeCloseTo(
      (WRAP - snap.xidAge) / snap.xidPerDay,
      5,
    );
    expect(shutdownMarginDays(snap.xidAge, snap.xidPerDay)).toBeCloseTo(136.3, 0);
  });
});
