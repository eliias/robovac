import {
  passPages,
  rowCountDrift,
  runCost,
  shutdownMarginDays,
  threshold,
  triggerRows,
} from "./model";
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
  indexBypassNote?: string;
  analyzeNote?: string;
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
  // Rates measured over hours replace the two-sample delta. A 60 second
  // window on a bursty table is not a rate, and every threshold below
  // derives from these numbers, so a real measurement wins outright.
  const measured = snap.hints?.measuredRates;
  const deadPerDay = measured?.deadPerDay ?? snap.deadPerDay;
  const insPerDay = measured?.insPerDay ?? snap.insPerDay ?? 0;
  return {
    deadPerDay,
    insPerDay,
    modPerDay: measured ? deadPerDay + insPerDay : (snap.modPerDay ?? deadPerDay + insPerDay),
    xidPerDay: measured?.xidPerDay ?? snap.xidPerDay,
    // The dead rate is what the thresholds are built from, so a measured
    // one lifts the whole report out of the low-confidence damping.
    confidence: measured?.deadPerDay !== undefined ? "high" : (snap.rateConfidence ?? "low"),
  };
}

// ---------- CLASSIFY ----------

interface Classification {
  verdict: PatternVerdict;
  /** Real wraparound danger, judged against the limit the proposal leaves behind. */
  emergency: boolean;
  /** A forced anti-wraparound vacuum is running now, whatever put it there. */
  forcedNow: boolean;
  horizonBlocked: boolean;
}

