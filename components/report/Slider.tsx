"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import { TermLink } from "@/components/TermLink";
import { C, MONO } from "@/components/ui";
import { useViewport } from "@/components/useViewport";
import { fmtVal, fromPos, toPos } from "@/lib/core/format";
import type { SettingDef } from "@/lib/core/settings";

// One tap moves 3.5% of the track, then snaps through the same quantisation
// as a drag: a stepper can never land on a value a drag could not produce.
const STEP = 0.035;

export interface SliderProps {
  def: SettingDef;
  value: number;
  current: number;
  proposed: number;
  note: string;
  onChange: (v: number) => void;
}

export function Slider({ def, value, current, proposed, note, onChange }: SliderProps) {
  const { mobile } = useViewport();
  const pct = (v: number) => (toPos(def, v) * 100).toFixed(2) + "%";

  const step = (direction: -1 | 1) => {
    const p = Math.min(1, Math.max(0, toPos(def, value) + direction * STEP));
    onChange(fromPos(def, p));
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const apply = (clientX: number) => {
      const p = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      onChange(fromPos(def, p));
    };
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
    <div style={{ padding: "15px 0", borderBottom: `1px solid ${C.hair}` }}>
      {/* flex-wrap + min-width 0: a long mono identifier next to a nowrap value
          must wrap onto two lines instead of pushing the document wider. */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "2px 16px",
        }}
      >
        <TermLink slug={def.key} style={{ fontSize: 13, minWidth: 0, overflowWrap: "anywhere" }}>
          {def.key}
        </TermLink>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 13.5,
            color: "#fff",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
        >
          {fmtVal(def, value)}
          <span style={{ color: C.faint, fontSize: 11 }}> {def.unit}</span>
        </div>
      </div>
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
            width: pct(value),
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 4,
            width: 1,
            height: 16,
            background: C.ghost,
            left: pct(def.def),
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 2,
            width: 1,
            height: 20,
            background: C.dim,
            left: pct(current),
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 6,
            width: 1,
            height: 12,
            background: C.warn,
            left: pct(proposed),
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
            boxShadow: "0 1px 6px rgba(0,0,0,0.6)",
            left: pct(value),
          }}
        />
      </div>
      {mobile && (
        <div style={{ display: "flex", gap: 8, margin: "6px 0 4px" }}>
          {([-1, 1] as const).map((direction) => (
            <button
              key={direction}
              className="btn-secondary"
              onClick={() => step(direction)}
              aria-label={direction < 0 ? `decrease ${def.key}` : `increase ${def.key}`}
              style={{
                flex: 1,
                height: 40,
                fontFamily: MONO,
                fontSize: 16,
                color: C.muted,
                background: C.control,
                border: "1px solid rgba(255,255,255,0.11)",
                borderRadius: 3,
                cursor: "pointer",
              }}
            >
              {direction < 0 ? "−" : "+"}
            </button>
          ))}
        </div>
      )}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "2px 16px",
          fontFamily: MONO,
          fontSize: 10.5,
          color: C.faint,
        }}
      >
        <span>default {fmtVal(def, def.def)}</span>
        <span>current {fmtVal(def, current)}</span>
        <span style={{ color: C.warn }}>proposed {fmtVal(def, proposed)}</span>
        <span style={{ marginLeft: "auto", color: C.ghost }}>{note}</span>
      </div>
    </div>
  );
}
