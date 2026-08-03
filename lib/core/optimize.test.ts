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

  it("keeps analyze settings on stable tables", () => {
    // Analyze re-samples the same fixed number of rows each run; on a
    // stable distribution more runs buy nothing and re-roll plans.
    const r = optimize(demoStats);
    expect(r.values.autovacuum_analyze_scale_factor).toBe(
      demoStats.current.autovacuum_analyze_scale_factor,
    );
    expect(r.values.autovacuum_analyze_threshold).toBe(
      demoStats.current.autovacuum_analyze_threshold,
    );
  });

  it("partitions get the static analyze trigger", () => {
    const r = optimize(stats({ isPartition: true }));
    expect(r.values.autovacuum_analyze_scale_factor).toBe(0);
  });

  it("keeps freeze_min_age under one vacuum interval in xids", () => {
    // A cutoff past the interval leaves pages all-visible but unfrozen;
    // only the aggressive vacuum would ever freeze them.
    const r = optimize(stats({ xidPerDay: 50_000_000 }));
    const cadenceDays = threshold(r.values, 1_000_000) / 100_000;
    expect(r.values.vacuum_freeze_min_age).toBeLessThanOrEqual(cadenceDays * 50_000_000);
  });

  it("diagnoses a lowered freeze_max_age as a forced-vacuum loop", () => {
    // Seen in the wild: someone lowers this reloption to freeze sooner, but
    // it is the deadline knob. 4M sits under the ordinary xmin-horizon age,
    // so the table never gets back under it and the forced vacuum re-fires
    // every naptime, forever.
    const r = optimize(
      stats({
        xidAge: 25_000_000,
        current: { ...defaultValues(), autovacuum_freeze_max_age: 4_000_000 },
      }),
    );
    expect(r.warnings.join(" ")).toMatch(/every naptime/);
    expect(r.values.autovacuum_freeze_max_age).toBeGreaterThanOrEqual(200_000_000);
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
  it("never raises freeze_max_age above the default", () => {
    // freeze_table_age escalation advances relfrozenxid on a table that
    // vacuums normally, so the forced scan never fires and raising its
    // deadline only shrinks the backstop. Whatever the xid rate.
    for (const xidPerDay of [1_000_000, 50_000_000, 400_000_000]) {
      const r = optimize(stats({ xidPerDay, xidAge: 40_000_000 }));
      expect(r.values.autovacuum_freeze_max_age, `${xidPerDay}/day`).toBeLessThanOrEqual(
        defaultValues().autovacuum_freeze_max_age,
      );
    }
  });

  it("does not move freeze_max_age when it is already at or above the default", () => {
    const r = optimize(stats({ xidPerDay: 50_000_000, xidAge: 180_000_000 }));
    expect(r.values.autovacuum_freeze_max_age).toBe(defaultValues().autovacuum_freeze_max_age);
    expect(r.reasons.autovacuum_freeze_max_age).toBeUndefined();
  });

  it("proposes the same freeze_max_age whatever the current value is", () => {
    // Two clusters, same table, ages a few million xids apart, used to get
    // 400M and 1B because the old gate keyed off the current reloption.
    const a = optimize(stats({ xidAge: 61_000_000, xidPerDay: 23_600_000 }));
    const b = optimize(
      stats({
        xidAge: 66_500_000,
        xidPerDay: 23_600_000,
        current: { ...defaultValues(), autovacuum_freeze_max_age: 4_000_000 },
      }),
    );
    expect(b.values.autovacuum_freeze_max_age).toBe(a.values.autovacuum_freeze_max_age);
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
    // 30x the trigger threshold in dead rows, vacuumed an hour ago:
    // removal is blocked, not lagging.
    const r = optimize(
      stats({
        live: 1_000_000,
        dead: 6_000_000,
        deadPerDay: 1_000_000,
        lastAutovacuum: "2026-07-30T11:00:00Z",
        capturedAt: "2026-07-30T12:00:00Z",
      }),
    );
    expect(r.diagnosis).toMatch(/xmin horizon/);
    expect(r.values).toEqual(defaultValues());
    expect(Object.keys(r.reasons)).toHaveLength(0);
  });

  it("does not diagnose a high-churn table that holds a few cadences of dead rows", () => {
    // 33% dead on a churner vacuumed minutes ago reads as bloat (think
    // fillfactor), not as a pinned horizon: it holds ~10 thresholds, not 25+.
    const r = optimize(
      stats({
        live: 18_402_211,
        dead: 9_104_118,
        pages: 1_180_000,
        deadPerDay: 41_220_000,
        insPerDay: 6_000_000,
        current: { ...defaultValues(), autovacuum_vacuum_scale_factor: 0.05 },
        lastAutovacuum: "2026-07-30T11:49:00Z",
        capturedAt: "2026-07-30T12:00:00Z",
      }),
    );
    expect(r.diagnosis).toBeUndefined();
  });
});

