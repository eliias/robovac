"use client";

import { useState } from "react";
import { SimpleSlider } from "@/components/explain/SimpleSlider";
import { C, MONO, panel, panelHeader } from "@/components/ui";
import { useViewport } from "@/components/useViewport";

// One heap page with 8 slots and 3 indexes on the toy table. An UPDATE that
// fits on the same page and touches no indexed column is HOT: no index writes.
const SLOTS = 8;
const INDEXES = 3;

interface Slot {
  state: "live" | "dead" | "free";
}

interface HotState {
  pages: Slot[][];
  hot: number;
  cold: number;
  indexWrites: number;
}

function freshPage(fillfactor: number): Slot[] {
  const filled = Math.max(1, Math.round((SLOTS * fillfactor) / 100));
  return Array.from({ length: SLOTS }, (_, i) => ({ state: i < filled ? "live" : "free" }));
}

function fresh(fillfactor: number): HotState {
  return { pages: [freshPage(fillfactor)], hot: 0, cold: 0, indexWrites: 0 };
}

const demoButton: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 11.5,
  color: C.body,
  background: C.control,
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 3,
  padding: "6px 9px",
  cursor: "pointer",
};

export function HotDemo() {
  const { mobile } = useViewport();
  const [fillfactor, setFillfactor] = useState(100);
  const [st, setSt] = useState<HotState>(() => fresh(100));

  const update = () =>
    setSt((prev) => {
      const pages = prev.pages.map((p) => p.map((s) => ({ ...s })));
      const last = pages[pages.length - 1];
      const liveIdx = last.findIndex((s) => s.state === "live");
      const freeIdx = last.findIndex((s) => s.state === "free");
      if (liveIdx >= 0 && freeIdx >= 0) {
        // HOT: old version dies in place, new version lands on the same page.
        last[liveIdx].state = "dead";
        last[freeIdx].state = "live";
        return { ...prev, pages, hot: prev.hot + 1 };
      }
      // Page full: the new version goes to a new page and every index gets a row.
      if (liveIdx >= 0) last[liveIdx].state = "dead";
      const next = freshPage(0).map((s, i) => ({ state: i === 0 ? "live" : "free" }) as Slot);
      pages.push(next);
      return { pages, hot: prev.hot, cold: prev.cold + 1, indexWrites: prev.indexWrites + INDEXES };
    });

  const vacuum = () =>
    setSt((prev) => ({
      ...prev,
      pages: prev.pages.map((p) => p.map((s) => (s.state === "dead" ? { state: "free" } : s))),
    }));

  const applyFillfactor = (ff: number) => {
    setFillfactor(ff);
    setSt(fresh(ff));
  };

  const total = st.hot + st.cold;

  return (
    <div style={{ ...panel, marginTop: 28 }}>
      <div style={panelHeader}>
        <span style={{ fontFamily: MONO, fontSize: 11, color: C.strong, letterSpacing: "0.03em" }}>
          DEMO — one heap page, {INDEXES} indexes
        </span>
        <span style={{ fontFamily: MONO, fontSize: 10, color: C.faint }}>
          {SLOTS} slots per page
        </span>
      </div>
      <div style={{ padding: "14px 12px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {st.pages.map((page, pi) => (
            <div
              key={pi}
              style={{
                display: "grid",
                gridTemplateColumns: mobile ? "repeat(4, 1fr)" : "repeat(8, 1fr)",
                gap: 6,
              }}
            >
              {page.map((slot, si) => (
                <div
                  key={si}
                  style={{
                    height: 34,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: MONO,
                    fontSize: 10,
                    border:
                      slot.state === "free"
                        ? `1px dashed rgba(255,255,255,0.14)`
                        : "1px solid transparent",
                    background:
                      slot.state === "live"
                        ? "rgba(255,255,255,0.14)"
                        : slot.state === "dead"
                          ? "rgba(255,255,255,0.04)"
                          : "transparent",
                    color:
                      slot.state === "live" ? C.strong : slot.state === "dead" ? C.ghost : C.ghost,
                    textDecoration: slot.state === "dead" ? "line-through" : "none",
                  }}
                >
                  {slot.state}
                </div>
              ))}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
          <button
            className="demo-btn"
            onClick={update}
            style={{ ...demoButton, minHeight: mobile ? 44 : undefined }}
          >
            UPDATE one row
          </button>
          <button
            className="btn-primary"
            onClick={vacuum}
            style={{
              fontFamily: MONO,
              fontSize: 11.5,
              color: C.bg,
              background: "#ededf0",
              border: "none",
              borderRadius: 3,
              padding: "6px 9px",
              cursor: "pointer",
              fontWeight: 500,
              minHeight: mobile ? 44 : undefined,
            }}
          >
            VACUUM
          </button>
          <button
            className="demo-btn-ghost"
            onClick={() => applyFillfactor(fillfactor)}
            style={{
              ...demoButton,
              color: C.dim,
              background: "transparent",
              border: `1px solid ${C.border}`,
              minHeight: mobile ? 44 : undefined,
            }}
          >
            reset
          </button>
        </div>

        <div style={{ marginTop: 16, maxWidth: 420 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontFamily: MONO,
              fontSize: 11.5,
              color: C.strong,
            }}
          >
            <span>fillfactor</span>
            <span style={{ color: "#fff" }}>{fillfactor}</span>
          </div>
          <SimpleSlider
            pct={((fillfactor - 50) / 50) * 100}
            onPos={(p) => applyFillfactor(50 + Math.round((p * 50) / 5) * 5)}
          />
          <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.faint }}>
            default 100 · below 100 leaves page space for HOT updates (resets the page)
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
            <div style={{ fontFamily: MONO, fontSize: 9.5, color: C.faint }}>HOT RATE</div>
            <div style={{ fontFamily: MONO, fontSize: 13, color: "#fff", marginTop: 2 }}>
              {total ? Math.round((st.hot / total) * 100) : 0}%
            </div>
          </div>
          <div style={{ background: C.panel, padding: "8px 10px" }}>
            <div style={{ fontFamily: MONO, fontSize: 9.5, color: C.faint }}>HEAP PAGES</div>
            <div style={{ fontFamily: MONO, fontSize: 13, color: "#fff", marginTop: 2 }}>
              {st.pages.length}
            </div>
          </div>
          <div style={{ background: C.panel, padding: "8px 10px" }}>
            <div style={{ fontFamily: MONO, fontSize: 9.5, color: C.faint }}>INDEX WRITES</div>
            <div
              style={{
                fontFamily: MONO,
                fontSize: 13,
                marginTop: 2,
                color: st.indexWrites > 0 ? C.warn : "#fff",
              }}
            >
              {st.indexWrites}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
