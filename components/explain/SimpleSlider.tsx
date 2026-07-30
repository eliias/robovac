"use client";

import type { PointerEvent as ReactPointerEvent } from "react";

export function logPos(v: number, lo: number, hi: number): number {
  return (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo));
}

export function SimpleSlider({ pct, onPos }: { pct: number; onPos: (p: number) => void }) {
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const apply = (clientX: number) =>
      onPos(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)));
    const move = (ev: PointerEvent) => apply(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    apply(e.clientX);
  };
  return (
    <div
      onPointerDown={onPointerDown}
      style={{
        position: "relative",
        height: 24,
        marginTop: 8,
        cursor: "ew-resize",
        touchAction: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 11,
          left: 0,
          right: 0,
          height: 2,
          background: "rgba(255,255,255,0.09)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 11,
          left: 0,
          height: 2,
          background: "rgba(255,255,255,0.34)",
          width: `${pct}%`,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 6,
          width: 11,
          height: 11,
          marginLeft: -5.5,
          borderRadius: 3,
          background: "#fff",
          left: `${pct}%`,
        }}
      />
    </div>
  );
}
