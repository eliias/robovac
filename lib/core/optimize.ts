import { daysToAggressive, passPages, runCost, shutdownMarginDays, threshold } from "./model";
import { SETTINGS, type Values } from "./settings";
import type { PatternName, Snapshot } from "./snapshot";

export type SnapshotStats = Omit<Snapshot, "proposed">;

export interface PatternVerdict {
  name: PatternName;
  score: number;
  evidence: string[];
}

export interface Companions {
  toastSql?: string;
  clusterAdvice: string[];
  fillfactorNote?: string;
  partitionNote?: string;
}

export interface OptimizeResult {
  values: Values;
  reasons: Record<string, string>;
  warnings: string[];
  pattern: PatternVerdict;
  diagnosis?: string;
  companions: Companions;
}

interface Rates {
  deadPerDay: number;
  insPerDay: number;
  modPerDay: number;
  xidPerDay: number;
  confidence: "high" | "low";
}

const COST_LIMIT_STEPS = [200, 600, 1000, 2000, 4000, 10000];
const LAG_BUDGET_MBPS = { tight: 40, relaxed: 150, none: Infinity } as const;
const DAY_SECONDS = 86400;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function def(key: string) {
  const d = SETTINGS.find((s) => s.key === key);
  if (!d) throw new Error(`unknown setting ${key}`);
  return d;
}

function clampToDef(key: string, v: number): number {
  const d = def(key);
  if (v === 0 && d.zeroOk) return 0;
  return clamp(v, d.min, d.max);
}

/** Round to 1/2/5 × 10^k, the numbers a DBA would type. */
export function roundHuman(n: number): number {
  if (n <= 0) return 0;
  const k = 10 ** Math.floor(Math.log10(n));
  const m = n / k;
  const m2 = m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10;
  return m2 * k;
}

// ---------- SENSE ----------

function sense(snap: SnapshotStats): Rates {
  const insPerDay = snap.insPerDay ?? 0;
  return {
    deadPerDay: snap.deadPerDay,
    insPerDay,
    modPerDay: snap.modPerDay ?? snap.deadPerDay + insPerDay,
    xidPerDay: snap.xidPerDay,
    confidence: snap.rateConfidence ?? "low",
  };
}

// ---------- CLASSIFY ----------

interface Classification {
  verdict: PatternVerdict;
  emergency: boolean;
  horizonBlocked: boolean;
}

function classify(snap: SnapshotStats, rates: Rates): Classification {
  const sizeBytes = snap.pages * 8192;
  const churnPerDay = rates.deadPerDay / Math.max(1, snap.live);
  const insFraction = rates.insPerDay / Math.max(1, rates.insPerDay + rates.deadPerDay);
  const deadRatio = snap.dead / Math.max(1, snap.live);

  const scores: { name: PatternName; score: number; evidence: string[] }[] = [
    {
      name: "append-only",
      score: insFraction > 0.95 && churnPerDay < 0.001 ? 0.9 : 0,
      evidence: [
        `${(insFraction * 100).toFixed(1)}% of writes are inserts`,
        `churn is ${(churnPerDay * 100).toFixed(3)}% of the table per day`,
      ],
    },
    {
      name: "queue",
      score: churnPerDay > 5 && sizeBytes < 1 << 30 ? 0.95 : 0,
      evidence: [
        `the table turns over ${churnPerDay.toFixed(1)}x its live rows per day`,
        `heap is ${(sizeBytes / 1048576).toFixed(0)} MB`,
      ],
    },
    {
      name: "large-update-heavy",
      score: snap.live >= 10_000_000 && rates.deadPerDay >= 100_000 && insFraction < 0.7 ? 0.85 : 0,
      evidence: [
        `${snap.live.toLocaleString("en-US")} live rows`,
        `${Math.round(rates.deadPerDay).toLocaleString("en-US")} dead rows per day`,
      ],
    },
    {
      name: "cold",
      score: rates.deadPerDay < snap.live * 1e-5 && rates.insPerDay < 1000 ? 0.8 : 0,
      evidence: ["write rates are near zero", "only the freeze schedule matters here"],
    },
    {
      name: "mixed-oltp",
      score: 0.3,
      evidence: ["no dominant signature, moderate churn and inserts"],
    },
  ];

  let top = scores.reduce((a, b) => (b.score > a.score ? b : a));
  if (snap.hints?.pattern) {
    const hinted = scores.find((s) => s.name === snap.hints!.pattern);
    if (hinted)
      top = { ...hinted, score: 1, evidence: ["pattern set by hint", ...hinted.evidence] };
  }

  const emergency =
    snap.xidAge > snap.current.autovacuum_freeze_max_age ||
    shutdownMarginDays(snap.xidAge, snap.xidPerDay) < 30;

  // Dead rows pile up although autovacuum ran recently: the xmin horizon is pinned, knobs cannot help.
  const currentPeriodDays =
    rates.deadPerDay > 0 ? threshold(snap.current, snap.live) / rates.deadPerDay : Infinity;
  const recentWindowDays = Math.min(Math.max(2 * currentPeriodDays, 0.5), 2);
  const lastAvDays = snap.lastAutovacuum
    ? (Date.parse(snap.capturedAt) - Date.parse(snap.lastAutovacuum)) / 86_400_000
    : Infinity;
  const horizonBlocked = deadRatio > 0.1 && lastAvDays < recentWindowDays;

  return {
    verdict: { name: top.name, score: top.score, evidence: top.evidence },
    emergency,
    horizonBlocked,
  };
}

