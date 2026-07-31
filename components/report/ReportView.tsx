"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ActionBar } from "@/components/report/ActionBar";
import { TermLink } from "@/components/TermLink";
import { useViewport } from "@/components/useViewport";
import { C, MONO, SANS, primaryButton, secondaryButton } from "@/components/ui";
import { CodecError, decodeReport, encodeReport, type ReportPayload } from "@/lib/core/codec";
import { fmtCadence, fmtCompact, fmtDur, fmtInt, fmtSecs, fmtVal } from "@/lib/core/format";
import { passPages, runCost, threshold } from "@/lib/core/model";
import { optimize } from "@/lib/core/optimize";
import { SETTINGS, settingsByGroup, type Group, type Values } from "@/lib/core/settings";
import { hasMeasuredRate, isSmallTable, rateState, type Snapshot } from "@/lib/core/snapshot";
import { NoticeBar, UnknownValue } from "./states";
import { useClipboard, selectContents } from "@/components/useClipboard";
import { ErrorState } from "./ErrorState";
import { FigDeadTuples, FigFreezeHorizon, FigIoCost } from "./Figures";
import { buildSql, OutputPanel } from "./OutputPanel";
import { insertPeriodDays } from "@/packages/robovac-mcp/src/report";
import { Slider } from "./Slider";

const GROUPS: { id: Group; title: string; jobLine: string }[] = [
  { id: "trigger", title: "TRIGGER", jobLine: "when a worker starts on this table" },
  { id: "cost", title: "COST", jobLine: "how fast the worker is allowed to go" },
  { id: "freeze", title: "FREEZE", jobLine: "when old rows get frozen against wraparound" },
];

function sup(n: number) {
  return <sup style={{ fontFamily: MONO, fontSize: 9.5, color: C.faint }}>{n}</sup>;
}

function num(text: string) {
  return <span style={{ fontFamily: MONO }}>{text}</span>;
}

const demoLinkStyle = {
  fontFamily: MONO,
  fontSize: 11,
  borderBottom: "1px dotted #45454c",
  cursor: "pointer",
} as const;

function agoLabel(snap: Snapshot): string {
  if (!snap.lastAutovacuum) return "never";
  const ms = Math.max(0, Date.parse(snap.capturedAt) - Date.parse(snap.lastAutovacuum));
  const totalHours = Math.floor(ms / 3600000);
  const d = Math.floor(totalHours / 24);
  const h = totalHours % 24;
  if (d > 0) return `${d} d ${String(h).padStart(2, "0")} h ago`;
  if (totalHours > 0) return `${h} h ago`;
  const min = Math.floor(ms / 60000);
  if (min > 0) return `${min} min ago`;
  return `${Math.max(1, Math.round(ms / 1000))} s ago`;
}

