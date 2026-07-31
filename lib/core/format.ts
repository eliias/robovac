import type { SettingDef } from "./settings";

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function fmtVal(def: Pick<SettingDef, "fmt">, v: number): string {
  if (v === 0) return "0";
  if (def.fmt === "frac") return v >= 0.01 ? v.toFixed(3) : v.toFixed(4);
  return fmtInt(v);
}

export function fmtCompact(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + " B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + " M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + " k";
  return fmtInt(n);
}

export function fmtDur(days: number): string {
  if (days >= 1) return days.toFixed(1) + " d";
  const h = days * 24;
  if (h >= 1) return h.toFixed(1) + " h";
  const m = h * 60;
  if (m >= 1) return m.toFixed(0) + " min";
  // Never round a real duration to 0: a queue table vacuums in seconds.
  return Math.max(1, Math.round(m * 60)) + " s";
}

/**
 * A vacuum interval derived from a rate. When the rate is zero (days →
 * Infinity here) the caller says why: a single sample has no rate, a
 * measured interval without writes has a rate of zero.
 */
export function fmtPeriod(days: number, zeroLabel = "unknown · one sample"): string {
  return Number.isFinite(days) && days > 0 ? fmtDur(days) : zeroLabel;
}

/**
 * The phrase after "vacuum": "every 3.2 d", or the zero-rate reason.
 * zeroReason must fit the same frame, e.g. "never · no writes observed".
 */
export function fmtCadence(days: number, zeroReason: string): string {
  return Number.isFinite(days) && days > 0 ? `every ${fmtDur(days)}` : zeroReason;
}

export function fmtSecs(s: number): string {
  if (s >= 3600) return (s / 3600).toFixed(1) + " h";
  if (s >= 60) return (s / 60).toFixed(0) + " min";
  return s.toFixed(0) + " s";
}

export function toPos(d: SettingDef, v: number): number {
  if (d.log) {
    const lo = Math.log(Math.max(d.min, 1e-6));
    const hi = Math.log(d.max);
    return (Math.log(Math.max(v, Math.max(d.min, 1e-6))) - lo) / (hi - lo);
  }
  return (v - d.min) / (d.max - d.min);
}

export function fromPos(d: SettingDef, p: number): number {
  p = Math.min(1, Math.max(0, p));
  let v: number;
  if (d.log) {
    const lo = Math.log(Math.max(d.min, 1e-6));
    const hi = Math.log(d.max);
    v = Math.exp(lo + p * (hi - lo));
    if (d.fmt === "frac") v = Number(v.toPrecision(2));
    else if (v > 1e6) v = Math.round(v / 1e6) * 1e6;
    else if (v > 1000) v = Math.round(v / 100) * 100;
    else v = Math.round(v);
  } else {
    v = d.min + p * (d.max - d.min);
    const step = d.step ?? 1;
    v = Math.round(v / step) * step;
  }
  return Math.min(d.max, Math.max(d.min, v));
}
