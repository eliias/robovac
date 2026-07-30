"use client";

import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { C, MONO, panel, panelHeader } from "@/components/ui";
import { fmtCompact, fmtDur, fmtInt } from "@/lib/core/format";
import { WRAP } from "@/lib/core/model";

function logPos(v: number, lo: number, hi: number): number {
  return (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo));
}

function SimpleSlider({ pct, onPos }: { pct: number; onPos: (p: number) => void }) {
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

export function FreezeDemo() {
  const [maxAge, setMaxAge] = useState(200000000);
  const [rate, setRate] = useState(40000000);

  const DAYS = 365;
  const W = 700;
  const H = 190;
  const period = maxAge / rate;

  let path = `M 0 ${H}`;
  let t = 0;
  let i = 0;
  while (t < DAYS && i < 500) {
    const t2 = Math.min(t + period, DAYS);
    const y = H - Math.min(1, (rate * (t2 - t)) / WRAP) * H;
    path += ` L ${((t2 / DAYS) * W).toFixed(1)} ${y.toFixed(1)}`;
    if (t2 < DAYS) path += ` L ${((t2 / DAYS) * W).toFixed(1)} ${H}`;
    t = t2;
    i++;
  }

  const maxY = H - (maxAge / WRAP) * H;
  const marginDays = (WRAP - maxAge) / rate;

  return (
    <div style={{ ...panel, marginTop: 28 }}>
      <div style={panelHeader}>
        <span style={{ fontFamily: MONO, fontSize: 11, color: C.strong, letterSpacing: "0.03em" }}>
          DEMO — xid age over 365 d, toy table
        </span>
        <span style={{ fontFamily: MONO, fontSize: 10, color: C.faint }}>
          same chart system as the report
        </span>
      </div>
      <div style={{ padding: "14px 12px" }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}
        >
          {[0.5, 63.5, 126.5].map((y) => (
            <line key={y} x1={0} y1={y} x2={W} y2={y} stroke={C.grid} />
          ))}
          <line x1={0} y1={H} x2={W} y2={H} stroke="rgba(255,255,255,0.18)" />
          <line
            x1={0}
            x2={W}
            y1={maxY}
            y2={maxY}
            stroke={C.warn}
            strokeWidth={1}
            strokeDasharray="3 3"
          />
          <path d={path} fill="none" stroke="#ffffff" strokeWidth={1.25} />
          <text x={4} y={12} fontFamily="IBM Plex Mono, monospace" fontSize={9.5} fill={C.dim}>
            2,147,483,647 (wraparound)
          </text>
          <text
            x={4}
            y={Math.max(22, maxY - 5)}
            fontFamily="IBM Plex Mono, monospace"
            fontSize={9.5}
            fill={C.warn}
          >
            freeze_max_age = {fmtInt(maxAge)}
          </text>
        </svg>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontFamily: MONO,
            fontSize: 9.5,
            color: C.faint,
            marginTop: 2,
          }}
        >
          <span>day 0</span>
          <span>90</span>
          <span>180</span>
          <span>270</span>
          <span>365</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginTop: 18 }}>
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontFamily: MONO,
                fontSize: 11.5,
                color: C.strong,
              }}
            >
              <span>autovacuum_freeze_max_age</span>
              <span style={{ color: "#fff" }}>{fmtInt(maxAge)}</span>
            </div>
            <SimpleSlider
              pct={logPos(maxAge, 1e8, 2e9) * 100}
              onPos={(p) => {
                const v =
                  Math.round(Math.exp(Math.log(1e8) + p * (Math.log(2e9) - Math.log(1e8))) / 1e6) *
                  1e6;
                setMaxAge(v);
              }}
            />
            <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.faint }}>
              default 200,000,000 · max 2,000,000,000
            </div>
          </div>
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontFamily: MONO,
                fontSize: 11.5,
                color: C.strong,
              }}
            >
              <span>xid consumption</span>
              <span style={{ color: "#fff" }}>{fmtCompact(rate)}/day</span>
            </div>
            <SimpleSlider
              pct={logPos(rate, 1e6, 4e8) * 100}
              onPos={(p) => {
                const v =
                  Math.round(Math.exp(Math.log(1e6) + p * (Math.log(4e8) - Math.log(1e6))) / 1e6) *
                  1e6;
                setRate(Math.max(1e6, v));
              }}
            />
            <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.faint }}>
              transactions per day, 1 M → 400 M
            </div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3,1fr)",
            gap: 1,
            background: C.border08,
            marginTop: 16,
          }}
        >
          <div style={{ background: C.panel, padding: "8px 10px" }}>
            <div style={{ fontFamily: MONO, fontSize: 9.5, color: C.faint }}>
              AGGRESSIVE VACUUM EVERY
            </div>
            <div style={{ fontFamily: MONO, fontSize: 13, color: "#fff", marginTop: 2 }}>
              {fmtDur(period)}
            </div>
          </div>
          <div style={{ background: C.panel, padding: "8px 10px" }}>
            <div style={{ fontFamily: MONO, fontSize: 9.5, color: C.faint }}>RUNS PER YEAR</div>
            <div style={{ fontFamily: MONO, fontSize: 13, color: "#fff", marginTop: 2 }}>
              {(365 / period).toFixed(1)}
            </div>
          </div>
          <div style={{ background: C.panel, padding: "8px 10px" }}>
            <div style={{ fontFamily: MONO, fontSize: 9.5, color: C.faint }}>
              MARGIN TO SHUTDOWN
            </div>
            <div
              style={{
                fontFamily: MONO,
                fontSize: 13,
                marginTop: 2,
                color: marginDays < 5 ? C.warn : "#fff",
              }}
            >
              {fmtDur(marginDays)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
