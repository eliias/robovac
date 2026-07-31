"use client";

import { C, MONO, panel, panelHeader } from "@/components/ui";
import { fmtCompact, fmtDur, fmtInt, fmtPeriod, fmtSecs } from "@/lib/core/format";
import {
  WRAP,
  daysToAggressive,
  passPages,
  runCost,
  sawPath,
  shutdownMarginDays,
  threshold,
} from "@/lib/core/model";
import type { Values } from "@/lib/core/settings";
import { hasMeasuredRate, rateState, type Snapshot } from "@/lib/core/snapshot";
import { UnavailableBody } from "./states";

const DANGER_START = 1600000000;

/** The reason the xid rate is unknown, or null when it is measured. */
function xidRateUnknown(snap: Snapshot): string | null {
  const rs = rateState(snap);
  if (rs === "reset") return "counters reset";
  if (rs === "single") return "needs 2 samples";
  return null;
}

function FrameTitle({ title, caption }: { title: string; caption: React.ReactNode }) {
  return (
    <div style={panelHeader}>
      <span style={{ fontFamily: MONO, fontSize: 11, color: C.strong, letterSpacing: "0.03em" }}>
        {title}
      </span>
      <span style={{ fontFamily: MONO, fontSize: 10, color: C.faint }}>{caption}</span>
    </div>
  );
}

