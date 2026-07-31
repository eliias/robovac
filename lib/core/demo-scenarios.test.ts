import { describe, expect, it } from "vitest";
import { decodeReport, encodeReport } from "./codec";
import { demoScenarios } from "./demo-scenarios";
import { optimize } from "./optimize";
import { SETTINGS } from "./settings";

const NOW = Date.parse("2026-07-31T12:00:00Z");
const scenarios = demoScenarios(NOW);
const byKey = (k: string) => scenarios.find((s) => s.key === k)!;

describe("demo scenarios", () => {
  it("has the five shapes and every payload round-trips", () => {
    expect(scenarios).toHaveLength(5);
    for (const s of scenarios) {
      expect(decodeReport(encodeReport({ snap: s.snap })).snap).toEqual(s.snap);
      expect(s.snap.demo).toBe(true);
    }
  });

  it("job_queue and invoices propose nothing", () => {
    for (const k of ["job_queue", "invoices"]) {
      const snap = byKey(k).snap;
      const pending = SETTINGS.filter((d) => snap.proposed[d.key] !== snap.current[d.key]);
      expect(pending, k).toHaveLength(0);
    }
  });

  it("job_queue reads as a pinned horizon, sessions does not", () => {
    expect(optimize(byKey("job_queue").snap).diagnosis).toMatch(/xmin horizon/);
    const sessions = optimize(byKey("sessions").snap);
    expect(sessions.diagnosis).toBeUndefined();
    expect(sessions.companions.fillfactorNote).toMatch(/fillfactor/);
  });

  it("page_views is a wraparound emergency with an unchanged dead-side trigger", () => {
    const snap = byKey("page_views").snap;
    expect(optimize(snap).warnings.join(" ")).toMatch(/shutdown/i);
    expect(snap.lastAutovacuum).toBeNull();
    expect(snap.proposed.autovacuum_vacuum_scale_factor).toBe(
      snap.current.autovacuum_vacuum_scale_factor,
    );
    expect(snap.proposed.autovacuum_vacuum_insert_scale_factor).toBe(0.02);
  });

  it("sessions changes exactly the two settings its proposal names", () => {
    const snap = byKey("sessions").snap;
    const changed = SETTINGS.filter((d) => snap.proposed[d.key] !== snap.current[d.key]).map(
      (d) => d.key,
    );
    expect(changed.toSorted()).toEqual([
      "autovacuum_vacuum_cost_limit",
      "autovacuum_vacuum_scale_factor",
    ]);
  });
});