function snapshotLabel(snap: Snapshot): string {
  const t = new Date(snap.capturedAt);
  return t.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

export function ReportView() {
  const [payload, setPayload] = useState<ReportPayload | null>(null);
  const [error, setError] = useState<CodecError | null>(null);
  const [values, setValues] = useState<Values | null>(null);
  const [open, setOpen] = useState<Record<Group, boolean>>({
    trigger: true,
    cost: true,
    freeze: true,
  });
  const [copied, setCopied] = useState(false);
  const { narrow, mobile } = useViewport();
  const { canCopy } = useClipboard();
  const userChanged = useRef(false);

  useEffect(() => {
    // Set once from the initial viewport: on a phone only TRIGGER starts open.
    // Never re-collapse on rotate.
    if (window.innerWidth < 720) setOpen({ trigger: true, cost: false, freeze: false });
    try {
      const p = decodeReport(window.location.hash);
      setPayload(p);
      const merged: Values = { ...p.snap.current };
      for (const [key, v] of Object.entries(p.tuned ?? {})) {
        if (v !== undefined) merged[key] = v;
      }
      setValues(merged);
    } catch (e) {
      setError(e instanceof CodecError ? e : new CodecError("invalid", [String(e)]));
    }
  }, []);

  useEffect(() => {
    if (!payload || !values || !userChanged.current) return;
    const tuned: Partial<Values> = {};
    for (const d of SETTINGS) {
      if (values[d.key] !== payload.snap.current[d.key]) tuned[d.key] = values[d.key];
    }
    history.replaceState(null, "", "#" + encodeReport({ snap: payload.snap, tuned }));
  }, [payload, values]);

  // Success is reported only after the write resolves. Without clipboard
  // access (E1) or on rejection, select the SQL block instead so the reader
  // copies it themselves. Never show "copied" for an empty clipboard.
  const copySql = async (sql: string) => {
    if (canCopy) {
      try {
        await navigator.clipboard.writeText(sql);
        setCopied(true);
        return;
      } catch {
        /* fall through to select */
      }
    }
    selectContents(document.getElementById("output-sql"));
  };

  const setAll = (next: Values) => {
    userChanged.current = true;
    setCopied(false);
    setValues(next);
  };

  const derived = useMemo(() => {
    if (!payload || !values) return null;
    const snap = payload.snap;
    const thrCur = threshold(snap.current, snap.live);
    const thrLive = threshold(values, snap.live);
    return {
      snap,
      thrCur,
      thrLive,
      periodCur: thrCur / snap.deadPerDay,
      periodLive: thrLive / snap.deadPerDay,
      costCur: runCost(snap.current, passPages(snap.pages, snap.allVisiblePages, snap.indexes)),
      costLive: runCost(values, passPages(snap.pages, snap.allVisiblePages, snap.indexes)),
      aggressiveNow: snap.xidAge > snap.current.autovacuum_freeze_max_age,
      bytesPerRow: (snap.pages * 8192) / Math.max(1, snap.live),
      analysis: optimize(snap),
    };
  }, [payload, values]);

  if (error) return <ErrorState error={error} />;
  if (!payload || !values || !derived) return null;

  const { snap, thrCur, periodCur, periodLive, costCur, costLive, aggressiveNow } = derived;
  // Zero rate has two causes with different copy: a real interval without
  // writes (measured zero), or a single statistics read (no rate at all).
  const measured = hasMeasuredRate(snap);
  const zeroCadence = measured ? "never · no writes observed" : "every unknown · one sample";

  // The degraded states (D1-D6). A missing input degrades the report, it
  // does not replace it: unknown figures read as a dash with the reason,
  // never as a zero a DBA would believe.
  const rState = rateState(snap);
  const ratesUnknown = rState === "reset" || (rState === "single" && snap.deadPerDay === 0);
  const estimated = rState === "noisy";
  const unknownReason = rState === "reset" ? "counters reset" : "needs 2 samples";
  const small = isSmallTable(snap);
  // On insert-heavy tables the insert trigger fires long before the
  // dead-side one; the header cadence uses whichever comes first.
  const insPeriod = ratesUnknown ? null : insertPeriodDays(snap);
  const insDriven =
    insPeriod && insPeriod.days < (Number.isFinite(periodCur) ? periodCur : Infinity)
      ? insPeriod
      : null;
  const ageDays = (Date.now() - Date.parse(snap.capturedAt)) / 86400000;
  const stale = ageDays > 7;
  const neverVacuumed = !snap.lastAutovacuum && !snap.lastVacuum;
  const optimizeDisabled = estimated
    ? `rates from a ${fmtSecs(snap.sampleSeconds ?? 0)} interval are noise, not a basis for proposals`
    : small
      ? "no changes recommended for a table this size"
      : null;
  const gridCols = narrow ? "minmax(0,1fr)" : "minmax(0,1fr) 520px";
  const bandGap = mobile ? 24 : 48;
  const pending = SETTINGS.filter((d) => values[d.key] !== snap.proposed[d.key]).length;

  const note = (key: string): string => {
    if (key === "autovacuum_vacuum_scale_factor") {
      return `${fmtCompact(threshold(snap.proposed, snap.live))} dead rows at trigger`;
    }
    if (key === "autovacuum_freeze_max_age" && snap.xidAge > values.autovacuum_freeze_max_age) {
      return "currently exceeded";
    }
    return SETTINGS.find((d) => d.key === key)?.note ?? "";
  };

  const groupSummary = (g: Group): string => {
    if (open[g]) return GROUPS.find((x) => x.id === g)!.jobLine;
    if (g === "trigger") return `vacuum ${fmtCadence(periodLive, zeroCadence)}`;
    if (g === "cost")
      return `${costLive.mbps.toFixed(1)} MB/s · ${fmtSecs(costLive.seconds)} per pass`;
    return `freeze_max_age ${fmtCompact(values.autovacuum_freeze_max_age)}`;
  };

  const statCells: { label: string; value: React.ReactNode; color?: string }[] = [
    { label: "DATABASE", value: snap.db },
    {
      label: "HEAP SIZE",
      value: (
        <>
          {((snap.pages * 8192) / 1e9).toFixed(1)} GB
          <span style={{ color: C.faint, fontSize: 11 }}> / {fmtInt(snap.pages)} pg</span>
        </>
      ),
    },
    { label: "SNAPSHOT", value: snapshotLabel(snap) },
    { label: "n_live_tup", value: fmtInt(snap.live) },
    {
      label: "n_dead_tup",
      value: (
        <>
          {fmtInt(snap.dead)}
          <span style={{ color: C.faint, fontSize: 11 }}>
            {" "}
            / {((snap.dead / Math.max(1, snap.live)) * 100).toFixed(2)}%
          </span>
        </>
      ),
    },
    { label: "last_autovacuum", value: agoLabel(snap) },
    {
      label: "DEAD RATE",
      value: ratesUnknown ? (
        <UnknownValue reason={unknownReason} />
      ) : (
        <>
          {(snap.deadPerDay / 86400).toFixed(1)}
          <span style={{ color: C.faint, fontSize: 11 }}> tup/s{estimated && " · est."}</span>
        </>
      ),
    },
    { label: "XID AGE", value: fmtInt(snap.xidAge), color: C.warn },
    {
      label: "XID RATE",
      value: ratesUnknown ? (
        <UnknownValue reason={unknownReason} />
      ) : (
        <>
          {(snap.xidPerDay / 1e6).toFixed(1)}
          <span style={{ color: C.faint, fontSize: 11 }}> M/day{estimated && " · est."}</span>
        </>
      ),
    },
  ];

  return (
    <div
      style={{ maxWidth: 1380, margin: "0 auto", padding: mobile ? "0 16px 128px" : "0 24px 96px" }}
    >
      {snap.demo && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "8px 16px",
            marginTop: 16,
            padding: "9px 12px",
            border: `1px solid ${C.border}`,
            background: C.panel,
          }}
        >
          <span style={{ fontFamily: MONO, fontSize: 11, color: C.muted }}>
            Demo snapshot:{" "}
            <a href="/demo" className="term-link" style={{ color: C.strong, ...demoLinkStyle }}>
              one of five shapes
            </a>
            , not your table.
          </span>
          <a href="/" className="term-link" style={{ ...demoLinkStyle, color: C.strong }}>
            build one from your own table →
          </a>
        </div>
      )}

      {/* Degraded-state notices (D1-D6): the report renders below them. */}
      {(ratesUnknown || estimated || stale || small || neverVacuumed) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 16 }}>
          {rState === "reset" && snap.countersReset && (
            <NoticeBar
              severity="neutral"
              title="Counters went backwards. Rates unknown."
              body={
                <>
                  <span style={{ fontFamily: MONO, color: C.strong }}>
                    {snap.countersReset.counter}
                  </span>{" "}
                  fell from {fmtInt(snap.countersReset.first)} to{" "}
                  {fmtInt(snap.countersReset.second)} between the two samples, so pg_stat_reset()
                  ran, the server restarted, or the two samples came from different servers.
                  Everything not derived from a rate is still exact.
                </>
              }
              action={{ label: "take two fresh samples", href: "/" }}
            />
          )}
          {rState === "single" && ratesUnknown && (
            <NoticeBar
              severity="neutral"
              title="One sample. Rates unknown."
              body="Dead-tuple rate, xid consumption rate, and everything derived from them (days to the next vacuum, days to the freeze limit, shutdown margin) need two readings. Thresholds, sizes, current settings and the proposed values below are computed from this one."
              action={{ label: "add a second sample", href: "/" }}
            />
          )}
          {estimated && (
            <NoticeBar
              severity="neutral"
              title={`${fmtSecs(snap.sampleSeconds ?? 0)} between samples. Rates are noise.`}
              body="At this interval a single checkpoint or one background job dominates the delta. Run the query again 30-60 s apart; the rates shown until then are marked estimated and are not used for the proposals."
              action={{ label: "re-run the query", href: "/" }}
            />
          )}
          {stale && (
            <NoticeBar
              severity="neutral"
              title={`Snapshot is ${Math.floor(ageDays)} days old.`}
              body={
                <>
                  Figures below describe the table as of {snapshotLabel(snap)}.
                  {!ratesUnknown && !estimated && (
                    <>
                      {" "}
                      At the write rate it recorded, xid age has since advanced by roughly{" "}
                      {fmtCompact(Math.round(ageDays * snap.xidPerDay))}
                      {snap.xidAge + ageDays * snap.xidPerDay >
                        snap.proposed.autovacuum_freeze_max_age &&
                        ", past the freeze limit this report proposes"}
                      .
                    </>
                  )}
                </>
              }
              action={{ label: "re-run the query", href: "/" }}
            />
          )}
          {small && (
            <NoticeBar
              severity="neutral"
              title={`${fmtInt(snap.live)} live rows. The defaults are correct here.`}
              body="At this size autovacuum fires on the 50-row floor long before any scale factor matters, and a full pass costs under a second. Nothing on this table is worth changing. The sliders and charts below are live if you want to see why."
              action={{ label: "snapshot another table", href: "/" }}
            />
          )}
          {neverVacuumed &&
            (snap.autovacuumOff ? (
              <NoticeBar
                severity="neutral"
                title="Autovacuum is off for this table."
                body="reloptions carry autovacuum_enabled = false. That is the answer, not a hint: nothing below runs until it is enabled again."
              />
            ) : (
              <NoticeBar
                severity="neutral"
                title="Autovacuum has never run on this table."
                body="Either the table has not yet reached its trigger threshold, autovacuum is off for it in reloptions, or statistics were reset since the last run. The first is expected on a young table; the second is shown in the trigger group below."
              />
            ))}
        </div>
      )}

      {/* Band A: header */}
      <div
        style={{
          display: "grid",
          gap: bandGap,
          padding: "36px 0 28px",
          borderBottom: `1px solid ${C.border08}`,
          gridTemplateColumns: gridCols,
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span
              style={{ fontFamily: MONO, fontSize: 11, color: C.faint, letterSpacing: "0.04em" }}
            >
              TABLE
            </span>
            <span
              style={{
                fontFamily: MONO,
                fontSize: 10.5,
                color: C.dim,
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 3,
                padding: "1px 5px",
              }}
            >
              pattern · {derived.analysis.pattern.name}
            </span>
          </div>
          <h1
            style={{
              fontFamily: MONO,
              fontSize: mobile ? 23 : 30,
              wordBreak: "break-word",
              fontWeight: 500,
              letterSpacing: "-0.01em",
              color: "#fff",
              margin: "6px 0 0",
            }}
          >
            {snap.table}
          </h1>
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              marginTop: 18,
              maxWidth: 560,
            }}
          >
            <span
              style={{
                flex: "none",
                marginTop: 5,
                width: 7,
                height: 7,
                background: C.warn,
                borderRadius: "50%",
              }}
            />
            <p
              style={{
                margin: 0,
                fontFamily: SANS,
                fontSize: 15,
                lineHeight: 1.5,
                color: "#ededf0",
              }}
            >
              {rState === "reset" && snap.countersReset ? (
                <>
                  {num(snap.countersReset.counter)} fell between the two samples, so rates are
                  unknown. The trigger sits at {num(fmtCompact(thrCur))} dead tuples
                </>
              ) : insDriven ? (
                <>
                  Insert-driven autovacuum fires every {num(fmtDur(insDriven.days))} at the observed
                  insert rate. The table reaches {num(fmtCompact(insDriven.threshold))} inserted
                  rows before each run
                </>
              ) : Number.isFinite(periodCur) && periodCur > 0 ? (
                <>
                  Autovacuum fires every {num(fmtDur(periodCur))}
                  {estimated && num(" (est.)")} at the observed write rate. The table reaches{" "}
                  {num(fmtCompact(thrCur))} dead tuples before each run
                </>
              ) : measured ? (
                <>
                  No writes landed in the {num(fmtSecs(snap.sampleSeconds!))} between the two
                  samples, so autovacuum never fires on dead tuples at this rate. The trigger sits
                  at {num(fmtCompact(thrCur))} dead tuples
                </>
              ) : (
                <>
                  Autovacuum fires every {num("unknown · one sample")} at the observed write rate.
                  The table reaches {num(fmtCompact(thrCur))} dead tuples before each run
                </>
              )}
              {aggressiveNow ? (
                <>
                  , and relfrozenxid age is past {num("autovacuum_freeze_max_age")}, so every run is
                  aggressive.
                </>
              ) : (
                "."
              )}
            </p>
          </div>
          {derived.analysis.warnings.length > 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 5,
                marginTop: 12,
                maxWidth: 560,
              }}
            >
              {derived.analysis.warnings.map((w, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: 8,
                    paddingLeft: 9,
                    borderLeft: `1px solid ${C.warn}`,
                    fontFamily: MONO,
                    fontSize: 10.5,
                    lineHeight: 1.6,
                    color: C.dim,
                  }}
                >
                  {w}
                </div>
              ))}
            </div>
          )}
        </div>
        <div
          style={{
            display: "grid",
            gap: 1,
            background: C.border08,
            border: `1px solid ${C.border08}`,
            gridTemplateColumns: narrow ? "repeat(2,1fr)" : "repeat(3,1fr)",
          }}
        >
          {statCells.map((cell) => (
            <div key={cell.label} style={{ background: C.cell, padding: "10px 12px" }}>
              <div
                style={{ fontFamily: MONO, fontSize: 10, color: C.faint, letterSpacing: "0.03em" }}
              >
                {cell.label}
              </div>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 13.5,
                  color: cell.color ?? C.strong,
                  marginTop: 3,
                }}
              >
                {cell.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Band B: reading + actions */}
      <div
        style={{
          display: "grid",
          gap: bandGap,
          padding: "22px 0 26px",
          borderBottom: `1px solid ${C.border08}`,
          gridTemplateColumns: gridCols,
        }}
      >
        <p
          style={{
            margin: 0,
            maxWidth: 760,
            fontFamily: SANS,
            fontSize: 14.5,
            lineHeight: 1.65,
            color: C.muted,
          }}
        >
          {rState === "reset" ? (
            <>
              No rate survives a counter reset. Run the query twice, 30-60 s apart, and the rates,
              cadences, and proposals sharpen.
            </>
          ) : snap.deadPerDay > 0 ? (
            <>
              The table takes {(snap.deadPerDay / 86400).toFixed(1)} dead tuples per second, or{" "}
              {fmtInt(snap.deadPerDay)} per day.
            </>
          ) : measured ? (
            <>
              No writes landed in the {fmtSecs(snap.sampleSeconds!)} between the two statistics
              reads: the measured write rate is zero, and dead tuples do not accumulate. Only the
              freeze schedule matters here.
            </>
          ) : (
            <>
              The write rate is unknown: this snapshot is a single sample. Run the query twice,
              30-60 s apart, and the rates, cadences, and proposals sharpen.
            </>
          )}
          {sup(1)} With{" "}
          <TermLink slug="autovacuum_vacuum_scale_factor" style={{ fontSize: 13.5 }}>
            autovacuum_vacuum_scale_factor
          </TermLink>{" "}
          at {fmtVal({ fmt: "frac" }, snap.current.autovacuum_vacuum_scale_factor)}, the trigger
          sits at {fmtInt(thrCur)} dead tuples
          {snap.deadPerDay > 0 && <>, which this workload needs {fmtDur(periodCur)} to reach</>}.
          Each run then rewrites a table that carries roughly{" "}
          {((thrCur * derived.bytesPerRow) / 1e9).toFixed(1)} GB of dead space, at{" "}
          <TermLink slug="autovacuum_vacuum_cost_delay" style={{ fontSize: 13.5 }}>
            autovacuum_vacuum_cost_delay
          </TermLink>{" "}
          = {fmtInt(snap.current.autovacuum_vacuum_cost_delay)} ms, which throttles the worker to{" "}
          {costCur.mbps.toFixed(1)} MB/s and holds it on the table for {fmtSecs(costCur.seconds)}.
          {sup(2)}
          {aggressiveNow && (
            <>
              {" "}
              Separately, relfrozenxid age is {fmtInt(snap.xidAge)}, above{" "}
              <TermLink slug="autovacuum_freeze_max_age" style={{ fontSize: 13.5 }}>
                autovacuum_freeze_max_age
              </TermLink>{" "}
              = {fmtInt(snap.current.autovacuum_freeze_max_age)}, so autovacuum currently runs in
              aggressive mode and cannot be cancelled by a conflicting lock request. The two
              problems compound: aggressive runs read every unfrozen page while the cost limit keeps
              the worker at {costCur.mbps.toFixed(1)} MB/s.
            </>
          )}{" "}
          {snap.deadPerDay > 0 ? (
            <>
              Proposed settings below fire vacuum every{" "}
              {fmtDur(threshold(snap.proposed, snap.live) / snap.deadPerDay)} and move the freeze
              work off the wraparound path.
            </>
          ) : (
            <>Proposed settings below move the freeze work off the wraparound path.</>
          )}
          {derived.analysis.diagnosis && (
            <>
              {" "}
              <span style={{ color: C.strong }}>{derived.analysis.diagnosis}</span>
            </>
          )}
          {derived.analysis.companions.fillfactorNote && (
            <>
              {" "}
              <span style={{ color: C.strong }}>{derived.analysis.companions.fillfactorNote}</span>
            </>
          )}
          {derived.analysis.companions.partitionNote && (
            <> {derived.analysis.companions.partitionNote}</>
          )}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignSelf: "start" }}>
          <button
            className="btn-primary"
            onClick={() => setAll({ ...snap.proposed })}
            disabled={Boolean(optimizeDisabled)}
            style={{
              ...primaryButton,
              textAlign: "left",
              ...(optimizeDisabled
                ? { background: C.control, color: C.faint, cursor: "default" }
                : {}),
            }}
          >
            {optimizeDisabled
              ? "auto-optimize · disabled"
              : pending === 0
                ? "✓ all sliders sit at the proposed values"
                : `→ auto-optimize · apply ${pending} proposed value${pending === 1 ? "" : "s"}`}
          </button>
          {optimizeDisabled && (
            <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.faint, lineHeight: 1.6 }}>
              {optimizeDisabled}
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn-secondary"
              onClick={() => setAll({ ...snap.current })}
              style={{ ...secondaryButton, flex: 1 }}
            >
              reset to current
            </button>
            <button
              className="btn-secondary"
              onClick={() => {
                const v: Values = {};
                for (const d of SETTINGS) v[d.key] = d.def;
                setAll(v);
              }}
              style={{ ...secondaryButton, flex: 1 }}
            >
              reset to pg defaults
            </button>
          </div>
        </div>
      </div>

      {/* Band C: controls + charts */}
      <div
        style={{
          display: "grid",
          gap: bandGap,
          alignItems: "start",
          paddingTop: 26,
          gridTemplateColumns: gridCols,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 30 }}>
          {GROUPS.map((g) => {
            const defs = settingsByGroup(g.id);
            return (
              <div key={g.id}>
                <div
                  className="group-header"
                  onClick={() => setOpen((o) => ({ ...o, [g.id]: !o[g.id] }))}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 12,
                    borderBottom: `1px solid ${C.borderStrong}`,
                    paddingBottom: 7,
                    cursor: "pointer",
                    userSelect: "none",
                  }}
                >
                  <h2
                    style={{
                      margin: 0,
                      display: "flex",
                      alignItems: "baseline",
                      gap: 8,
                      fontFamily: MONO,
                      fontSize: 12,
                      fontWeight: 600,
                      letterSpacing: "0.06em",
                      color: "#fff",
                    }}
                  >
                    <span style={{ display: "inline-block", width: 9, color: C.dim }}>
                      {open[g.id] ? "−" : "+"}
                    </span>
                    {g.title}
                    <span
                      style={{ fontWeight: 400, letterSpacing: 0, color: C.ghost, fontSize: 10.5 }}
                    >
                      {defs.length} settings
                    </span>
                  </h2>
                  <span
                    style={{ fontFamily: MONO, fontSize: 10.5, color: C.faint, textAlign: "right" }}
                  >
                    {groupSummary(g.id)}
                  </span>
                </div>
                {open[g.id] &&
                  defs.map((d) => (
                    <Slider
                      key={d.key}
                      def={d}
                      value={values[d.key]}
                      current={snap.current[d.key]}
                      proposed={snap.proposed[d.key]}
                      note={note(d.key)}
                      onChange={(v) => setAll({ ...values, [d.key]: v })}
                    />
                  ))}
              </div>
            );
          })}

          <div
            style={{
              display: "flex",
              gap: 22,
              alignItems: "center",
              flexWrap: "wrap",
              fontFamily: MONO,
              fontSize: 10.5,
              color: C.faint,
              paddingTop: 2,
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                style={{ width: 1, height: 12, background: C.ghost, display: "inline-block" }}
              />
              postgres default
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 1, height: 12, background: C.dim, display: "inline-block" }} />
              current on this table
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 1, height: 12, background: C.warn, display: "inline-block" }} />
              robovac proposal
            </span>
            <span style={{ display: "flex", gap: 10, marginLeft: "auto" }}>
              <a
                onClick={() => setOpen({ trigger: false, cost: false, freeze: false })}
                style={{ cursor: "pointer", borderBottom: "1px dotted #35353c" }}
              >
                collapse all
              </a>
              <a
                onClick={() => setOpen({ trigger: true, cost: true, freeze: true })}
                style={{ cursor: "pointer", borderBottom: "1px dotted #35353c" }}
              >
                expand all
              </a>
            </span>
          </div>
        </div>

        {/* order: -1 on mobile, not a DOM reorder: the first screen answers the
            question before it offers thirteen knobs, while source order stays
            the reading order for assistive tech. */}
        <div
          style={{
            top: 70,
            display: "flex",
            flexDirection: "column",
            gap: 16,
            position: narrow ? "static" : "sticky",
            order: mobile ? -1 : undefined,
          }}
        >
          <FigDeadTuples snap={snap} values={values} />
          <FigFreezeHorizon snap={snap} values={values} />
          <FigIoCost snap={snap} values={values} />
          <OutputPanel
            snap={snap}
            values={values}
            copied={copied}
            canCopy={canCopy}
            onCopy={copySql}
          />
        </div>
      </div>

      {/* Footnotes */}
      <div
        style={{
          marginTop: 44,
          paddingTop: 14,
          borderTop: `1px solid ${C.border08}`,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          maxWidth: 840,
        }}
      >
        {[
          snap.deadPerDay > 0
            ? `Dead rate derived from two statistics reads: Δ(n_tup_upd − n_tup_hot_upd + n_tup_del) / Δt. HOT updates excluded; they are reclaimed on the page without a vacuum pass.`
            : measured
              ? `Two statistics reads, ${fmtSecs(snap.sampleSeconds!)} apart, with identical counters: the write rate is a measured zero, not an unknown.`
              : `Single sample: no rate can be derived from one statistics read. Every figure that needs a rate says "unknown" instead of assuming one.`,
          `Duration model: cost = work pages × (0.55·page_hit + 0.25·page_miss + 0.20·page_dirty); the worker sleeps cost_delay ms per cost_limit units accumulated. Work pages = heap pages not marked all-visible${snap.allVisiblePages === undefined ? " (relallvisible not in this snapshot, full heap priced)" : ""}${snap.indexes ? `, plus 30% of the heap for each of the ${snap.indexes} indexes` : ""}. The page mix and the 30% are fixed assumptions, not measurements. Real runs vary with shared_buffers pressure.`,
          "Trigger formula: autovacuum_vacuum_threshold + autovacuum_vacuum_scale_factor × n_live_tup, and the insert-side equivalent on Postgres 13+. See PostgreSQL 16 docs §25.1.6 “The Autovacuum Daemon”.",
          "Snapshot is a point-in-time read encoded in this URL. Nothing is stored server-side, and nothing here has been applied to your database.",
        ].map((text, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              gap: 9,
              fontFamily: MONO,
              fontSize: 10.5,
              color: C.faint,
              lineHeight: 1.6,
            }}
          >
            <span>{i + 1}</span>
            <span>{text}</span>
          </div>
        ))}
      </div>

      {mobile && (
        <ActionBar
          pending={pending}
          periodDays={periodLive}
          zeroCadence={zeroCadence}
          canCopy={canCopy}
          copied={copied}
          onOptimize={() => setAll({ ...snap.proposed })}
          onCopy={() => {
            try {
              copySql(buildSql(snap, values));
            } catch {
              /* handled in copySql */
            }
          }}
        />
      )}
    </div>
  );
}
