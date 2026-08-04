"use client";

import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";

/**
 * A draggable track: a rail, a fill, whatever marks the caller draws on top,
 * and the handle. Both sliders in the app (the report's and the explain
 * demos') are this plus their own marks, so the pointer handling lives here
 * once. `fill` is a CSS width, and the handle always sits at its end.
 */
export function Track({
  fill,
  onPos,
  children,
}: {
  fill: string;
  /** The 0..1 position under the pointer, on press and while dragging. */
  onPos: (pos: number) => void;
  /** Marks drawn between the fill and the handle. */
  children?: ReactNode;
}) {
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
        marginTop: 9,
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
          width: fill,
        }}
      />
      {children}
      <div
        style={{
          position: "absolute",
          top: 6,
          width: 11,
          height: 11,
          marginLeft: -5.5,
          borderRadius: 3,
          background: "#fff",
          boxShadow: "0 1px 6px rgba(0,0,0,0.6)",
          left: fill,
        }}
      />
    </div>
  );
}