function TwoCellStrip({ cells }: { cells: { label: string; value: string; color?: string }[] }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${cells.length}, 1fr)`,
        gap: 1,
        background: C.border08,
        marginTop: 10,
      }}
    >
      {cells.map((c) => (
        <div key={c.label} style={{ background: C.panel, padding: "7px 9px" }}>
          <div style={{ fontFamily: MONO, fontSize: 9.5, color: C.faint }}>{c.label}</div>
          <div
            style={{ fontFamily: MONO, fontSize: 12.5, color: c.color ?? C.muted, marginTop: 2 }}
          >
            {c.value}
          </div>
        </div>
      ))}
    </div>
  );
}

export function FigDeadTuples({ snap, values }: { snap: Snapshot; values: Values }) {
  const thrCur = threshold(snap.current, snap.live);
  const thrLive = threshold(values, snap.live);
  const zeroPeriod = hasMeasuredRate(snap) ? "no writes" : "unknown · one sample";
  const yMax = Math.max(thrCur, thrLive);
  const W = 496;
  const H = 172;
  const DAYS = 60;
  // D1/D3: without a rate there is no sawtooth. The frame and its figure
  // number stay so the reader learns the figure exists and why it is empty.
  const rs = rateState(snap);
  const unavailable = rs === "reset" || (rs === "single" && snap.deadPerDay === 0);
  if (unavailable) {
    return (
      <div style={panel}>
        <FrameTitle
          title="FIG. 1 — DEAD TUPLES, 60 d"
          caption={<span style={{ color: C.ghost }}>unavailable</span>}
        />
        <UnavailableBody>
          The sawtooth needs a write rate.
          <br />
          <span style={{ color: C.ghost }}>Fig. 2 and Fig. 3 render normally.</span>
        </UnavailableBody>
      </div>
    );
  }
  return (
    <div style={panel}>
      <FrameTitle title="FIG. 1 — DEAD TUPLES, 60 d" caption="sawtooth = vacuum fires" />
      <div style={{ padding: "12px 12px 8px" }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}
        >
          {[0.5, 43.5, 86.5, 129.5].map((y) => (
            <line key={y} x1={0} y1={y} x2={W} y2={y} stroke={C.grid} strokeWidth={1} />
          ))}
          <line x1={0} y1={H} x2={W} y2={H} stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
          <path
            d={sawPath(thrCur, snap.deadPerDay, DAYS, W, H, yMax)}
            fill="none"
            stroke="#5c5c63"
            strokeWidth={1}
            strokeDasharray="3 2"
          />
          <path
            d={sawPath(thrLive, snap.deadPerDay, DAYS, W, H, yMax)}
            fill="none"
            stroke="#ffffff"
            strokeWidth={1.25}
          />
          <line
            x1={0}
            x2={W}
            y1={H - (thrLive / yMax) * H}
            y2={H - (thrLive / yMax) * H}
            stroke={C.warn}
            strokeWidth={1}
            strokeDasharray="2 3"
          />
          <text x={2} y={10} fontFamily="IBM Plex Mono, monospace" fontSize={9} fill={C.dim}>
            {fmtCompact(yMax)} dead tup
          </text>
          <text x={2} y={168} fontFamily="IBM Plex Mono, monospace" fontSize={9} fill={C.dim}>
            0
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
        <TwoCellStrip
          cells={[
            {
              label: "CURRENT · dashed",
              value: `${fmtPeriod(thrCur / snap.deadPerDay, zeroPeriod)} · ${fmtCompact(thrCur)} peak`,
            },
            {
              label: "SLIDERS · solid",
              value: `${fmtPeriod(thrLive / snap.deadPerDay, zeroPeriod)} · ${fmtCompact(thrLive)} peak`,
              color: "#fff",
            },
          ]}
        />
      </div>
    </div>
  );
}

export function FigFreezeHorizon({ snap, values }: { snap: Snapshot; values: Values }) {
  const W = 496;
  const ageX = (snap.xidAge / WRAP) * W;
  const maxAgeX = (values.autovacuum_freeze_max_age / WRAP) * W;
  const tableAgeX = (values.vacuum_freeze_table_age / WRAP) * W;
  const dangerX = Math.min(W, (DANGER_START / WRAP) * W);
  const days = daysToAggressive(values.autovacuum_freeze_max_age, snap.xidAge, snap.xidPerDay);
  const nowX = Math.min(482, Math.max(12, ageX));
  const nowAnchor = ageX < 12 ? "start" : ageX > 482 ? "end" : "middle";

  const legendRows: {
    border: string;
    label: string;
    value: string;
    valueColor: string;
    opacity?: number;
  }[] = [
    {
      border: `1.5px solid ${C.strong}`,
      label: "relfrozenxid age, now",
      value: fmtInt(snap.xidAge),
      valueColor: C.strong,
    },
    {
      border: `1px solid ${C.dim}`,
      label: "vacuum_freeze_table_age",
      value: fmtInt(values.vacuum_freeze_table_age),
      valueColor: C.muted,
    },
    {
      border: `1.5px solid ${C.warn}`,
      label: "autovacuum_freeze_max_age",
      value: fmtInt(values.autovacuum_freeze_max_age),
      valueColor: C.warn,
    },
    {
      border: `1px solid ${C.warn}`,
      label: "wraparound limit",
      value: fmtInt(WRAP),
      valueColor: C.muted,
      opacity: 0.55,
    },
  ];

  return (
    <div style={panel}>
      <FrameTitle title="FIG. 2 — FREEZE HORIZON" caption="xid age, 0 → 2^31" />
      <div style={{ padding: "16px 12px 10px" }}>
        <svg
          viewBox={`0 0 ${W} 74`}
          style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}
        >
          <rect x={0} y={26} width={W} height={14} fill="rgba(255,255,255,0.05)" />
          <rect x={0} y={26} width={ageX} height={14} fill="rgba(255,255,255,0.14)" />
          <rect
            x={dangerX}
            y={26}
            width={W - dangerX}
            height={14}
            fill="oklch(0.70 0.10 62 / 0.22)"
          />
          <line x1={tableAgeX} x2={tableAgeX} y1={20} y2={46} stroke={C.dim} strokeWidth={1} />
          <line x1={maxAgeX} x2={maxAgeX} y1={16} y2={50} stroke={C.warn} strokeWidth={1.5} />
          <line x1={ageX} x2={ageX} y1={20} y2={46} stroke={C.strong} strokeWidth={1.5} />
          <line x1={495} x2={495} y1={12} y2={54} stroke={C.warn} strokeWidth={1} />
          <text
            x={nowX}
            y={12}
            fontFamily="IBM Plex Mono, monospace"
            fontSize={9}
            fill={C.strong}
            textAnchor={nowAnchor}
          >
            now
          </text>
          <text x={0} y={62} fontFamily="IBM Plex Mono, monospace" fontSize={9} fill={C.ghost}>
            0
          </text>
          <text
            x={W}
            y={62}
            fontFamily="IBM Plex Mono, monospace"
            fontSize={9}
            fill={C.ghost}
            textAnchor="end"
          >
            2^31
          </text>
        </svg>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 10 }}>
          {legendRows.map((r) => (
            <div
              key={r.label}
              style={{
                display: "grid",
                gridTemplateColumns: "14px minmax(0,1fr) auto",
                gap: 8,
                alignItems: "center",
                fontFamily: MONO,
                fontSize: 10.5,
              }}
            >
              <span style={{ height: 11, borderLeft: r.border, opacity: r.opacity }} />
              <span style={{ color: C.dim }}>{r.label}</span>
              <span style={{ color: r.valueColor }}>{r.value}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12 }}>
          <TwoCellStrip
            cells={
              // Both figures divide by the xid rate. Without one they read
              // as a dash with the reason, never as an exact-looking number.
              xidRateUnknown(snap)
                ? [
                    {
                      label: "AGGRESSIVE VACUUM IN",
                      value: `— · ${xidRateUnknown(snap)}`,
                      color: C.ghost,
                    },
                    {
                      label: "SHUTDOWN MARGIN",
                      value: `— · ${xidRateUnknown(snap)}`,
                      color: C.ghost,
                    },
                  ]
                : [
                    {
                      label: "AGGRESSIVE VACUUM IN",
                      value: days <= 0 ? "running now · age exceeds limit" : fmtDur(days),
                      color: days <= 0 ? C.warn : "#fff",
                    },
                    {
                      label: "SHUTDOWN MARGIN",
                      value: `${fmtDur(shutdownMarginDays(snap.xidAge, snap.xidPerDay))} of xids`,
                    },
                  ]
            }
          />
        </div>
      </div>
    </div>
  );
}

export function FigIoCost({ snap, values }: { snap: Snapshot; values: Values }) {
  const workPages = passPages(snap.pages, snap.allVisiblePages, snap.indexes);
  const cur = runCost(snap.current, workPages);
  const live = runCost(values, workPages);
  const maxSec = Math.max(cur.seconds, live.seconds);
  return (
    <div style={panel}>
      <FrameTitle
        title="FIG. 3 — I/O COST PER RUN"
        caption={
          <>
            cost-based delay model<sup style={{ fontSize: 8 }}>2</sup>
          </>
        }
      />
      <div style={{ padding: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {[
            { label: "current", cost: cur, color: "#5c5c63", valueColor: C.muted },
            { label: "sliders", cost: live, color: "#ffffff", valueColor: "#fff" },
          ].map((row) => (
            <div key={row.label}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontFamily: MONO,
                  fontSize: 10.5,
                  color: C.faint,
                }}
              >
                <span>{row.label}</span>
                <span style={{ color: row.valueColor }}>
                  {fmtSecs(row.cost.seconds)} · {row.cost.mbps.toFixed(1)} MB/s
                </span>
              </div>
              <div style={{ height: 9, background: "rgba(255,255,255,0.06)", marginTop: 4 }}>
                <div
                  style={{
                    height: 9,
                    background: row.color,
                    width: `${((row.cost.seconds / maxSec) * 100).toFixed(1)}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        <div style={{ fontFamily: MONO, fontSize: 10, color: C.ghost, marginTop: 10 }}>
          {fmtInt(snap.pages)} pages · {fmtInt(live.costUnits)} cost units per full pass
        </div>
      </div>
    </div>
  );
}
