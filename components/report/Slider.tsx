"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import { TermLink } from "@/components/TermLink";
import { C, MONO } from "@/components/ui";
import { fmtVal, fromPos, toPos } from "@/lib/core/format";
import type { SettingDef } from "@/lib/core/settings";

export interface SliderProps {
  def: SettingDef;
  value: number;
  current: number;
  proposed: number;
  note: string;
  onChange: (v: number) => void;
}

export function Slider({ def, value, current, proposed, note, onChange }: SliderProps) {
  const pct = (v: number) => (toPos(def, v) * 100).toFixed(2) + "%";

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
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <TermLink slug={def.key} style={{ fontSize: 13 }}>
          {def.key}
        </TermLink>
        <div style={{ fontFamily: MONO, fontSize: 13.5, color: "#fff", whiteSpace: "nowrap" }}>
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
      <div style={{ display: "flex", gap: 16, fontFamily: MONO, fontSize: 10.5, color: C.faint }}>
        <span>default {fmtVal(def, def.def)}</span>
        <span>current {fmtVal(def, current)}</span>
        <span style={{ color: C.warn }}>proposed {fmtVal(def, proposed)}</span>
        <span style={{ marginLeft: "auto", color: C.ghost }}>{note}</span>
      </div>
    </div>
  );
}
