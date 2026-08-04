import { fmtSecs } from "./format";
import {
  hasMeasuredRate,
  isSmallTable,
  rateState,
  type RateStateName,
  type Snapshot,
} from "./snapshot";

/**
 * How much of the report a snapshot can actually support (D1-D6). Every part
 * of the page asks the same questions: is there a rate, can it be trusted, is
 * the table too small to tune, is the snapshot old. Answering them once here
 * is what stops the notices, the prose, the figures and the stat cells from
 * each re-deriving them and drifting apart.
 */
export interface Reading {
  state: RateStateName;
  /** What to print in place of a figure that needs a rate, or null when one exists. */
  rateUnknownReason: string | null;
  /** No dead-row rate. A single sample that read zero carries none either. */
  deadRateUnknown: boolean;
  /** No xid rate. Any single sample carries none, whatever it read. */
  xidRateUnknown: boolean;
  /** A rate exists, but the sampling window is short enough to be noise. */
  estimated: boolean;
  /** The two reads span a real interval, so a zero is a measured zero. */
  measured: boolean;
  /** What a cadence of "never" means on this snapshot. */
  zeroCadence: string;
  small: boolean;
  ageDays: number;
  stale: boolean;
  neverVacuumed: boolean;
  /** Why auto-optimize is off, or null when it is available. */
  optimizeDisabled: string | null;
}

/** `now` is a parameter so this stays a pure function of the snapshot. */
export function reading(snap: Snapshot, now: number = Date.now()): Reading {
  const state = rateState(snap);
  const rateUnknownReason =
    state === "reset" ? "counters reset" : state === "single" ? "needs 2 samples" : null;
  const estimated = state === "noisy";
  const small = isSmallTable(snap);
  const ageDays = (now - Date.parse(snap.capturedAt)) / 86_400_000;
  const measured = hasMeasuredRate(snap);

  return {
    state,
    rateUnknownReason,
    deadRateUnknown: state === "reset" || (state === "single" && snap.deadPerDay === 0),
    xidRateUnknown: rateUnknownReason !== null,
    estimated,
    measured,
    zeroCadence: measured ? "never · no writes observed" : "every unknown · one sample",
    small,
    ageDays,
    stale: ageDays > 7,
    neverVacuumed: !snap.lastAutovacuum && !snap.lastVacuum,
    // Noise outranks size: a proposal built on noise is wrong, a proposal for
    // a small table is merely pointless.
    optimizeDisabled: estimated
      ? `rates from a ${fmtSecs(snap.sampleSeconds ?? 0)} interval are noise, not a basis for proposals`
      : small
        ? "no changes recommended for a table this size"
        : null,
  };
}
