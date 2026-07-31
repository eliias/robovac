import { describe, expect, it } from "vitest";
import { runCost, threshold } from "./model";
import { optimize, roundHuman, type SnapshotStats } from "./optimize";
import { SETTINGS, defaultValues } from "./settings";
import { DEMO_SNAPSHOT } from "./fixtures";

const { proposed: _drop, ...demoStats } = DEMO_SNAPSHOT;

function stats(overrides: Partial<SnapshotStats>): SnapshotStats {
  return {
    v: 1,
    db: "test",
    table: "public.t",
    capturedAt: "2026-07-30T12:00:00Z",
    live: 1_000_000,
    dead: 10_000,
    pages: 100_000,
    deadPerDay: 100_000,
    xidAge: 50_000_000,
    xidPerDay: 5_000_000,
    lastAutovacuum: "2026-07-25T12:00:00Z",
    indexes: 3,
    current: defaultValues(),
    insPerDay: 0,
    rateConfidence: "high",
    versionNum: 160000,
    ...overrides,
  };
}

function expectInRange(values: Record<string, number>) {
  for (const d of SETTINGS) {
    const v = values[d.key];
    if (v === 0 && d.zeroOk) continue;
    expect(v, d.key).toBeGreaterThanOrEqual(d.min);
    expect(v, d.key).toBeLessThanOrEqual(d.max);
  }
}

describe("roundHuman", () => {
  it("rounds to 1/2/5 steps", () => {
    expect(roundHuman(13889)).toBe(10000);
    expect(roundHuman(151560)).toBe(200000);
    expect(roundHuman(852_000_000)).toBe(1_000_000_000);
    expect(roundHuman(0)).toBe(0);
  });
});

describe("classify + solve: patterns", () => {
  it("demo table is large-update-heavy with a one-hour cadence", () => {
    const r = optimize(demoStats);
    expect(r.pattern.name).toBe("large-update-heavy");
    expect(r.values.autovacuum_vacuum_scale_factor).toBe(0);
    const cadenceHours = (threshold(r.values, demoStats.live) / demoStats.deadPerDay) * 24;
    expect(cadenceHours).toBeGreaterThan(0.5);
    expect(cadenceHours).toBeLessThan(3);
    expectInRange(r.values);
  });

  it("demo table gets the emergency warnings (age past freeze_max_age)", () => {
    const r = optimize(demoStats);
    expect(r.warnings.join(" ")).toMatch(/anti-wraparound/);
  });

  it("queue tables get minute-cadence static thresholds and static analyze", () => {
    const r = optimize(
      stats({
        live: 200_000,
        dead: 50_000,
        pages: 20_000,
        deadPerDay: 2_000_000,
        xidPerDay: 5_000_000,
        lastAutovacuum: null,
      }),
    );
    expect(r.pattern.name).toBe("queue");
    expect(r.values.autovacuum_vacuum_threshold).toBeLessThanOrEqual(20_000);
    expect(r.values.autovacuum_analyze_scale_factor).toBe(0);
    const cadenceMinutes = (threshold(r.values, 200_000) / 2_000_000) * 1440;
    expect(cadenceMinutes).toBeLessThan(30);
    expectInRange(r.values);
  });

  it("append-only tables get an insert threshold and early freezing", () => {
    const r = optimize(
      stats({
        live: 50_000_000,
        dead: 1000,
        pages: 1_000_000,
        deadPerDay: 1000,
        insPerDay: 20_000_000,
        xidPerDay: 30_000_000,
        xidAge: 60_000_000,
      }),
    );
    expect(r.pattern.name).toBe("append-only");
    expect(r.values.autovacuum_vacuum_insert_scale_factor).toBe(0);
    const insCadenceHours = (r.values.autovacuum_vacuum_insert_threshold / 20_000_000) * 24;
    expect(insCadenceHours).toBeGreaterThan(0.3);
    expect(insCadenceHours).toBeLessThan(3);
    expect(r.values.vacuum_freeze_min_age).toBeLessThanOrEqual(10_000_000);
    expectInRange(r.values);
  });

  it("cold tables keep their triggers", () => {
    const cur = defaultValues();
    const r = optimize(
      stats({
        live: 100_000_000,
        dead: 100,
        deadPerDay: 100,
        insPerDay: 100,
        xidPerDay: 20_000_000,
        xidAge: 150_000_000,
        lastAutovacuum: null,
      }),
    );
    expect(r.pattern.name).toBe("cold");
    expect(r.values.autovacuum_vacuum_threshold).toBe(cur.autovacuum_vacuum_threshold);
    expect(r.values.autovacuum_vacuum_scale_factor).toBe(cur.autovacuum_vacuum_scale_factor);
  });

  it("a pattern hint overrides the classifier", () => {
    const r = optimize(stats({ hints: { pattern: "queue" } }));
    expect(r.pattern.name).toBe("queue");
    expect(r.pattern.evidence[0]).toMatch(/hint/);
  });

  it("skips insert knobs on Postgres 12", () => {
    const r = optimize(
      stats({ versionNum: 120010, insPerDay: 5_000_000, live: 50_000_000, deadPerDay: 200_000 }),
    );
    expect(r.values.autovacuum_vacuum_insert_threshold).toBe(
      defaultValues().autovacuum_vacuum_insert_threshold,
    );
    expect(r.warnings.join(" ")).toMatch(/13\+/);
  });
});