// ---------- SOLVE ----------

const CADENCE_DAYS: Record<PatternName, number> = {
  queue: 10 / 1440,
  "append-only": 1 / 24,
  "large-update-heavy": 1 / 24,
  "mixed-oltp": 3 / 24,
  cold: Infinity,
};

function supportsInsertTrigger(snap: SnapshotStats): boolean {
  return (snap.versionNum ?? 999999) >= 130000;
}

function solve(
  snap: SnapshotStats,
  rates: Rates,
  cls: Classification,
  warnings: string[],
): { values: Values; reasons: Record<string, string>; cadenceDays: number } {
  const values: Values = { ...snap.current };
  const reasons: Record<string, string> = {};
  const pattern = cls.verdict.name;
  const tv = CADENCE_DAYS[pattern];

  // Triggers (dead-row side).
  let cadenceDays = tv;
  if (pattern !== "cold" && rates.deadPerDay > 0) {
    const wanted = clamp(roundHuman(rates.deadPerDay * tv), 500, 0.25 * Math.max(2000, snap.live));
    const thresholdRows = clampToDef("autovacuum_vacuum_threshold", wanted);
    const scale = snap.live >= 5_000_000 ? 0 : 0.01;
    values.autovacuum_vacuum_threshold = thresholdRows;
    values.autovacuum_vacuum_scale_factor = clampToDef("autovacuum_vacuum_scale_factor", scale);
    cadenceDays = threshold(values, snap.live) / rates.deadPerDay;
    const cadenceLabel =
      tv < 1 / 20 ? `${Math.round(tv * 1440)} minutes` : `${Math.round(tv * 24)} hours`;
    reasons.autovacuum_vacuum_threshold = `About ${cadenceLabel} of the measured dead-row rate (${Math.round(
      rates.deadPerDay,
    ).toLocaleString("en-US")}/day), so vacuum runs on a clock, not on table size.`;
    reasons.autovacuum_vacuum_scale_factor =
      scale === 0
        ? "Zero decouples the trigger from table size; the fixed threshold carries the cadence."
        : "A small factor keeps the trigger scaling while the table is still small.";

    // Analyze at twice the vacuum cadence, static on queue tables and partitions.
    const ta = 2 * tv;
    const analyzeWanted = clampToDef(
      "autovacuum_analyze_threshold",
      roundHuman(Math.max(1000, rates.modPerDay * ta)),
    );
    values.autovacuum_analyze_threshold = analyzeWanted;
    values.autovacuum_analyze_scale_factor = clampToDef(
      "autovacuum_analyze_scale_factor",
      pattern === "queue" || snap.isPartition ? 0 : snap.live >= 5_000_000 ? 0 : 0.02,
    );
    reasons.autovacuum_analyze_threshold =
      "Twice the vacuum cadence; planner statistics tolerate a little more lag.";
    if (values.autovacuum_analyze_scale_factor === 0) {
      reasons.autovacuum_analyze_scale_factor =
        "Static analyze trigger: stale statistics on high-churn tables and partitions break plans (partition pruning included).";
    }
  }

  // Triggers (insert side, PG13+).
  if (rates.insPerDay > 1000 && supportsInsertTrigger(snap)) {
    const ti = pattern === "append-only" ? 1 / 24 : 2 / 24;
    values.autovacuum_vacuum_insert_threshold = clampToDef(
      "autovacuum_vacuum_insert_threshold",
      roundHuman(rates.insPerDay * ti),
    );
    values.autovacuum_vacuum_insert_scale_factor = clampToDef(
      "autovacuum_vacuum_insert_scale_factor",
      snap.live >= 5_000_000 ? 0 : 0.01,
    );
    if (pattern === "append-only") cadenceDays = ti;
    reasons.autovacuum_vacuum_insert_threshold = `About ${Math.round(ti * 24)} h of the measured insert rate, so pages are vacuumed and frozen while still in cache.`;
    reasons.autovacuum_vacuum_insert_scale_factor = "Same decoupling as the dead-row side.";
  } else if (rates.insPerDay > 1000 && !supportsInsertTrigger(snap)) {
    warnings.push(
      "This Postgres version has no insert-triggered autovacuum (needs 13+); freeze scheduling has to carry append traffic.",
    );
  }

  // Freeze chain, all in time units.
  if (Number.isFinite(cadenceDays) && cadenceDays > 0) {
    values.vacuum_freeze_min_age = clampToDef(
      "vacuum_freeze_min_age",
      clamp(roundHuman(2 * cadenceDays * rates.xidPerDay), 1_000_000, 50_000_000),
    );
    reasons.vacuum_freeze_min_age =
      "Two vacuum intervals worth of xids: younger than that and normal vacuums would never freeze a page.";
  }

  let freezeMax = clamp(roundHuman(60 * rates.xidPerDay), 200_000_000, 1_000_000_000);
  const flatAgeEvidence =
    snap.xidAge < 0.5 * snap.current.autovacuum_freeze_max_age && rates.confidence === "high";
  if (freezeMax > 400_000_000 && !flatAgeEvidence) {
    freezeMax = 400_000_000;
    warnings.push(
      "freeze_max_age capped at 400M: raising it further needs evidence that relfrozenxid age stays flat.",
    );
  }
  if (freezeMax !== snap.current.autovacuum_freeze_max_age) {
    values.autovacuum_freeze_max_age = clampToDef("autovacuum_freeze_max_age", freezeMax);
    reasons.autovacuum_freeze_max_age = `Puts the forced anti-wraparound vacuum 30-90 days out at the measured xid rate (${(rates.xidPerDay / 1e6).toFixed(1)} M/day).`;
  }
  if (snap.hints?.fkHeavy) {
    warnings.push(
      "fkHeavy: multixact member space can fill long before multixact age looks bad; watch members, not only ages.",
    );
  }
  // vacuum_freeze_table_age and multixact follow freeze_max_age. They are
  // derived in prove(), after every gate that can still move freeze_max_age.

  // Cost budget.
  values.autovacuum_vacuum_cost_delay = 2;
  values.vacuum_cost_page_hit = 1;
  values.vacuum_cost_page_miss = snap.hints?.storage === "hdd" ? 10 : 2;
  values.vacuum_cost_page_dirty = 20;
  let budget: keyof typeof LAG_BUDGET_MBPS = snap.hints?.replicationLagBudget ?? "tight";
  if (cls.emergency) budget = budget === "tight" ? "relaxed" : "none";
  const workPages = passPages(snap.pages, snap.allVisiblePages, snap.indexes);
  const passMB = (workPages * 8192) / 1048576;
  // A pass under 1 GB is too short to lag a replica; the throttle only costs.
  const smallPass = passMB < 1024;
  const budgetCap = smallPass ? Infinity : LAG_BUDGET_MBPS[budget];
  const durationTarget = Math.min(
    (Number.isFinite(cadenceDays) ? cadenceDays : 1) * DAY_SECONDS * 0.5,
    4 * 3600,
  );
  let chosen: number | null = null;
  let bestUnderBudget: number | null = null;
  for (const limit of COST_LIMIT_STEPS) {
    const c = runCost({ ...values, autovacuum_vacuum_cost_limit: limit }, workPages);
    if (c.mbps <= budgetCap) bestUnderBudget = limit;
    if (c.seconds <= durationTarget && c.mbps <= budgetCap) {
      chosen = limit;
      break;
    }
  }
  if (chosen === null && bestUnderBudget === null && budgetCap !== Infinity) {
    // Even the smallest limit bursts past the lag budget at 2 ms: the delay is the knob that meters it.
    chosen = COST_LIMIT_STEPS[0];
    const c = runCost({ ...values, autovacuum_vacuum_cost_limit: chosen }, workPages);
    const delayNeeded = Math.ceil(((passMB / budgetCap) * 1000) / (c.costUnits / chosen));
    values.autovacuum_vacuum_cost_delay = clampToDef(
      "autovacuum_vacuum_cost_delay",
      clamp(delayNeeded, 2, 20),
    );
    reasons.autovacuum_vacuum_cost_delay = `Raised so the pass stays under ${budgetCap} MB/s (the ${budget} replication-lag budget).`;
  } else if (chosen === null) {
    chosen = bestUnderBudget ?? COST_LIMIT_STEPS[0];
  }
  values.autovacuum_vacuum_cost_limit = clampToDef("autovacuum_vacuum_cost_limit", chosen);
  reasons.autovacuum_vacuum_cost_limit = smallPass
    ? `Smallest budget that finishes a pass inside the cadence; a ${Math.round(passMB)} MB pass is too short to lag a replica, so the ${budget} lag budget does not apply.`
    : `Smallest budget that finishes a pass inside the cadence under the ${budget} replication-lag budget.`;
  const finalCost = runCost(values, workPages);
  if (finalCost.seconds > durationTarget) {
    warnings.push(
      `A full pass needs ${Math.round(finalCost.seconds / 60)} min inside the ${budget} replication budget; the cadence target is not reachable without relaxing the budget.`,
    );
  }
  if (snap.current.autovacuum_vacuum_cost_delay !== 2) {
    reasons.autovacuum_vacuum_cost_delay =
      "2 ms is the Postgres 12+ default; the old 20 ms throttles vacuum 10x.";
  }
  if (snap.current.vacuum_cost_page_miss !== values.vacuum_cost_page_miss) {
    reasons.vacuum_cost_page_miss =
      values.vacuum_cost_page_miss === 2
        ? "2 is the Postgres 14+ default; 10 priced pages for spinning disks."
        : "Kept at 10 for spinning-disk storage (hint).";
  }

  return { values, reasons, cadenceDays };
}

