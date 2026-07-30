"use client";

import Link from "next/link";
import { useState } from "react";
import { TermLink } from "@/components/TermLink";
import { C, MONO, SANS, panel, primaryButton, secondaryButton } from "@/components/ui";
import { useViewport } from "@/components/useViewport";
import { encodeReport } from "@/lib/core/codec";
import { parseSnapshotPaste } from "@/lib/core/parse";
import { SETTINGS } from "@/lib/core/settings";
import { TERMS } from "@/lib/terms";
import { snapshotSql } from "@/packages/robovac-mcp/src/queries";
import { buildSnapshot } from "@/packages/robovac-mcp/src/report";

// The generated SQL aligns its AS clauses with wide whitespace; collapse it so
// the narrow homepage column shows one select item per line.
const QUERY = snapshotSql("schema", "table")
  .trim()
  .split("\n")
  .map((line) => line.replace(/[ \t]{2,}/g, " "))
  .join("\n");

const PASTE_PLACEHOLDER = `  relname   | relpages | n_live_tup | n_dead_tup | last_autovacuum | xid_age
------------+----------+------------+------------+-----------------+----------
 event_log  |  1740000 |  412338901 |    3148772 | 2026-07-24 …    | 211480336`;

const FINDINGS: { title: string; body: React.ReactNode }[] = [
  {
    title: "How often vacuum actually fires",
    body: 'Your trigger threshold against your write rate, in days — not percentages. Most large tables discover here that the answer is "every three weeks".',
  },
  {
    title: "How close the freeze horizon is",
    body: (
      <>
        Table age against{" "}
        <TermLink slug="autovacuum_freeze_max_age" style={{ fontSize: 12 }}>
          autovacuum_freeze_max_age
        </TermLink>{" "}
        and the wraparound limit, with the date the cluster would stop accepting writes.
      </>
    ),
  },
  {
    title: "What one vacuum pass costs",
    body: "Duration and throughput under your cost settings. A 20 ms delay on a 14 GB table is 44 minutes of throttled I/O per run.",
  },
  {
    title: "The statement to run",
    body: (
      <>
        An <span style={{ fontFamily: MONO, color: C.muted }}>ALTER TABLE … SET (…)</span> that
        mirrors the sliders, listing only what you changed. You run it; robovac cannot.
      </>
    ),
  },
];

const LEARN_SLUGS = [
  "xmin",
  "xmax",
  "dead-tuple",
  "bloat",
  "freeze",
  "aggressive-vacuum",
  "wraparound",
  "multixact",
];

const specCells: { label: string; value: string; sub?: string }[] = [
  { label: "READS", value: "1 table", sub: " · statistics only" },
  { label: "TUNES", value: `${SETTINGS.length} settings`, sub: " · trigger, cost, freeze" },
  { label: "EXPLAINS", value: `${TERMS.length} terms`, sub: " · with live demos" },
  { label: "STORES", value: "nothing" },
];

function SectionTitle({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: "9px 12px",
        borderBottom: `1px solid ${C.border08}`,
        fontFamily: MONO,
        fontSize: 11,
        color: C.strong,
        letterSpacing: "0.03em",
      }}
    >
      {text}
    </div>
  );
}

