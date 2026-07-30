"use client";

import { useState } from "react";
import { logPos, SimpleSlider } from "@/components/explain/SimpleSlider";
import { C, MONO, panel, panelHeader } from "@/components/ui";
import { fmtSecs } from "@/lib/core/format";
import { runCost } from "@/lib/core/model";
import { defaultValues } from "@/lib/core/settings";

// Toy table: 14 GB heap, 1.74M pages, default page-cost mix.
const PAGES = 1_740_000;

export function CostDemo() {
  const [limit, setLimit] = useState(200);
  const [delay, setDelay] = useState(20);

  const cost = runCost(
    {
      ...defaultValues(),
      autovacuum_vacuum_cost_limit: limit,
      autovacuum_vacuum_cost_delay: delay,
    },
    PAGES,
  );
  const reference = runCost(
    { ...defaultValues(), autovacuum_vacuum_cost_limit: 200, autovacuum_vacuum_cost_delay: 2 },
    PAGES,
  );
  const maxSec = Math.max(cost.seconds, reference.seconds);

  return (
    <div style={{ ...panel, marginTop: 28 }}>
      <div style={panelHeader}>
        <span style={{ fontFamily: MONO, fontSize: 11, color: C.strong, letterSpacing: "0.03em" }}>
          DEMO — one vacuum pass, toy table
        </span>
        <span style={{ fontFamily: MONO, fontSize: 10, color: C.faint }}>
          14 GB heap · 1,740,000 pages
        </span>
      </div>
      <div style={{ padding: "14px 12px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontFamily: MONO,
                fontSize: 10.5,
                color: C.faint,
              }}
            >
              <span>defaults (200 · 2 ms)</span>
              <span style={{ color: C.muted }}>
                {fmtSecs(reference.seconds)} · {reference.mbps.toFixed(1)} MB/s
              </span>
            </div>
            <div style={{ height: 9, background: "rgba(255,255,255,0.06)", marginTop: 4 }}>
              <div
                style={{
                  height: 9,
                  background: "#5c5c63",
                  width: `${((reference.seconds / maxSec) * 100).toFixed(1)}%`,
                }}
              />
            </div>
          </div>
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontFamily: MONO,
                fontSize: 10.5,
                color: C.faint,
              }}
            >
              <span>sliders</span>
              <span style={{ color: "#fff" }}>
                {fmtSecs(cost.seconds)} · {cost.mbps.toFixed(1)} MB/s
              </span>
            </div>
            <div style={{ height: 9, background: "rgba(255,255,255,0.06)", marginTop: 4 }}>
              <div
                style={{
                  height: 9,
                  background: "#ffffff",
                  width: `${((cost.seconds / maxSec) * 100).toFixed(1)}%`,
                }}
              />
            </div>
          </div>
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
              <span>autovacuum_vacuum_cost_limit</span>
              <span style={{ color: "#fff" }}>{limit}</span>
            </div>
            <SimpleSlider
              pct={logPos(limit, 10, 10000) * 100}
              onPos={(p) => {
                const v = Math.exp(Math.log(10) + p * (Math.log(10000) - Math.log(10)));
                setLimit(v > 1000 ? Math.round(v / 100) * 100 : Math.round(v / 10) * 10);
              }}
            />
            <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.faint }}>
              cost units the worker may spend before it sleeps · default 200
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
              <span>autovacuum_vacuum_cost_delay</span>
              <span style={{ color: "#fff" }}>{delay} ms</span>
            </div>
            <SimpleSlider pct={delay} onPos={(p) => setDelay(Math.round(p * 100))} />
            <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.faint }}>
              how long it sleeps · default 2 ms since Postgres 12, 20 ms before
            </div>
          </div>
        </div>

        <div style={{ fontFamily: MONO, fontSize: 10, color: C.ghost, marginTop: 12 }}>
          cost = pages × (0.55·hit + 0.25·miss + 0.20·dirty) · duration = cost / limit × delay
        </div>
      </div>
    </div>
  );
}