describe("freeze chain", () => {
  it("caps freeze_max_age at 400M without flat-age evidence", () => {
    const r = optimize(stats({ xidPerDay: 50_000_000, xidAge: 180_000_000 }));
    expect(r.values.autovacuum_freeze_max_age).toBeLessThanOrEqual(400_000_000);
    expect(r.warnings.join(" ")).toMatch(/400M/);
  });

  it("allows a higher freeze_max_age with flat-age evidence", () => {
    const r = optimize(
      stats({ xidPerDay: 50_000_000, xidAge: 40_000_000, rateConfidence: "high" }),
    );
    expect(r.values.autovacuum_freeze_max_age).toBeGreaterThan(400_000_000);
  });

  it("keeps the freeze chain ordered after all gates (the 4M-reloption table)", () => {
    // Shipped wrong once: low-confidence damping pulled freeze_max down
    // after table_age was derived, so table_age (200M) > freeze_max (100M).
    const r = optimize(
      stats({
        live: 1_177_625,
        dead: 3_954,
        pages: 30_372,
        deadPerDay: 0,
        insPerDay: 0,
        xidAge: 25_229,
        xidPerDay: 1_000,
        rateConfidence: "low",
        current: { ...defaultValues(), autovacuum_freeze_max_age: 4_000_000 },
      }),
    );
    expect(r.values.vacuum_freeze_table_age).toBeLessThanOrEqual(
      0.75 * r.values.autovacuum_freeze_max_age,
    );
  });

  it("derives table_age as exactly 75% of freeze_max, not rounded up to 100%", () => {
    const r = optimize(stats({}));
    expect(r.values.vacuum_freeze_table_age).toBe(0.75 * r.values.autovacuum_freeze_max_age);
  });

  it("never proposes multixact_freeze_max_age below the Postgres default", () => {
    const r = optimize(stats({}));
    expect(r.values.autovacuum_multixact_freeze_max_age).toBeGreaterThanOrEqual(400_000_000);
  });

  it("keeps freeze_table_age under freeze_max_age", () => {
    const r = optimize(demoStats);
    expect(r.values.vacuum_freeze_table_age).toBeLessThan(r.values.autovacuum_freeze_max_age);
  });

  it("does not touch multixact when fkHeavy, and warns about member space", () => {
    const r = optimize(stats({ hints: { fkHeavy: true } }));
    expect(r.values.autovacuum_multixact_freeze_max_age).toBe(
      defaultValues().autovacuum_multixact_freeze_max_age,
    );
    expect(r.warnings.join(" ")).toMatch(/member/);
  });
});

describe("cost budget", () => {
  it("skips the lag throttle when a pass is under 1 GB", () => {
    // 200 MB queue table: a pass this small cannot lag a replica, so the
    // tight budget must not stretch it with a raised cost delay.
    const r = optimize(
      stats({
        live: 100_000,
        dead: 50_000,
        pages: 25_600,
        deadPerDay: 2_000_000,
        insPerDay: 2_000_000,
        modPerDay: 4_000_000,
      }),
    );
    expect(r.values.autovacuum_vacuum_cost_delay).toBe(2);
  });

  it("shrinks the pass by the all-visible fraction, clearing the overload warning", () => {
    const huge = {
      live: 2_000_000_000,
      dead: 50_000_000,
      pages: 262_144_000,
      deadPerDay: 20_000_000,
      insPerDay: 5_000_000,
      modPerDay: 25_000_000,
    };
    const cold = optimize(stats({ ...huge, allVisiblePages: 254_000_000, indexes: 0 }));
    expect(cold.warnings.join(" ")).not.toMatch(/cannot keep up|not reachable/);
    const hot = optimize(stats(huge));
    expect(hot.warnings.join(" ")).toMatch(/cannot keep up|not reachable/);
  });

  it("meters the pass with delay when even the smallest limit bursts past a tight budget", () => {
    const r = optimize(
      stats({
        live: 400_000_000,
        pages: 1_700_000,
        deadPerDay: 3_000_000,
        hints: { replicationLagBudget: "tight" },
      }),
    );
    const c = runCost(r.values, 1_700_000);
    expect(c.mbps).toBeLessThanOrEqual(41);
  });

  it("unthrottles further under a relaxed budget", () => {
    const tight = optimize(
      stats({
        live: 400_000_000,
        pages: 1_700_000,
        deadPerDay: 3_000_000,
        hints: { replicationLagBudget: "tight" },
      }),
    );
    const relaxed = optimize(
      stats({
        live: 400_000_000,
        pages: 1_700_000,
        deadPerDay: 3_000_000,
        hints: { replicationLagBudget: "none" },
      }),
    );
    expect(runCost(relaxed.values, 1_700_000).seconds).toBeLessThanOrEqual(
      runCost(tight.values, 1_700_000).seconds,
    );
  });
});

