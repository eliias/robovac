"use client";

import { useState } from "react";
import { C, MONO, panel, panelHeader } from "@/components/ui";
import { useViewport } from "@/components/useViewport";

interface DemoRow {
  ctid: string;
  xmin: number;
  xmax: number | null;
  payload: string;
  id: number;
}

interface DemoState {
  xid: number;
  snapshotXid: number | null;
  rows: DemoRow[];
  nextCtid: number;
}

function freshDemo(): DemoState {
  return {
    xid: 4711,
    snapshotXid: null,
    rows: [
      { ctid: "(0,1)", xmin: 4702, xmax: null, payload: "'checkout'", id: 1 },
      { ctid: "(0,2)", xmin: 4703, xmax: null, payload: "'signup'", id: 2 },
      { ctid: "(0,3)", xmin: 4707, xmax: null, payload: "'refund'", id: 3 },
      { ctid: "(0,4)", xmin: 4710, xmax: null, payload: "'login'", id: 4 },
    ],
    nextCtid: 5,
  };
}

const demoButtonBase: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 11.5,
  color: C.body,
  background: C.control,
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 3,
  padding: "6px 9px",
  cursor: "pointer",
};

export function XminDemo() {
  const [dm, setDm] = useState<DemoState>(freshDemo);
  const { mobile } = useViewport();
  // 44pt minimum touch target on a phone.
  const demoButton = mobile ? { ...demoButtonBase, minHeight: 44 } : demoButtonBase;

  const horizon = dm.snapshotXid === null ? dm.xid : dm.snapshotXid;
  const live = dm.rows.filter((r) => r.xmax === null).length;
  const dead = dm.rows.length - live;

  let hint: string;
  if (dm.snapshotXid !== null) {
    hint = `A snapshot is open at xid ${dm.snapshotXid}. Versions deleted after it are held: vacuum cannot remove them, so n_dead_tup keeps rising. This is what a long-running query does to a busy table.`;
  } else if (dead > 0) {
    hint = `${dead} dead version(s) on disk. VACUUM removes them and the space is reusable by this table — the file does not shrink.`;
  } else {
    hint =
      "UPDATE writes a new version and stamps the old row’s xmax. Open a snapshot first to see vacuum blocked.";
  }

  const update = () =>
    setDm((st) => {
      const liveRows = st.rows.filter((r) => r.xmax === null);
      if (!liveRows.length) return st;
      const target = liveRows[0];
      const rows = st.rows.map((r) => (r === target ? { ...r, xmax: st.xid } : r));
      rows.push({
        ctid: `(0,${st.nextCtid})`,
        xmin: st.xid,
        xmax: null,
        payload: target.payload,
        id: target.id,
      });
      return { ...st, rows, xid: st.xid + 1, nextCtid: st.nextCtid + 1 };
    });

  const del = () =>
    setDm((st) => {
      const liveRows = st.rows.filter((r) => r.xmax === null);
      if (!liveRows.length) return st;
      const target = liveRows[liveRows.length - 1];
      const rows = st.rows.map((r) => (r === target ? { ...r, xmax: st.xid } : r));
      return { ...st, rows, xid: st.xid + 1 };
    });

  const snapshot = () =>
    setDm((st) => ({ ...st, snapshotXid: st.snapshotXid === null ? st.xid : null }));

  const vacuum = () =>
    setDm((st) => {
      const h = st.snapshotXid === null ? st.xid : st.snapshotXid;
      return {
        ...st,
        rows: st.rows.filter((r) => r.xmax === null || r.xmax >= h),
        xid: st.xid + 1,
      };
    });

  // Mobile drops the payload column: 4 columns fit 390pt, 5 do not.
  const cols = mobile ? "64px 64px 64px 1fr" : "64px 64px 64px 1fr 96px";

  return (
    <div style={{ ...panel, marginTop: 28 }}>
      <div style={panelHeader}>
        <span style={{ fontFamily: MONO, fontSize: 11, color: C.strong, letterSpacing: "0.03em" }}>
          DEMO — toy table, 4 rows
        </span>
        <span style={{ fontFamily: MONO, fontSize: 10, color: C.faint }}>next xid {dm.xid}</span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: mobile ? "minmax(0,1fr)" : "minmax(0,1fr) 232px",
          gap: 0,
        }}
      >
        <div style={{ padding: 12, borderRight: mobile ? undefined : `1px solid ${C.border08}` }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: cols,
              fontFamily: MONO,
              fontSize: 10,
              color: C.faint,
              paddingBottom: 6,
              borderBottom: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            <span>ctid</span>
            <span>xmin</span>
            <span>xmax</span>
            {!mobile && <span>payload</span>}
            <span style={{ textAlign: "right" }}>visibility</span>
          </div>
          {dm.rows.map((r) => {
            let state = "visible";
            let stateColor: string = C.strong;
            let color: string = C.code;
            let strike: "none" | "line-through" = "none";
            if (r.xmax !== null && r.xmax >= horizon) {
              state = "held";
              stateColor = C.warn;
              color = C.dim;
              strike = "line-through";
            } else if (r.xmax !== null) {
              state = "dead";
              stateColor = C.faint;
              color = C.faint;
              strike = "line-through";
            }
            return (
              <div
                key={r.ctid}
                style={{
                  display: "grid",
                  gridTemplateColumns: cols,
                  fontFamily: MONO,
                  fontSize: 12,
                  padding: "5px 0",
                  borderBottom: "1px solid rgba(255,255,255,0.05)",
                  color,
                }}
              >
                <span>{r.ctid}</span>
                <span>{r.xmin}</span>
                <span>{r.xmax === null ? "—" : r.xmax}</span>
                {!mobile && <span style={{ textDecoration: strike }}>{r.payload}</span>}
                <span style={{ textAlign: "right", color: stateColor }}>{state}</span>
              </div>
            );
          })}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
            <button className="demo-btn" onClick={update} style={demoButton}>
              UPDATE one row
            </button>
            <button className="demo-btn" onClick={del} style={demoButton}>
              DELETE one row
            </button>
            <button className="demo-btn" onClick={snapshot} style={demoButton}>
              {dm.snapshotXid === null ? "BEGIN (open snapshot)" : "COMMIT (close snapshot)"}
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
              onClick={() => setDm(freshDemo())}
              style={{
                ...demoButton,
                color: C.dim,
                background: "transparent",
                border: `1px solid ${C.border}`,
              }}
            >
              reset
            </button>
          </div>
        </div>
        <div
          style={{
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            borderTop: mobile ? `1px solid ${C.border08}` : undefined,
          }}
        >
          <div>
            <div style={{ fontFamily: MONO, fontSize: 9.5, color: C.faint }}>
              LIVE / DEAD TUPLES
            </div>
            <div style={{ fontFamily: MONO, fontSize: 14, color: "#fff", marginTop: 2 }}>
              {live} / {dead}
            </div>
          </div>
          <div>
            <div style={{ fontFamily: MONO, fontSize: 9.5, color: C.faint }}>
              HEAP VERSIONS ON DISK
            </div>
            <div style={{ fontFamily: MONO, fontSize: 14, color: "#fff", marginTop: 2 }}>
              {dm.rows.length}
            </div>
          </div>
          <div>
            <div style={{ fontFamily: MONO, fontSize: 9.5, color: C.faint }}>OPEN SNAPSHOT</div>
            <div
              style={{
                fontFamily: MONO,
                fontSize: 14,
                marginTop: 2,
                color: dm.snapshotXid === null ? C.dim : C.warn,
              }}
            >
              {dm.snapshotXid === null ? "none" : `xid ${dm.snapshotXid}`}
            </div>
          </div>
          <p
            style={{ margin: 0, fontFamily: MONO, fontSize: 10.5, lineHeight: 1.6, color: C.faint }}
          >
            {hint}
          </p>
        </div>
      </div>
    </div>
  );
}
