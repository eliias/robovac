import { describe, expect, it } from "vitest";
import { DEMO_SNAPSHOT } from "./fixtures";
import { reading } from "./reading";
import type { Snapshot } from "./snapshot";

const NOW = Date.parse("2026-07-30T09:14:00Z");
const at = (over: Partial<Snapshot>): Snapshot => ({ ...DEMO_SNAPSHOT, ...over });

describe("reading", () => {
  it("a two-sample snapshot has every rate", () => {
    const r = reading(at({ sampleSeconds: 60 }), NOW);
    expect(r.state).toBe("measured");
    expect(r.deadRateUnknown).toBe(false);
    expect(r.xidRateUnknown).toBe(false);
    expect(r.rateUnknownReason).toBeNull();
    expect(r.optimizeDisabled).toBeNull();
  });

  it("a counter reset takes both rates away", () => {
    const r = reading(
      at({ sampleSeconds: 60, countersReset: { counter: "n_tup_upd", first: 9, second: 2 } }),
      NOW,
    );
    expect(r.state).toBe("reset");
    expect(r.deadRateUnknown).toBe(true);
    expect(r.xidRateUnknown).toBe(true);
    expect(r.rateUnknownReason).toBe("counters reset");
  });

  // The two rates fail differently, which is why they are two fields: one
  // statistics read carries no xid rate at all, but a non-zero dead count
  // still says something about dead rows.
  it("a single sample keeps the dead rate only when it read something", () => {
    const withRate = reading(at({ sampleSeconds: undefined }), NOW);
    expect(withRate.xidRateUnknown).toBe(true);
    expect(withRate.deadRateUnknown).toBe(false);

    const withoutRate = reading(at({ sampleSeconds: undefined, deadPerDay: 0 }), NOW);
    expect(withoutRate.deadRateUnknown).toBe(true);
    expect(withoutRate.rateUnknownReason).toBe("needs 2 samples");
  });

  it("a sample under 5 s is noise, and noise disables the proposals", () => {
    const r = reading(at({ sampleSeconds: 2 }), NOW);
    expect(r.state).toBe("noisy");
    expect(r.estimated).toBe(true);
    expect(r.optimizeDisabled).toMatch(/noise/);
  });

  it("noise outranks size when both would disable the proposals", () => {
    const r = reading(at({ sampleSeconds: 2, live: 100, pages: 2 }), NOW);
    expect(r.small).toBe(true);
    expect(r.optimizeDisabled).toMatch(/noise/);
  });

  it("a small table disables the proposals with its own reason", () => {
    const r = reading(at({ sampleSeconds: 60, live: 100, pages: 2 }), NOW);
    expect(r.optimizeDisabled).toBe("no changes recommended for a table this size");
  });

  it("stale is measured against the caller's clock, not the process clock", () => {
    expect(reading(DEMO_SNAPSHOT, NOW).stale).toBe(false);
    expect(reading(DEMO_SNAPSHOT, NOW + 8 * 86_400_000).stale).toBe(true);
    expect(reading(DEMO_SNAPSHOT, NOW + 8 * 86_400_000).ageDays).toBeCloseTo(8, 5);
  });

  it("never vacuumed needs both timestamps missing", () => {
    expect(reading(at({ lastAutovacuum: null, lastVacuum: null }), NOW).neverVacuumed).toBe(true);
    expect(reading(at({ lastAutovacuum: null, lastVacuum: "2026-07-01" }), NOW).neverVacuumed).toBe(
      false,
    );
  });

  it("a measured zero and an unknown zero read differently", () => {
    expect(reading(at({ sampleSeconds: 60 }), NOW).zeroCadence).toBe("never · no writes observed");
    expect(reading(at({ sampleSeconds: undefined }), NOW).zeroCadence).toBe(
      "every unknown · one sample",
    );
  });
});