export function HomeView() {
  const { narrow, mobile } = useViewport();
  const [paste, setPaste] = useState("");
  const [message, setMessage] = useState<{ text: string; warn: boolean } | null>(null);
  const [queryCopied, setQueryCopied] = useState(false);

  const gridCols = narrow ? "minmax(0,1fr)" : "minmax(0,1fr) 520px";
  const bandGap = mobile ? 24 : 48;

  const build = () => {
    if (paste.trim().length < 40) {
      setMessage({
        text: "That does not look like query output — paste the full result, headers included.",
        warn: true,
      });
      return;
    }
    try {
      const { first, second } = parseSnapshotPaste(paste);
      const snap = buildSnapshot(first, second ?? first);
      window.location.href = `/report#${encodeReport({ snap })}`;
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), warn: true });
    }
  };

  return (
    <div className="page-pad" style={{ maxWidth: 1080, margin: "0 auto", paddingTop: 0 }}>
      {/* Band A: what it is */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: gridCols,
          padding: "44px 0 30px",
          borderBottom: `1px solid ${C.border08}`,
          gap: bandGap,
        }}
      >
        <div>
          <h1
            style={{
              fontFamily: MONO,
              fontWeight: 500,
              letterSpacing: "-0.015em",
              color: "#fff",
              margin: 0,
              lineHeight: 1.15,
              fontSize: mobile ? 23 : 30,
            }}
          >
            Your table is fine.
            <br />
            Your autovacuum settings are the ones Postgres shipped in 2005.
          </h1>
          <p
            style={{
              maxWidth: 620,
              fontFamily: SANS,
              fontSize: 15,
              lineHeight: 1.65,
              color: C.muted,
              margin: "20px 0 0",
            }}
          >
            robovac reads a statistics snapshot of one table and tells you three things: what
            autovacuum is doing today, what it should do at your write rate, and the exact{" "}
            <span style={{ fontFamily: MONO, color: C.strong }}>ALTER TABLE</span> that closes the
            gap. Every term in the report links to a page that explains it with a demo you can drag.
          </p>
          <p
            style={{
              maxWidth: 620,
              fontFamily: SANS,
              fontSize: 15,
              lineHeight: 1.65,
              color: C.dim,
              margin: "12px 0 0",
            }}
          >
            No account, no agent required, no write access. It never connects to your database — you
            bring the numbers.
          </p>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 1,
            background: C.border08,
            border: `1px solid ${C.border08}`,
            alignSelf: "start",
          }}
        >
          {specCells.map((cell) => (
            <div key={cell.label} style={{ background: C.cell, padding: "12px 14px" }}>
              <div
                style={{ fontFamily: MONO, fontSize: 10, color: C.faint, letterSpacing: "0.03em" }}
              >
                {cell.label}
              </div>
              <div style={{ fontFamily: MONO, fontSize: 13.5, color: C.strong, marginTop: 3 }}>
                {cell.value}
                {cell.sub && <span style={{ color: C.faint, fontSize: 11 }}>{cell.sub}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Band B: start here + findings */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: gridCols,
          paddingTop: 30,
          alignItems: "start",
          gap: bandGap,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 12,
              borderBottom: `1px solid ${C.borderStrong}`,
              paddingBottom: 7,
            }}
          >
            <h2
              style={{
                margin: 0,
                fontFamily: MONO,
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: "0.06em",
                color: "#fff",
              }}
            >
              START HERE
            </h2>
            <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.faint }}>
              run it, paste it, read it
            </span>
          </div>

          <div style={{ ...panel, marginTop: 14 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "9px 12px",
                borderBottom: `1px solid ${C.border08}`,
              }}
            >
              <span
                style={{ fontFamily: MONO, fontSize: 11, color: C.strong, letterSpacing: "0.03em" }}
              >
                01 — RUN THIS, ANYWHERE YOU HAVE psql
              </span>
              <button
                className="copy-btn"
                onClick={() => {
                  try {
                    navigator.clipboard.writeText(QUERY);
                  } catch {
                    /* clipboard unavailable */
                  }
                  setQueryCopied(true);
                }}
                style={{
                  fontFamily: MONO,
                  fontSize: 10.5,
                  color: C.muted,
                  background: "transparent",
                  border: `1px solid ${C.borderStrong}`,
                  borderRadius: 3,
                  padding: mobile ? "8px 12px" : "3px 8px",
                  cursor: "pointer",
                }}
              >
                {queryCopied ? "copied" : "copy"}
              </button>
            </div>
            <pre
              style={{
                padding: 12,
                maxHeight: 260,
                overflowY: "auto",
                fontFamily: MONO,
                fontSize: 11.5,
                lineHeight: 1.7,
                color: C.code,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {QUERY}
            </pre>
            <div
              style={{
                padding: "0 12px 11px",
                fontFamily: MONO,
                fontSize: 10.5,
                color: C.faint,
                lineHeight: 1.6,
              }}
            >
              Change the schema and table name, and run it twice, 30-60 s apart, for real rates. It
              reads statistics catalogues only — no table data, no locks, safe on a primary.
            </div>
          </div>

          <div style={{ ...panel, marginTop: 12 }}>
            <SectionTitle text="02 — PASTE THE OUTPUT" />
            <textarea
              value={paste}
              onChange={(e) => {
                setPaste(e.target.value);
                setMessage(null);
              }}
              placeholder={PASTE_PLACEHOLDER}
              style={{
                width: "100%",
                minHeight: 132,
                resize: "vertical",
                background: C.bg,
                color: C.code,
                border: "none",
                borderBottom: `1px solid ${C.border08}`,
                padding: 12,
                fontFamily: MONO,
                fontSize: 11.5,
                lineHeight: 1.7,
                outline: "none",
              }}
            />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                flexWrap: "wrap",
              }}
            >
              <button
                className="btn-primary"
                onClick={build}
                style={{ ...primaryButton, minHeight: mobile ? 44 : undefined }}
              >
                → build the report
              </button>
            </div>
            {message && (
              <div
                style={{
                  padding: "0 12px 11px",
                  fontFamily: MONO,
                  fontSize: 10.5,
                  lineHeight: 1.6,
                  color: message.warn ? C.warn : C.faint,
                }}
              >
                {message.text}
              </div>
            )}
            <div
              style={{
                padding: "0 12px 11px",
                fontFamily: MONO,
                fontSize: 10.5,
                lineHeight: 1.6,
                color: C.ghost,
              }}
            >
              Two result blocks (the query run twice) give real rates; one block builds a report
              that says which figures are unknown.
            </div>
          </div>

          <div style={{ ...panel, marginTop: 12 }}>
            <SectionTitle text="03 — OR LET YOUR AGENT DO IT" />
            <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              <p
                style={{
                  margin: 0,
                  fontFamily: SANS,
                  fontSize: 13.5,
                  lineHeight: 1.55,
                  color: C.dim,
                }}
              >
                Register the MCP server once and ask in plain language. If your agent already
                reaches Postgres, it runs the query itself and hands you back a link.
              </p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Link
                  href="/mcp"
                  className="btn-secondary"
                  style={{
                    ...secondaryButton,
                    display: "inline-block",
                    minHeight: mobile ? 44 : undefined,
                  }}
                >
                  how to add the MCP →
                </Link>
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={panel}>
            <SectionTitle text="WHAT THE REPORT TELLS YOU" />
            <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 13 }}>
              {FINDINGS.map((f, i) => (
                <div
                  key={f.title}
                  style={i > 0 ? { borderTop: `1px solid ${C.hair}`, paddingTop: 13 } : undefined}
                >
                  <div style={{ fontFamily: MONO, fontSize: 12.5, color: "#fff" }}>{f.title}</div>
                  <p
                    style={{
                      margin: "4px 0 0",
                      fontFamily: SANS,
                      fontSize: 13,
                      lineHeight: 1.5,
                      color: C.dim,
                    }}
                  >
                    {f.body}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div style={panel}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 10,
                padding: "9px 12px",
                borderBottom: `1px solid ${C.border08}`,
              }}
            >
              <span
                style={{ fontFamily: MONO, fontSize: 11, color: C.strong, letterSpacing: "0.03em" }}
              >
                IF YOU ARE JUST HERE TO LEARN
              </span>
              <Link
                href="/arcana"
                style={{
                  fontFamily: MONO,
                  fontSize: 10,
                  color: C.faint,
                  borderBottom: "1px dotted #2e2e35",
                }}
              >
                all {TERMS.length} ↗
              </Link>
            </div>
            <div style={{ padding: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {LEARN_SLUGS.map((slug) => {
                const term = TERMS.find((t) => t.slug === slug);
                if (!term) return null;
                return (
                  <TermLink
                    key={slug}
                    slug={slug}
                    style={{
                      fontFamily: MONO,
                      fontSize: 11.5,
                      color: C.muted,
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 3,
                      padding: "5px 9px",
                      borderBottom: "1px solid rgba(255,255,255,0.1)",
                    }}
                  >
                    {term.term}
                  </TermLink>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Footnotes */}
      <div
        style={{
          marginTop: 40,
          paddingTop: 14,
          borderTop: `1px solid ${C.border08}`,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          maxWidth: 840,
        }}
      >
        {[
          "robovac has no database driver. The query is yours to run and the output is yours to paste; the report is computed in your browser from what you paste, and the paste never reaches a server.",
          "Proposals are arithmetic, not advice: trigger thresholds from your row counts, vacuum duration from the cost model, freeze margins from your xid rate. Every figure on the report shows the formula behind it in a footnote, and every setting page shows the same formula with a slider attached.",
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
    </div>
  );
}