describe("proposal checks", () => {
  it("warns when the trigger sits near the not-removable floor", () => {
    // 1M dead/day against a horizon 4 days old is a 4M-row floor. Any
    // threshold near it re-triggers every naptime and clears nothing.
    const r = optimize(
      stats({
        live: 100_000_000,
        deadPerDay: 1_000_000,
        xidPerDay: 10_000_000,
        horizonXids: 40_000_000,
      }),
    );
    expect(r.warnings.join(" ")).toMatch(/not-removable floor/);
  });

  it("stays quiet when the horizon is short", () => {
    const r = optimize(
      stats({ deadPerDay: 1_000_000, xidPerDay: 10_000_000, horizonXids: 17_000 }),
    );
    expect(r.warnings.join(" ")).not.toMatch(/not-removable floor/);
  });

  it("warns that a short sample cannot carry the thresholds", () => {
    const r = optimize(stats({ sampleSeconds: 60 }));
    expect(r.warnings.join(" ")).toMatch(/60 second sample/);
  });

  it("drops that warning once real rates are supplied", () => {
    const r = optimize(
      stats({ sampleSeconds: 60, hints: { measuredRates: { deadPerDay: 951_000 } } }),
    );
    expect(r.warnings.join(" ")).not.toMatch(/second sample/);
  });

  it("cross-checks the modelled dead rate against what n_dead_tup did", () => {
    // The modelled rate excludes HOT updates. When the counter disagrees by
    // this much, that exclusion is wrong for this table.
    const r = optimize(stats({ deadPerDay: 100_000, observedDeadPerDay: 900_000 }));
    expect(r.warnings.join(" ")).toMatch(/HOT updates excluded/);
  });

  it("catches a freeze_max_age at or above the failsafe", () => {
    const r = optimize(
      stats({
        current: { ...defaultValues(), autovacuum_freeze_max_age: 1_500_000_000 },
        failsafeAge: 1_200_000_000,
      }),
    );
    expect(r.warnings.join(" ")).toMatch(/failsafe fires first/);
  });
});

describe("freeze chain derivation", () => {
  it("lands freeze_table_age on the default once freeze_max_age is the default", () => {
    // The two knobs move in one edit and one is derived from the other, so
    // a hardcoded table_age would smuggle back the rarer, larger passes.
    const r = optimize(
      stats({ current: { ...defaultValues(), autovacuum_freeze_max_age: 4_000_000 } }),
    );
    expect(r.values.autovacuum_freeze_max_age).toBe(200_000_000);
    expect(r.values.vacuum_freeze_table_age).toBe(150_000_000);
    expect(r.values.vacuum_freeze_table_age).toBe(0.75 * r.values.autovacuum_freeze_max_age);
  });
});

describe("platform capability", () => {
  it("softens the cost advice when a controller already meters vacuum", () => {
    const r = optimize(stats({ adaptiveVacuum: true, hints: { ramBytes: 64 * 2 ** 30 } }));
    expect(r.companions.clusterAdvice.join(" ")).toMatch(/adaptive autovacuum controller/);
  });

  it("says nothing on a server without one", () => {
    const r = optimize(stats({ hints: { ramBytes: 64 * 2 ** 30 } }));
    expect(r.companions.clusterAdvice.join(" ")).not.toMatch(/adaptive/);
  });
});

describe("trigger row count", () => {
  it("uses pg_class.reltuples, the count autovacuum multiplies", () => {
    // n_live_tup is a statistics estimate and drifts. Autovacuum reads
    // reltuples, so a report built on n_live_tup states the wrong trigger.
    const s = stats({ live: 222_325_079, relTuples: 889_315_840, deadPerDay: 400_000 });
    const r = optimize(s);
    expect(threshold(r.values, 889_315_840)).toBeGreaterThan(0);
    expect(r.warnings.join(" ")).toMatch(/reltuples/);
    expect(r.warnings.join(" ")).toMatch(/4\.0x/);
  });

  it("falls back to n_live_tup when reltuples is unknown", () => {
    // Postgres 14+ reports -1 for a relation it has never vacuumed.
    const unknown = optimize(stats({ relTuples: -1 }));
    const absent = optimize(stats({}));
    expect(unknown.values).toEqual(absent.values);
    expect(unknown.warnings.join(" ")).not.toMatch(/reltuples/);
  });

  it("says nothing when the two row counts agree", () => {
    const r = optimize(stats({ live: 1_000_000, relTuples: 1_010_000 }));
    expect(r.warnings.join(" ")).not.toMatch(/reltuples/);
  });
});