function classify(snap: SnapshotStats, rates: Rates): Classification {
  const rows = triggerRows(snap);
  const sizeBytes = snap.pages * 8192;
  const churnPerDay = rates.deadPerDay / Math.max(1, rows);
  const insFraction = rates.insPerDay / Math.max(1, rates.insPerDay + rates.deadPerDay);
  const deadRatio = snap.dead / Math.max(1, rows);

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
        `the table turns over ${churnPerDay.toFixed(1)}x its rows per day`,
        `heap is ${(sizeBytes / 1048576).toFixed(0)} MB`,
      ],
    },
    {
      name: "large-update-heavy",
      score: rows >= 10_000_000 && rates.deadPerDay >= 100_000 && insFraction < 0.7 ? 0.85 : 0,
      evidence: [
        `${rows.toLocaleString("en-US")} rows by the count autovacuum uses`,
        `${Math.round(rates.deadPerDay).toLocaleString("en-US")} dead rows per day`,
      ],
    },
    {
      name: "cold",
      score: rates.deadPerDay < rows * 1e-5 && rates.insPerDay < 1000 ? 0.8 : 0,
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

  // Two different questions, and they used to share one answer.
  //
  // Is a forced vacuum running right now? That is measured against the
  // limit the table carries today, misconfigured or not.
  const forcedNow = snap.xidAge > snap.current.autovacuum_freeze_max_age;
  // Is the table actually near wraparound? That has to be measured against
  // the limit the proposal leaves behind, because the current one is the
  // single value this tool exists to distrust. Judging danger by it hands a
  // fake emergency, and a loosened I/O throttle, to exactly the tables with
  // a bogus limit: the population robovac is best at finding.
  const effectiveFreezeMax = Math.max(
    snap.current.autovacuum_freeze_max_age,
    def("autovacuum_freeze_max_age").def,
  );
  const emergency =
    snap.xidAge > effectiveFreezeMax || shutdownMarginDays(snap.xidAge, snap.xidPerDay) < 30;

  // Dead rows pile up although autovacuum ran recently: the xmin horizon is pinned, knobs cannot help.
  const currentPeriodDays =
    rates.deadPerDay > 0 ? threshold(snap.current, rows) / rates.deadPerDay : Infinity;
  const recentWindowDays = Math.min(Math.max(2 * currentPeriodDays, 0.5), 2);
  const lastAvDays = snap.lastAutovacuum
    ? (Date.parse(snap.capturedAt) - Date.parse(snap.lastAutovacuum)) / 86_400_000
    : Infinity;
  // A pinned horizon means removal is blocked, and blocked removal shows as
  // many trigger-thresholds worth of dead rows despite a recent vacuum. A
  // high-churn table sits near one threshold between passes, so the
  // multiplier tells the two apart. The floor keeps toy tables out.
  const horizonBlocked =
    deadRatio > 0.1 &&
    snap.dead >= 10_000 &&
    snap.dead >= 25 * threshold(snap.current, rows) &&
    lastAvDays < recentWindowDays;

  return {
    verdict: { name: top.name, score: top.score, evidence: top.evidence },
    emergency,
    forcedNow,
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
  const rows = triggerRows(snap);

  // Triggers (dead-row side).
  let cadenceDays = tv;
  if (pattern !== "cold" && rates.deadPerDay > 0) {
    const wanted = clamp(roundHuman(rates.deadPerDay * tv), 500, 0.25 * Math.max(2000, rows));
    const thresholdRows = clampToDef("autovacuum_vacuum_threshold", wanted);
    const scale = rows >= 5_000_000 ? 0 : 0.01;
    values.autovacuum_vacuum_threshold = thresholdRows;
    values.autovacuum_vacuum_scale_factor = clampToDef("autovacuum_vacuum_scale_factor", scale);
    cadenceDays = threshold(values, rows) / rates.deadPerDay;
    const cadenceLabel =
      tv < 1 / 20 ? `${Math.round(tv * 1440)} minutes` : `${Math.round(tv * 24)} hours`;
    reasons.autovacuum_vacuum_threshold = `About ${cadenceLabel} of the measured dead-row rate (${Math.round(
      rates.deadPerDay,
    ).toLocaleString("en-US")}/day), so vacuum runs on a clock, not on table size.`;
    reasons.autovacuum_vacuum_scale_factor =
      scale === 0
        ? "Zero decouples the trigger from table size; the fixed threshold carries the cadence."
        : "A small factor keeps the trigger scaling while the table is still small.";
  }

  // Analyze only where the data's shape changes fast: queue tables turn
  // their content over, partitions fill from empty. A stable distribution
  // gains nothing from more analyze runs: each run re-samples the same
  // fixed number of rows (no incremental mode) and re-rolls plans that sit
  // on knife-edge costs, so stable tables keep their current settings.
  if ((pattern === "queue" || snap.isPartition) && pattern !== "cold" && rates.modPerDay > 0) {
    values.autovacuum_analyze_threshold = clampToDef(
      "autovacuum_analyze_threshold",
      roundHuman(Math.max(1000, rates.modPerDay * 2 * tv)),
    );
    values.autovacuum_analyze_scale_factor = clampToDef("autovacuum_analyze_scale_factor", 0);
    reasons.autovacuum_analyze_threshold =
      "Twice the vacuum cadence: this table's shape changes fast, and stale statistics break plans (partition pruning included).";
    reasons.autovacuum_analyze_scale_factor = "Static analyze trigger, decoupled from table size.";
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
      rows >= 5_000_000 ? 0 : 0.01,
    );
    if (pattern === "append-only") cadenceDays = ti;
    reasons.autovacuum_vacuum_insert_threshold = `About ${Math.round(ti * 24)} h of the measured insert rate, so pages are vacuumed and frozen while still in cache.`;
    reasons.autovacuum_vacuum_insert_scale_factor = "Same decoupling as the dead-row side.";
  } else if (rates.insPerDay > 1000 && !supportsInsertTrigger(snap)) {
    warnings.push(
      "This Postgres version has no insert-triggered autovacuum (needs 13+); freeze scheduling has to carry append traffic.",
    );
  }

  // Freeze chain, all in time units. The cutoff must stay under one vacuum
  // interval in xids: a page whose rows are all younger goes all-visible
  // unfrozen, later normal vacuums skip it, and only the aggressive pass
  // ever freezes it.
  if (Number.isFinite(cadenceDays) && cadenceDays > 0) {
    values.vacuum_freeze_min_age = clampToDef(
      "vacuum_freeze_min_age",
      clamp(roundHuman(0.5 * cadenceDays * rates.xidPerDay), 1_000_000, 50_000_000),
    );
    reasons.vacuum_freeze_min_age =
      "Half a vacuum interval of xids. A cutoff past one interval leaves pages all-visible but unfrozen, and only the aggressive vacuum ever freezes them.";
  }

  // freeze_max_age is a backstop, not a cadence knob. Once a table vacuums
  // on a threshold cadence, the vacuum_freeze_table_age escalation rides a
  // run that was going to happen anyway and advances relfrozenxid, so the
  // forced anti-wraparound scan never fires and the value it is set to
  // stops mattering. Raising it only shrinks the safety margin, so the
  // proposal moves it in one direction: back up to the default when
  // somebody lowered it.
  const freezeMaxDefault = def("autovacuum_freeze_max_age").def;
  if (snap.current.autovacuum_freeze_max_age < freezeMaxDefault) {
    values.autovacuum_freeze_max_age = freezeMaxDefault;
    reasons.autovacuum_freeze_max_age = `Back to the ${(freezeMaxDefault / 1e6).toFixed(
      0,
    )}M default. This is the deadline for the forced anti-wraparound vacuum, not a way to freeze sooner; vacuum_freeze_min_age is that knob.`;
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
  const askedBudget: keyof typeof LAG_BUDGET_MBPS = snap.hints?.replicationLagBudget ?? "tight";
  let budget = askedBudget;
  // A wraparound emergency outranks replica lag, so the throttle opens one
  // step. Say so: otherwise the report quotes a budget nobody asked for and
  // reads like the hint was dropped.
  if (cls.emergency) {
    budget = budget === "tight" ? "relaxed" : "none";
    warnings.push(
      `Replication-lag budget raised from ${askedBudget} to ${budget} for this report: relfrozenxid age is past the limit, and stopping the wraparound outranks replica lag. It returns to ${askedBudget} once the age is back under control.`,
    );
  }
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
  const rows = triggerRows(snap);

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

  const thrCur = threshold(cur, rows);
  const thrNew = threshold(values, rows);

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
  if (costNew.seconds > costCur.seconds && threshold(values, rows) >= thrCur) {
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
    let newLoad = perDay(threshold(values, rows), runCost(values, workPages));
    let guard = 0;
    while (newLoad > cap && guard < 12) {
      values.autovacuum_vacuum_threshold = clampToDef(
        "autovacuum_vacuum_threshold",
        values.autovacuum_vacuum_threshold * 2,
      );
      newLoad = perDay(threshold(values, rows), runCost(values, workPages));
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
    // Before Postgres 17 the dead-tuple list is one allocation with a hard
    // 1 GB ceiling (about 178M tuple identifiers), so anything above that
    // is memory a vacuum will never touch. PG17 replaced it with TidStore
    // and the ceiling is gone.
    const tidStore = (snap.versionNum ?? 0) >= 170_000;
    const cap = tidStore ? 5 * 2 ** 30 : 2 ** 30;
    const mwm = Math.min(0.01 * hints.ramBytes, cap);
    const vbul = Math.min(0.02 * hints.ramBytes, 10 * 2 ** 30);
    advice.push(
      `maintenance_work_mem ≈ ${Math.round(mwm / 2 ** 20)} MB (1% of RAM, cap ${
        tidStore ? "5 GB" : "1 GB"
      })${
        tidStore
          ? "."
          : ": before PG17 the dead-tuple array cannot grow past 1 GB, so a larger value does nothing for vacuum."
      }`,
    );
    advice.push(
      `vacuum_buffer_usage_limit ≈ ${Math.round(vbul / 2 ** 20)} MB (2% of RAM, cap 10 GB, PG16+).`,
    );
  }
  if (hints?.maxWorkers !== undefined && hints.maxWorkers < 5) {
    advice.push("autovacuum_max_workers = 5: raise workers before you lower per-table frequency.");
  }
  // One capability, not a vendor list: something on this platform already
  // adjusts vacuum I/O and memory against live load, so the cost and memory
  // numbers here are advisory and may simply be overridden.
  if (snap.adaptiveVacuum) {
    advice.push(
      "This server runs an adaptive autovacuum controller that meters vacuum I/O, workers and memory against live load. Treat the cost settings and the memory figures above as a ceiling to sanity-check, not as values to apply: the controller may override them. The trigger and freeze settings are unaffected, because it does not decide when a table becomes eligible.",
    );
  }
  const companions: Companions = { clusterAdvice: advice };
  if (snap.hasToast) {
    // TOAST churns at the heap's row churn times chunks per row, and its
    // dead-but-not-removable floor (churn x snapshot-horizon age) can sit
    // in the hundreds of thousands. A fixed low threshold under that floor
    // re-triggers a useless vacuum every naptime, so TOAST follows the
    // heap threshold with a 100k floor.
    const toastThreshold = Math.max(100_000, values.autovacuum_vacuum_threshold);
    companions.toastSql =
      `ALTER TABLE ${snap.table} SET (\n` +
      `  toast.autovacuum_vacuum_scale_factor = 0,\n` +
      `  toast.autovacuum_vacuum_threshold = ${toastThreshold},\n` +
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
  companions.indexBypassNote = indexBypassNote(snap, values);
  companions.analyzeNote = analyzeNote(snap, values);
  return companions;
}

/**
 * Heap pages carrying at least one dead item. The threshold counts tuples
 * and the bypass counts pages, so the conversion depends on clustering,
 * which nothing in a snapshot reveals. One dead tuple per page is the
 * conservative end: it predicts the expensive regime rather than promising
 * cheap runs that may not arrive.
 */
function pagesWithDeadItems(deadRows: number, pages: number): number {
  return Math.min(pages, deadRows);
}

/**
 * Postgres also refuses the bypass once the dead-item array would exceed
 * 32 MB, holding six bytes per item. Both conditions must hold, so a table
 * with many dead items spread thinly still pays for the index pass.
 */
const MAX_BYPASS_DEAD_ITEMS = (32 * 1024 * 1024) / 6;

/**
 * Which of the two vacuum regimes the proposed threshold lands in. Postgres
 * skips the index pass when dead line pointers sit on under 2% of the
 * table's pages, and that single line decides whether a run costs seconds
 * or walks every index. It also bounds how much a lower threshold can buy:
 * dead items survive a bypassed run, so more frequent heap passes do not
 * make the index passes any rarer.
 */
function indexBypassNote(snap: SnapshotStats, values: Values): string | undefined {
  const indexes = snap.indexes ?? 0;
  if (indexes <= 0 || snap.pages < 1000) return undefined;
  const linePages = 0.02 * snap.pages;
  const deadAtTrigger = threshold(values, triggerRows(snap));
  const atTrigger = pagesWithDeadItems(deadAtTrigger, snap.pages);
  const pct = ((atTrigger / snap.pages) * 100).toFixed(2);
  // Both conditions have to hold, so the item count can veto on its own.
  if (deadAtTrigger >= MAX_BYPASS_DEAD_ITEMS) {
    return `At the proposed trigger the ${Math.round(deadAtTrigger).toLocaleString(
      "en-US",
    )} dead items need more than the 32 MB the bypass allows, so every run walks all ${indexes} indexes however thinly they are spread. The 2% page line does not rescue this one.`;
  }
  return atTrigger < linePages
    ? `At the proposed trigger the dead rows sit on at most ${Math.round(atTrigger).toLocaleString(
        "en-US",
      )} pages, ${pct}% of the table, under the 2% line where Postgres skips the index pass, so runs can stay heap-only and cheap. Dead items still accumulate across those runs, so the index pass arrives when the line is crossed, not when the threshold is. This takes the worst case of one dead row per page; where they cluster, the margin is wider.`
    : `At the proposed trigger the dead rows sit on up to ${Math.round(atTrigger).toLocaleString(
        "en-US",
      )} pages, ${pct}% of the table, past the 2% line, so every run walks all ${indexes} indexes. Lowering the threshold further adds heap passes without making the index passes rarer.`;
}

/**
 * The analyze cadence, as an observation. The proposal leaves analyze alone
 * on a stable table on purpose (a fresh sample of a fixed size costs the
 * same every run and re-rolls plans), but a scale factor against a large
 * table can put the interval months out, and the reader should see that
 * number rather than infer approval from silence.
 */
function analyzeNote(snap: SnapshotStats, values: Values): string | undefined {
  const modPerDay = snap.modPerDay ?? 0;
  if (modPerDay <= 0) return undefined;
  const rows = triggerRows(snap);
  const trigger =
    values.autovacuum_analyze_threshold + values.autovacuum_analyze_scale_factor * rows;
  const days = trigger / modPerDay;
  if (days < 7) return undefined;
  return `Autoanalyze fires every ${days.toFixed(
    0,
  )} days here: ${Math.round(trigger).toLocaleString("en-US")} modifications at ${Math.round(
    modPerDay,
  ).toLocaleString(
    "en-US",
  )} per day. That is the scale factor against a large table. The proposal leaves it alone because a fresh sample costs the same however often it runs, but if the planner picks bad plans on this table, this number is why. The case that bites even on a stable distribution is a column that only grows, a timestamp or a sequential id: its newest values sit past the last histogram bucket, so queries filtering on a recent range read stale density. An index on that column mostly rescues it, because the planner probes the index for the real bound at plan time.`;
}

/** A sample this short stops describing a bursty table and starts describing a minute of it. */
const TRUSTED_SAMPLE_SECONDS = 600;

/**
 * What the proposed numbers are worth, judged after they exist. Each check
 * here needs the proposal, so none of them can live in solve().
 */
function checkProposal(
  snap: SnapshotStats,
  rates: Rates,
  values: Values,
  warnings: string[],
): void {
  // The floor: dead rows younger than the oldest snapshot cannot be removed
  // by any vacuum. A threshold under it re-triggers every naptime forever.
  if (snap.horizonXids !== undefined && rates.deadPerDay > 0 && rates.xidPerDay > 0) {
    const horizonDays = snap.horizonXids / rates.xidPerDay;
    const floor = rates.deadPerDay * horizonDays;
    const trigger = threshold(values, triggerRows(snap));
    if (floor > 0 && trigger < 3 * floor) {
      warnings.push(
        `The proposed trigger (${Math.round(trigger).toLocaleString("en-US")} rows) sits within 3x of the dead-but-not-removable floor (about ${Math.round(
          floor,
        ).toLocaleString(
          "en-US",
        )} rows: ${Math.round(rates.deadPerDay).toLocaleString("en-US")} dead/day against an xmin horizon ${snap.horizonXids.toLocaleString("en-US")} xids old). Vacuum cannot remove rows the horizon still protects, so a threshold near that floor re-triggers every naptime and clears nothing. Raise it, or find what holds the horizon.`,
      );
    }
  }

  // A short window measures a minute, not a rate, and the thresholds are
  // built entirely from it. Separate failure from the row-count one: fixing
  // reltuples makes the rest of the report look right while these stay wrong.
  const seconds = snap.sampleSeconds;
  if (
    !snap.hints?.measuredRates?.deadPerDay &&
    seconds !== undefined &&
    seconds < TRUSTED_SAMPLE_SECONDS &&
    rates.deadPerDay > 0
  ) {
    warnings.push(
      `Every threshold below derives from a ${Math.round(seconds)} second sample. On a bursty table that window measures the minute it ran in, not the workload: it can miss the real rate by several times in either direction. Re-sample 10-15 minutes apart, or pass measured_rates from monitoring.`,
    );
  }

  // The modelled dead rate excludes HOT updates on the argument that page
  // pruning reclaims them. When the counter's own delta disagrees, that
  // argument does not hold for this table.
  const observed = snap.observedDeadPerDay;
  if (observed !== undefined && observed > 1000 && rates.deadPerDay > 0) {
    const gap = Math.max(observed, rates.deadPerDay) / Math.min(observed, rates.deadPerDay);
    if (gap >= 3) {
      warnings.push(
        `The dead-row rate from the write counters (${Math.round(rates.deadPerDay).toLocaleString(
          "en-US",
        )}/day, HOT updates excluded) and the one n_dead_tup actually accumulated (${Math.round(
          observed,
        ).toLocaleString(
          "en-US",
        )}/day) differ by ${gap.toFixed(1)}x. The exclusion assumes page pruning reclaims HOT versions before vacuum sees them, which does not hold here.`,
      );
    }
  }

  // The failsafe drops every throttle. A freeze_max_age above it means the
  // failsafe fires first, so the ordinary forced vacuum never gets its turn.
  if (snap.failsafeAge !== undefined && values.autovacuum_freeze_max_age >= snap.failsafeAge) {
    warnings.push(
      `autovacuum_freeze_max_age (${values.autovacuum_freeze_max_age.toLocaleString("en-US")}) is at or above vacuum_failsafe_age (${snap.failsafeAge.toLocaleString("en-US")}). The failsafe fires first and throws away every cost limit, so the forced vacuum this setting schedules never gets its turn. Lower it below the failsafe.`,
    );
  }
}

const HORIZON_DIAGNOSIS =
  "Dead rows stay high although autovacuum runs on schedule. Something pins the xmin horizon, and no autovacuum setting can remove rows the horizon still protects. Check the four holders: long-running transactions (pg_stat_activity), stale or unused replication slots (pg_replication_slots), prepared transactions (pg_prepared_xacts), and standby feedback (hot_standby_feedback). Fix the holder, then re-snapshot.";

// ---------- entry point ----------

export function optimize(snap: SnapshotStats): OptimizeResult {
  const rates = sense(snap);
  const cls = classify(snap, rates);
  const warnings: string[] = [];

  // A replica keeps its own statistics counters and they never move, so
  // every rate below reads as zero and the table looks cold whatever it is.
  if (snap.isReplica) {
    warnings.push(
      "This snapshot came from a replica (pg_is_in_recovery() is true). Replicas keep their own pg_stat_user_tables counters, which stay at zero, so every rate here is wrong and the table classifies as cold no matter how busy it is. Re-run the query on the primary.",
    );
  }
  // Autovacuum multiplies the scale factor by pg_class.reltuples. A wide
  // gap to n_live_tup means analyze is behind, which is worth saying on its
  // own, and it also tells the reader why the trigger sits where it does.
  const drift = rowCountDrift(snap);
  if (drift >= 2) {
    warnings.push(
      `pg_class.reltuples (${Math.round(triggerRows(snap)).toLocaleString("en-US")}) and n_live_tup (${snap.live.toLocaleString("en-US")}) differ by ${drift.toFixed(1)}x. The triggers below use reltuples because autovacuum does. A gap this wide is itself a signal that analyze is not keeping up on this table.`,
    );
  }

  if (cls.forcedNow) {
    // A reloption far below the default is a lowered deadline, not real
    // wraparound risk. The xmin horizon keeps relfrozenxid a few million
    // xids old at all times, so a limit under that age can never be
    // satisfied and the forced vacuum re-fires every naptime, forever.
    if (snap.current.autovacuum_freeze_max_age < 100_000_000) {
      warnings.push(
        "autovacuum_freeze_max_age is lowered below the age the xmin horizon allows. The table can never get back under the limit, so a forced anti-wraparound vacuum starts every naptime, forever. This setting is the deadline knob, not the eagerness knob: RESET it and lower vacuum_freeze_min_age to freeze earlier.",
      );
    } else {
      warnings.push(
        "relfrozenxid age is past autovacuum_freeze_max_age: the forced anti-wraparound vacuum runs now and does not yield to lock waiters.",
      );
    }
  }
  const margin = shutdownMarginDays(snap.xidAge, snap.xidPerDay);
  if (margin < 30) {
    warnings.push(
      `Write shutdown in ~${margin.toFixed(1)} days at the observed xid rate. Treat this as an incident, not a tuning task.`,
    );
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
  checkProposal(snap, rates, solved.values, warnings);

  return {
    values: solved.values,
    reasons: solved.reasons,
    warnings,
    pattern: cls.verdict,
    companions: buildCompanions(snap, solved.values, cls),
  };
}
