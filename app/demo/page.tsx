import type { Metadata } from "next";
import Link from "next/link";
import { Footnotes, Lede, PageHeader } from "@/components/kit";
import { C, MONO, SANS } from "@/components/ui";
import { encodeReport } from "@/lib/core/codec";
import { demoScenarios } from "@/lib/core/demo-scenarios";
import { fmtCompact } from "@/lib/core/format";
import { social } from "@/lib/social";

export const metadata: Metadata = {
  title: "Five tables — robovac",
  description:
    "Five demo reports, one per vacuum-problem shape: a stale scale factor, a fillfactor victim, an append-only partition near wraparound, a pinned xmin horizon, and a tuned table.",
  alternates: { canonical: "/demo" },
  ...social({
    title: "Five tables",
    description:
      "Five demo reports, one per vacuum-problem shape. Two of them cannot be fixed by any setting on the page. That is deliberate.",
    path: "/demo",
  }),
};

// The capture times are relative to the request, so a demo link never ages
// into the stale-snapshot notice.
export const dynamic = "force-dynamic";

export default function DemoPage() {
  const scenarios = demoScenarios(Date.now());
  return (
    <div className="page-pad" style={{ maxWidth: 1080, margin: "0 auto" }}>
      <PageHeader path="/demo" title="Five tables">
        <Lede>
          Each one is a real report built from a real snapshot payload: the same route, the same
          formulas, the same sliders you would get from your own table. They are here because vacuum
          problems come in a small number of shapes, and reading five of them is faster than reading
          the documentation.
        </Lede>
        <Lede dim>
          Two of the five cannot be fixed by any setting on the page. That is deliberate.
        </Lede>
      </PageHeader>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 26 }}>
        {scenarios.map((s) => (
          <a
            key={s.key}
            href={`/report#${encodeReport({ snap: s.snap })}`}
            className="demo-card"
            style={{ display: "block", background: C.panel, border: `1px solid ${C.border}` }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
                padding: "11px 13px",
                borderBottom: `1px solid ${C.border08}`,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                <span
                  style={{
                    flex: "none",
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: s.key === "invoices" ? C.dim : C.warn,
                  }}
                />
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 13.5,
                    color: "#fff",
                    overflowWrap: "anywhere",
                  }}
                >
                  {s.snap.table}
                </span>
              </div>
              <span style={{ fontFamily: MONO, fontSize: 11, color: C.dim, whiteSpace: "nowrap" }}>
                {s.snap.db}
              </span>
            </div>
            <div
              className="demo-card-grid"
              style={{ gap: 16, padding: "12px 13px", alignItems: "baseline" }}
            >
              <div>
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 10,
                    color: C.faint,
                    letterSpacing: "0.03em",
                  }}
                >
                  SHAPE
                </div>
                <div style={{ fontFamily: MONO, fontSize: 12.5, color: C.strong, marginTop: 3 }}>
                  {s.shape}
                </div>
              </div>
              <p
                style={{
                  margin: 0,
                  fontFamily: SANS,
                  fontSize: 13.5,
                  lineHeight: 1.55,
                  color: C.dim,
                }}
              >
                {s.teach}
              </p>
              <div style={{ display: "flex", gap: 14 }}>
                {[
                  ["HEAP", `${((s.snap.pages * 8192) / 1e9).toFixed(1)} GB`],
                  ["LIVE", fmtCompact(s.snap.live)],
                  [
                    "DEAD",
                    `${fmtCompact(s.snap.dead)} · ${((s.snap.dead / Math.max(1, s.snap.live)) * 100).toFixed(2)}%`,
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <div
                      style={{
                        fontFamily: MONO,
                        fontSize: 10,
                        color: C.faint,
                        letterSpacing: "0.03em",
                      }}
                    >
                      {label}
                    </div>
                    <div
                      style={{ fontFamily: MONO, fontSize: 12.5, color: C.strong, marginTop: 3 }}
                    >
                      {value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </a>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 22 }}>
        <Link href="/" className="btn-primary" style={{ display: "inline-block" }}>
          → build one from your own table
        </Link>
        <Link href="/arcana" className="btn-secondary" style={{ display: "inline-block" }}>
          browse the terms
        </Link>
      </div>

      <Footnotes
        notes={[
          "Each card holds a snapshot payload of the kind the query produces, and opening one loads the ordinary report route. Anything that renders wrong here renders wrong for a real table.",
          "Table and database names are invented; the statistics are shaped after production tables of that kind. Nobody's data is in here, which is also why the numbers are round enough to check by hand.",
        ]}
      />
    </div>
  );
}
