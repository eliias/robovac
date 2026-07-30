"use client";

import { useState } from "react";
import { logPos, SimpleSlider } from "@/components/explain/SimpleSlider";
import { C, MONO, panel, panelHeader } from "@/components/ui";
import { fmtCompact, fmtDur, fmtInt } from "@/lib/core/format";
import { sawPath } from "@/lib/core/model";

// Toy table: 50M live rows, 2M dead rows per day.
const LIVE = 50_000_000;
const DEAD_PER_DAY = 2_000_000;

export function TriggerDemo() {
  const [scale, setScale] = useState(0.2);
  const [thresholdRows, setThresholdRows] = useState(50);

  const trigger = thresholdRows + scale * LIVE;
  const periodDays = trigger / DEAD_PER_DAY;
  const W = 700;
  const H = 190;

  return (
    <div style={{ ...panel, marginTop: 28 }}>
      <div style={panelHeader}>
        <span style={{ fontFamily: MONO, fontSize: 11, color: C.strong, letterSpacing: "0.03em" }}>
          DEMO — dead tuples over 60 d, toy table
        </span>
        <span style={{ fontFamily: MONO, fontSize: 10, color: C.faint }}>
          50M rows · 2M dead/day
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
            y1={H - (trigger / Math.max(trigger, 1)) * H}
            y2={H - (trigger / Math.max(trigger, 1)) * H}
            stroke={C.warn}
            strokeWidth={1}
            strokeDasharray="3 3"
          />
          <path
            d={sawPath(trigger, DEAD_PER_DAY, 60, W, H, trigger)}
            fill="none"
            stroke="#ffffff"
            strokeWidth={1.25}
          />
          <text x={4} y={12} fontFamily="IBM Plex Mono, monospace" fontSize={9.5} fill={C.warn}>
            trigger = {fmtCompact(trigger)} dead tuples
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
          <span>15</span>
          <span>30</span>
          <span>45</span>
          <span>60</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 18, marginTop: 18 }}>
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
              <span>autovacuum_vacuum_scale_factor</span>
              <span style={{ color: "#fff" }}>{scale.toPrecision(2)}</span>
            </div>
            <SimpleSlider
              pct={logPos(scale, 0.001, 0.4) * 100}
              onPos={(p) =>
                setScale(
                  Number(
                    Math.exp(Math.log(0.001) + p * (Math.log(0.4) - Math.log(0.001))).toPrecision(
                      2,
                    ),
                  ),
                )
              }
            />
            <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.faint }}>
              default 0.2 · 0 decouples the trigger from table size
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
              <span>autovacuum_vacuum_threshold</span>
              <span style={{ color: "#fff" }}>{fmtInt(thresholdRows)}</span>
            </div>
            <SimpleSlider
              pct={logPos(Math.max(50, thresholdRows), 50, 5_000_000) * 100}
              onPos={(p) => {
                const v = Math.exp(Math.log(50) + p * (Math.log(5_000_000) - Math.log(50)));
                setThresholdRows(
                  v > 1e6
                    ? Math.round(v / 1e6) * 1e6
                    : v > 1000
                      ? Math.round(v / 100) * 100
                      : Math.round(v),
                );
              }}
            />
            <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.faint }}>
              default 50 · the fixed floor
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
            <div style={{ fontFamily: MONO, fontSize: 9.5, color: C.faint }}>VACUUM EVERY</div>
            <div style={{ fontFamily: MONO, fontSize: 13, color: "#fff", marginTop: 2 }}>
              {fmtDur(periodDays)}
            </div>
          </div>
          <div style={{ background: C.panel, padding: "8px 10px" }}>
            <div style={{ fontFamily: MONO, fontSize: 9.5, color: C.faint }}>PEAK DEAD ROWS</div>
            <div style={{ fontFamily: MONO, fontSize: 13, color: "#fff", marginTop: 2 }}>
              {fmtCompact(trigger)}
            </div>
          </div>
          <div style={{ background: C.panel, padding: "8px 10px" }}>
            <div style={{ fontFamily: MONO, fontSize: 9.5, color: C.faint }}>PEAK BLOAT</div>
            <div
              style={{
                fontFamily: MONO,
                fontSize: 13,
                marginTop: 2,
                color: trigger / LIVE > 0.1 ? C.warn : "#fff",
              }}
            >
              {((trigger / LIVE) * 100).toFixed(1)}%
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
