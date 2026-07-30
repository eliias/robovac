import { describe, expect, it } from "vitest";
import { CodecError, decodeReport, encodeReport } from "./codec";
import { DEMO_SNAPSHOT } from "./fixtures";

describe("codec", () => {
  it("round-trips the demo snapshot", () => {
    expect(decodeReport(encodeReport({ snap: DEMO_SNAPSHOT }))).toEqual({ snap: DEMO_SNAPSHOT });
  });

  it("round-trips tuned values", () => {
    const payload = { snap: DEMO_SNAPSHOT, tuned: { autovacuum_vacuum_cost_delay: 5 } };
    expect(decodeReport("#" + encodeReport(payload))).toEqual(payload);
  });

  it("drops an empty tuned object", () => {
    expect(decodeReport(encodeReport({ snap: DEMO_SNAPSHOT, tuned: {} }))).toEqual({
      snap: DEMO_SNAPSHOT,
    });
  });

  it("keeps the demo link short", () => {
    expect(encodeReport({ snap: DEMO_SNAPSHOT }).length).toBeLessThan(1500);
  });

  it("rejects garbage", () => {
    expect(() => decodeReport("1.garbage")).toThrow(CodecError);
    try {
      decodeReport("1.garbage");
    } catch (e) {
      expect((e as CodecError).issues.length).toBeGreaterThan(0);
    }
  });

  it("rejects an unknown version", () => {
    expect(() => decodeReport("9.abc")).toThrow(/unknown codec version/);
  });

  it("rejects a truncated link", () => {
    const full = encodeReport({ snap: DEMO_SNAPSHOT });
    expect(() => decodeReport(full.slice(0, full.length - 20))).toThrow(CodecError);
  });

  it("rejects out-of-range tuned values", () => {
    const payload = { snap: DEMO_SNAPSHOT, tuned: { autovacuum_vacuum_cost_delay: 5000 } };
    expect(() => decodeReport(encodeReport(payload))).toThrow(/outside/);
  });

  it("round-trips randomly perturbed snapshots", () => {
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < 200; i++) {
      const snap = {
        ...DEMO_SNAPSHOT,
        live: Math.floor(rand() * 1e9) + 1,
        dead: Math.floor(rand() * 1e7),
        pages: Math.floor(rand() * 1e7) + 1,
        deadPerDay: Math.floor(rand() * 1e7),
        xidAge: Math.floor(rand() * 2e9),
        xidPerDay: Math.floor(rand() * 1e8) + 1,
        table: `t_${i}.rows`,
      };
      expect(decodeReport(encodeReport({ snap }))).toEqual({ snap });
    }
  });
});
