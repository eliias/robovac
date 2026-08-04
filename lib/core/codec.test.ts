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
    expect(() => decodeReport("3.garbage")).toThrow(CodecError);
    try {
      decodeReport("3.garbage");
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

  it("accepts current values outside the tuning range but legal in Postgres", () => {
    // Seen in the wild: a per-table autovacuum_freeze_max_age of 4M.
    // Postgres accepts 100k and up; the tuning slider starts at 100M.
    const snap = {
      ...DEMO_SNAPSHOT,
      current: { ...DEMO_SNAPSHOT.current, autovacuum_freeze_max_age: 4000000 },
    };
    expect(decodeReport(encodeReport({ snap }))).toEqual({ snap });
  });

  it("rejects current values Postgres does not accept", () => {
    const snap = {
      ...DEMO_SNAPSHOT,
      current: { ...DEMO_SNAPSHOT.current, autovacuum_freeze_max_age: 50000 },
    };
    expect(() => decodeReport(encodeReport({ snap }))).toThrow(/outside/);
  });

  it("rejects proposed values outside the tuning range", () => {
    const snap = {
      ...DEMO_SNAPSHOT,
      proposed: { ...DEMO_SNAPSHOT.proposed, autovacuum_freeze_max_age: 4000000 },
    };
    expect(() => decodeReport(encodeReport({ snap }))).toThrow(/outside/);
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

describe("codec error kinds", () => {
  it("B3: an empty fragment has its own kind", () => {
    for (const f of ["", "#"]) {
      try {
        decodeReport(f);
        throw new Error("expected CodecError");
      } catch (e) {
        expect((e as CodecError).kind).toBe("empty");
      }
    }
  });

  it("B1: a truncated link reports received and expected bytes", () => {
    const full = encodeReport({ snap: DEMO_SNAPSHOT });
    const cut = full.slice(0, Math.floor(full.length * 0.45));
    try {
      decodeReport(cut);
      throw new Error("expected CodecError");
    } catch (e) {
      const err = e as CodecError;
      expect(err.kind).toBe("truncated");
      expect(err.received).toBeGreaterThan(0);
      expect(err.expected).toBeGreaterThan(err.received!);
    }
  });

  it("B2: an unknown version has kind version", () => {
    try {
      decodeReport("9.abc");
      throw new Error("expected CodecError");
    } catch (e) {
      expect((e as CodecError).kind).toBe("version");
    }
  });

  it("B4: an out-of-range payload has kind invalid and carries the payload text", () => {
    const snap = { ...DEMO_SNAPSHOT, pages: 0 };
    try {
      decodeReport(encodeReport({ snap: snap as never }));
      throw new Error("expected CodecError");
    } catch (e) {
      const err = e as CodecError;
      expect(err.kind).toBe("invalid");
      expect(err.payloadText).toContain('"pages":0');
    }
  });

  it("B2: a link from an older codec has kind version", () => {
    const [, len, sum, data] = encodeReport({ snap: DEMO_SNAPSHOT }).split(".");
    for (const old of [`1.${data}`, `2.${len}.${data}`, `2.${len}.${sum}.${data}`]) {
      try {
        decodeReport(old);
        throw new Error("expected CodecError");
      } catch (e) {
        expect((e as CodecError).kind).toBe("version");
      }
    }
  });

  it("B5: a changed character reports kind damaged, not invalid", () => {
    // Seen in the wild: an agent re-typed the URL into its reply with one
    // character off. The damage decoded into valid JSON with a mangled
    // hints key and was blamed on the payload builder.
    const full = encodeReport({ snap: DEMO_SNAPSHOT });
    const i = full.length - 40;
    const flipped = full[i] === "A" ? "B" : "A";
    const mutated = full.slice(0, i) + flipped + full.slice(i + 1);
    try {
      decodeReport(mutated);
      throw new Error("expected CodecError");
    } catch (e) {
      expect((e as CodecError).kind).toBe("damaged");
    }
  });

  it("decodes a link with junk glued to the end", () => {
    // Chat clients append punctuation to URLs. The length prefix says
    // where the payload ends and the checksum proves the cut is right.
    const full = encodeReport({ snap: DEMO_SNAPSHOT });
    expect(decodeReport(full + ")")).toEqual({ snap: DEMO_SNAPSHOT });
  });
});