// ---------- PROVE ----------

function prove(
  snap: SnapshotStats,
  rates: Rates,
  cls: Classification,
  solved: { values: Values; reasons: Record<string, string>; cadenceDays: number },
  warnings: string[],
): void {
  const { values, reasons } = solved;
  const cur = snap.current;

  // Low-confidence rates clamp every knob to one bounded step from current.
  if (rates.confidence === "low") {
    for (const d of SETTINGS) {
      const c = cur[d.key];
      const v = values[d.key];
      if (v === c || c <= 0) continue;
      const bounded = clamp(v, c / 10, c * 10);
      if (bounded !== v) {
        const final = clampToDef(d.key, bounded);
        values[d.key] = final;
        // The allowed range can push the value past the 10x step, e.g. a
        // 4M reloption against a 100M minimum. Say what actually happened.
        reasons[d.key] =
          (reasons[d.key] ?? "") +
          (final === bounded
            ? " (low-confidence step, at most 10x from current)"
            : " (low-confidence step, limited by the allowed range)");
      }
    }
  }

  const thrCur = threshold(cur, snap.live);
  const thrNew = threshold(values, snap.live);

  // Gate 1: peak dead rows must not rise more than 10%.
  if (thrNew > thrCur * 1.1) {
    values.autovacuum_vacuum_threshold = cur.autovacuum_vacuum_threshold;
    values.autovacuum_vacuum_scale_factor = cur.autovacuum_vacuum_scale_factor;
    reasons.autovacuum_vacuum_threshold =
      "Kept current: the proposal would raise peak dead rows more than 10%.";
    delete reasons.autovacuum_vacuum_scale_factor;
  }

  // Gate 2: pass duration must not rise unless peak bloat falls.
  const workPages = passPages(snap.pages, snap.allVisiblePages, snap.indexes);
  const costCur = runCost(cur, workPages);
  const costNew = runCost(values, workPages);
  if (costNew.seconds > costCur.seconds && threshold(values, snap.live) >= thrCur) {
    for (const key of [
      "autovacuum_vacuum_cost_delay",
      "autovacuum_vacuum_cost_limit",
      "vacuum_cost_page_hit",
      "vacuum_cost_page_miss",
      "vacuum_cost_page_dirty",
    ]) {
      values[key] = cur[key];
      delete reasons[key];
    }
    reasons.autovacuum_vacuum_cost_limit =
      "Kept current: the proposal would slow the pass without a bloat win.";
  }

  // Gate 3: time to the forced aggressive vacuum must not fall below 14 days.
  if (!cls.emergency) {
    const daysCur = daysToAggressive(cur.autovacuum_freeze_max_age, snap.xidAge, snap.xidPerDay);
    const daysNew = daysToAggressive(values.autovacuum_freeze_max_age, snap.xidAge, snap.xidPerDay);
    if (daysNew < Math.min(14, daysCur)) {
      values.autovacuum_freeze_max_age = cur.autovacuum_freeze_max_age;
      reasons.autovacuum_freeze_max_age =
        "Kept current: the proposal would pull the forced aggressive vacuum under 14 days out.";
    }
  }

  // The rest of the freeze chain follows freeze_max_age, so it is derived
  // here, after the last gate that can move freeze_max_age. Exact ratios,
  // no rounding: rounding 0.75x back onto the 1/2/5 grid lands on 1.0x.
  const tableAge = clampToDef("vacuum_freeze_table_age", 0.75 * values.autovacuum_freeze_max_age);
  if (tableAge !== cur.vacuum_freeze_table_age) {
    values.vacuum_freeze_table_age = tableAge;
    reasons.vacuum_freeze_table_age =
      "75% of freeze_max_age, so aggressive vacuums run on our schedule, not the forced one.";
  }
  if (!snap.hints?.fkHeavy) {
    const multixact = clampToDef(
      "autovacuum_multixact_freeze_max_age",
      clamp(1.5 * values.autovacuum_freeze_max_age, 400_000_000, 1_200_000_000),
    );
    if (multixact !== cur.autovacuum_multixact_freeze_max_age) {
      values.autovacuum_multixact_freeze_max_age = multixact;
      reasons.autovacuum_multixact_freeze_max_age =
        "Scaled with freeze_max_age, never below the Postgres default; multixact age grows with shared row locks.";
    }
  }

  // Gate 4: worker starvation. Total vacuum seconds per day stays bounded.
  if (rates.deadPerDay > 0) {
    const perDay = (thr: number, cost: { seconds: number }) =>
      (rates.deadPerDay / Math.max(1, thr)) * cost.seconds;
    const curLoad = perDay(thrCur, costCur);
    const cap = Math.max(4 * curLoad, 6 * 3600);
    let newLoad = perDay(threshold(values, snap.live), runCost(values, workPages));
    let guard = 0;
    while (newLoad > cap && guard < 12) {
      values.autovacuum_vacuum_threshold = clampToDef(
        "autovacuum_vacuum_threshold",
        values.autovacuum_vacuum_threshold * 2,
      );
      newLoad = perDay(threshold(values, snap.live), runCost(values, workPages));
      guard++;
    }
    if (guard > 0) {
      reasons.autovacuum_vacuum_threshold +=
        " Raised further so total vacuum time stays inside the worker budget.";
    }
    if (newLoad > cap) {
      warnings.push(
        "The dead-row rate outruns the worker budget at any threshold: vacuum cannot keep up on this table. Raise autovacuum_max_workers or relax the replication-lag budget.",
      );
    }
  }

  for (const key of Object.keys(reasons)) {
    if (values[key] === cur[key] && !reasons[key].startsWith("Kept current")) delete reasons[key];
  }
}