describe("overload warnings", () => {
  it("warns when a pass cannot finish inside the cadence on the delay-metered path", () => {
    // 2 TB, 20M dead rows/day, tight budget: one pass takes ~15 h against a
    // 6 h cadence. The delay-metered branch used to stay silent.
    const r = optimize(
      stats({
        live: 2_000_000_000,
        dead: 50_000_000,
        pages: 262_144_000,
        deadPerDay: 20_000_000,
        insPerDay: 5_000_000,
        modPerDay: 25_000_000,
      }),
    );
    expect(r.warnings.join(" ")).toMatch(/cannot keep up|not reachable/);
  });
});

describe("PROVE gates", () => {
  it("never raises peak dead rows more than 10%", () => {
    const cases = [demoStats, stats({}), stats({ live: 500, dead: 5, deadPerDay: 50, pages: 100 })];
    for (const s of cases) {
      const r = optimize(s);
      expect(threshold(r.values, s.live)).toBeLessThanOrEqual(
        threshold(s.current, s.live) * 1.1 + 1,
      );
    }
  });

  it("clamps every knob to 10x from current on low confidence", () => {
    const r = optimize({ ...demoStats, rateConfidence: "low" });
    for (const d of SETTINGS) {
      const cur = demoStats.current[d.key];
      if (cur <= 0) continue;
      expect(r.values[d.key], d.key).toBeGreaterThanOrEqual(cur / 10 - 1e-9);
      expect(r.values[d.key], d.key).toBeLessThanOrEqual(cur * 10 + 1e-9);
    }
  });

  it("gives every changed setting a reason", () => {
    const r = optimize(demoStats);
    for (const d of SETTINGS) {
      if (r.values[d.key] !== demoStats.current[d.key]) {
        expect(r.reasons[d.key], d.key).toBeTruthy();
      }
    }
  });
});

describe("horizon-blocked overlay", () => {
  it("does not diagnose a pinned horizon on a tiny table", () => {
    // 6 dead of 40 live is a 15% ratio, but 6 rows is noise, not a horizon.
    const r = optimize(
      stats({
        live: 40,
        dead: 6,
        pages: 1,
        deadPerDay: 0,
        insPerDay: 0,
        lastAutovacuum: "2026-07-30T08:00:00Z",
        capturedAt: "2026-07-30T12:00:00Z",
      }),
    );
    expect(r.diagnosis).toBeUndefined();
  });

  it("returns a diagnosis and keeps every setting", () => {
    const r = optimize(
      stats({
        live: 1_000_000,
        dead: 200_000,
        deadPerDay: 1_000_000,
        lastAutovacuum: "2026-07-30T11:00:00Z",
        capturedAt: "2026-07-30T12:00:00Z",
      }),
    );
    expect(r.diagnosis).toMatch(/xmin horizon/);
    expect(r.values).toEqual(defaultValues());
    expect(Object.keys(r.reasons)).toHaveLength(0);
  });
});

describe("companions", () => {
  it("emits a toast block when the table has TOAST", () => {
    const r = optimize({ ...demoStats, hasToast: true });
    expect(r.companions.toastSql).toMatch(/toast\.autovacuum_vacuum_threshold = 10000/);
  });

  it("suggests fillfactor when HOT fraction is low on update-heavy tables", () => {
    const r = optimize({ ...demoStats, hotFraction: 0.2 });
    expect(r.companions.fillfactorNote).toMatch(/fillfactor/);
  });

  it("derives cluster advice from RAM", () => {
    const r = optimize(stats({ hints: { ramBytes: 64 * 2 ** 30, maxWorkers: 3 } }));
    expect(r.companions.clusterAdvice.join(" ")).toMatch(/maintenance_work_mem/);
    expect(r.companions.clusterAdvice.join(" ")).toMatch(/workers/);
  });
});
