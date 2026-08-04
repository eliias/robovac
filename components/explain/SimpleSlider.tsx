"use client";

import { Track } from "@/components/Track";

export function logPos(v: number, lo: number, hi: number): number {
  return (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo));
}

/** The explain demos' slider: a bare track, no marks and no readout. */
export function SimpleSlider({ pct, onPos }: { pct: number; onPos: (p: number) => void }) {
  return <Track fill={`${pct}%`} onPos={onPos} />;
}