// ---------- companions and diagnosis ----------

function buildCompanions(snap: SnapshotStats, values: Values, cls: Classification): Companions {
  const advice: string[] = [];
  const hints = snap.hints;
  if (hints?.ramBytes) {
    const mwm = Math.min(0.01 * hints.ramBytes, 5 * 2 ** 30);
    const vbul = Math.min(0.02 * hints.ramBytes, 10 * 2 ** 30);
    advice.push(`maintenance_work_mem ≈ ${Math.round(mwm / 2 ** 20)} MB (1% of RAM, cap 5 GB).`);
    advice.push(
      `vacuum_buffer_usage_limit ≈ ${Math.round(vbul / 2 ** 20)} MB (2% of RAM, cap 10 GB, PG16+).`,
    );
  }
  if (hints?.maxWorkers !== undefined && hints.maxWorkers < 5) {
    advice.push("autovacuum_max_workers = 5: raise workers before you lower per-table frequency.");
  }
  const companions: Companions = { clusterAdvice: advice };
  if (snap.hasToast) {
    companions.toastSql =
      `ALTER TABLE ${snap.table} SET (\n` +
      `  toast.autovacuum_vacuum_scale_factor = 0,\n` +
      `  toast.autovacuum_vacuum_threshold = 10000,\n` +
      `  toast.autovacuum_vacuum_cost_limit = ${values.autovacuum_vacuum_cost_limit},\n` +
      `  toast.autovacuum_freeze_min_age = 1000000\n` +
      `);`;
  }
  if (cls.verdict.name === "large-update-heavy" && (snap.hotFraction ?? 1) < 0.5) {
    companions.fillfactorNote = `Only ${Math.round((snap.hotFraction ?? 0) * 100)}% of updates are HOT. A fillfactor of 90 leaves page space for HOT updates and cuts index write amplification. Needs a rewrite to apply to existing pages.`;
  }
  if (snap.isPartition) {
    companions.partitionNote =
      "Reloptions do not inherit: apply the settings to every partition, template them for new partitions, and re-apply after any table rewrite.";
  }
  return companions;
}