describe("measured rates", () => {
  it("replace the sampled delta and clear the low-confidence damping", () => {
    const sampled = optimize(stats({ deadPerDay: 283_000, rateConfidence: "low" }));
    const measured = optimize(
      stats({
        deadPerDay: 283_000,
        rateConfidence: "low",
        hints: { measuredRates: { deadPerDay: 951_000 } },
      }),
    );
    expect(measured.reasons.autovacuum_vacuum_threshold).toMatch(/951,000/);
    expect(measured.reasons.autovacuum_vacuum_threshold).not.toMatch(/low-confidence/);
    expect(sampled.values.autovacuum_vacuum_threshold).not.toBe(
      measured.values.autovacuum_vacuum_threshold,
    );
  });
});

describe("transparency", () => {
  it("says when a real wraparound emergency overrides the lag budget", () => {
    // 1.9B of age against a 2.1B wall: the throttle should open.
    const r = optimize(
      stats({
        xidAge: 1_900_000_000,
        xidPerDay: 50_000_000,
        hints: { replicationLagBudget: "tight" },
      }),
    );
    expect(r.warnings.join(" ")).toMatch(/raised from tight to relaxed/);
  });

  it("does not manufacture an emergency from a lowered freeze_max_age", () => {
    // 61M of age with 2.1B of headroom is not danger. Judging it against a
    // bogus 4M reloption declared one, and opened the I/O throttle on
    // exactly the tables this tool exists to find.
    const r = optimize(
      stats({
        xidAge: 60_966_008,
        xidPerDay: 23_600_000,
        current: { ...defaultValues(), autovacuum_freeze_max_age: 4_000_000 },
        hints: { replicationLagBudget: "tight" },
      }),
    );
    expect(r.warnings.join(" ")).not.toMatch(/raised from tight/);
    // The forced vacuum really is running, so that part still gets said.
    expect(r.warnings.join(" ")).toMatch(/deadline knob/);
  });

  it("warns that a replica snapshot measures nothing", () => {
    const r = optimize(stats({ isReplica: true }));
    expect(r.warnings.join(" ")).toMatch(/replica/i);
  });
});

describe("companions", () => {
  it("names the index-bypass regime the proposal lands in", () => {
    const r = optimize(stats({ pages: 1_000_000, indexes: 5, deadPerDay: 100_000 }));
    expect(r.companions.indexBypassNote).toMatch(/2% line/);
  });

  it("lets the 32 MB dead-item limit veto the bypass on its own", () => {
    // Both bypass conditions have to hold. On a huge table left on the
    // default scale factor the trigger is hundreds of millions of rows, far
    // past the item array, however few pages they land on.
    const r = optimize(
      stats({
        live: 4_000_000_000,
        relTuples: 4_000_000_000,
        pages: 500_000_000,
        indexes: 5,
        deadPerDay: 20_000,
        insPerDay: 100,
        lastAutovacuum: null,
      }),
    );
    expect(r.pattern.name).toBe("cold");
    expect(r.companions.indexBypassNote).toMatch(/32 MB/);
  });

  it("reports a long analyze interval without proposing a change", () => {
    const r = optimize(
      stats({ live: 889_000_000, deadPerDay: 400_000, insPerDay: 200_000, modPerDay: 600_000 }),
    );
    expect(r.companions.analyzeNote).toMatch(/Autoanalyze fires every/);
    expect(r.values.autovacuum_analyze_scale_factor).toBe(
      defaultValues().autovacuum_analyze_scale_factor,
    );
  });

  it("caps maintenance_work_mem at 1 GB before Postgres 17", () => {
    const pg16 = optimize(stats({ versionNum: 160011, hints: { ramBytes: 512 * 2 ** 30 } }));
    const pg17 = optimize(stats({ versionNum: 170004, hints: { ramBytes: 512 * 2 ** 30 } }));
    expect(pg16.companions.clusterAdvice.join(" ")).toMatch(/1024 MB/);
    expect(pg17.companions.clusterAdvice.join(" ")).toMatch(/5120 MB/);
  });

  it("emits a toast block that follows the heap threshold", () => {
    const r = optimize({ ...demoStats, hasToast: true });
    expect(r.companions.toastSql).toContain(
      `toast.autovacuum_vacuum_threshold = ${r.values.autovacuum_vacuum_threshold}`,
    );
  });

  it("keeps the toast threshold at 100k when the heap threshold is smaller", () => {
    // The not-removable floor on a busy TOAST table sits far above a small
    // heap threshold; a toast threshold under it loops every naptime.
    const r = optimize(
      stats({
        live: 200_000,
        dead: 50_000,
        pages: 20_000,
        deadPerDay: 2_000_000,
        lastAutovacuum: null,
        hasToast: true,
      }),
    );
    expect(r.values.autovacuum_vacuum_threshold).toBeLessThan(100_000);
    expect(r.companions.toastSql).toMatch(/toast\.autovacuum_vacuum_threshold = 100000/);
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