const HORIZON_DIAGNOSIS =
  "Dead rows stay high although autovacuum runs on schedule. Something pins the xmin horizon, and no autovacuum setting can remove rows the horizon still protects. Check the four holders: long-running transactions (pg_stat_activity), stale or unused replication slots (pg_replication_slots), prepared transactions (pg_prepared_xacts), and standby feedback (hot_standby_feedback). Fix the holder, then re-snapshot.";

// ---------- entry point ----------

export function optimize(snap: SnapshotStats): OptimizeResult {
  const rates = sense(snap);
  const cls = classify(snap, rates);
  const warnings: string[] = [];

  if (cls.emergency) {
    if (snap.xidAge > snap.current.autovacuum_freeze_max_age) {
      warnings.push(
        "relfrozenxid age is past autovacuum_freeze_max_age: the forced anti-wraparound vacuum runs now and does not yield to lock waiters.",
      );
    }
    const margin = shutdownMarginDays(snap.xidAge, snap.xidPerDay);
    if (margin < 30) {
      warnings.push(
        `Write shutdown in ~${margin.toFixed(1)} days at the observed xid rate. Treat this as an incident, not a tuning task.`,
      );
    }
  }
  if (snap.hints?.longTransactions) {
    warnings.push(
      "longTransactions: every open transaction pins the xmin horizon for the whole cadence; the settings below assume the horizon moves.",
    );
  }

  if (cls.horizonBlocked) {
    return {
      values: { ...snap.current },
      reasons: {},
      warnings,
      pattern: cls.verdict,
      diagnosis: HORIZON_DIAGNOSIS,
      companions: buildCompanions(snap, snap.current, cls),
    };
  }

  const solved = solve(snap, rates, cls, warnings);
  prove(snap, rates, cls, solved, warnings);

  return {
    values: solved.values,
    reasons: solved.reasons,
    warnings,
    pattern: cls.verdict,
    companions: buildCompanions(snap, solved.values, cls),
  };
}
