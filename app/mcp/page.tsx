import type { Metadata } from "next";
import Link from "next/link";
import {
  C,
  MONO,
  SANS,
  panel,
  panelHeader,
  primaryButton,
  secondaryButton,
  termLinkStyle,
} from "@/components/ui";

export const metadata: Metadata = {
  title: "Add robovac to your agent — robovac",
  description:
    "Install the robovac MCP server: statistics snapshot in, report link and optimized autovacuum settings out. Read-only, no account.",
  alternates: { canonical: "/mcp" },
  openGraph: { title: "Add robovac to your agent" },
  twitter: { title: "Add robovac to your agent" },
};

const CONFIG = `# Claude Code
claude mcp add --transport http robovac https://robovac.hannesmoser.at/api/mcp

# Codex
codex mcp add robovac --url https://robovac.hannesmoser.at/api/mcp

# prefer a local process? same tools over stdio:
npx -y robovac-mcp`;

const cards: { title: string; sig: string; body: React.ReactNode }[] = [
  {
    title: "get_snapshot_sql",
    sig: "(schema, table) → sql",
    body: "Hands your agent the read-only statistics query (pg_stat_user_tables, pg_class, pg_settings, reloptions). The agent runs it twice, 30-60 s apart, on its own connection. The delay turns counters into rates.",
  },
  {
    title: "create_report",
    sig: "(first, second, …hints) → url",
    body: "Takes the two result rows and returns the report URL, the workload pattern, warnings, and the optimized settings with one reason per change. Optional hints (pattern, replication_lag_budget, storage, fk_heavy, …) sharpen the classification.",
  },
  {
    title: "get_candidates_sql",
    sig: "(limit) → sql",
    body: "The ranking query (dead-tuple ratio plus xid age), for when the agent has to find the table worth snapshotting first.",
  },
  {
    title: "explain_term",
    sig: "(term) → url",
    body: (
      <>
        Returns the stable explain URL for any term in{" "}
        <Link href="/arcana" style={{ ...termLinkStyle, fontSize: 13 }}>
          /arcana
        </Link>
        . Cheaper than letting a model paraphrase the docs.
      </>
    ),
  },
  {
    title: "required grants",
    sig: "pg_monitor",
    body: "For your agent's own connection: a role in pg_monitor is enough. No table data is read, ever. robovac itself needs nothing — no DATABASE_URL, no env, no connection.",
  },
];

export default function McpPage() {
  return (
    <div className="page-pad" style={{ maxWidth: 980, margin: "0 auto" }}>
      <div style={{ fontFamily: MONO, fontSize: 11, color: C.faint }}>/mcp</div>
      <h1
        className="page-h1"
        style={{
          fontFamily: MONO,
          fontWeight: 500,
          color: "#fff",
          margin: "6px 0 0",
        }}
      >
        Add robovac to your agent
      </h1>
      <p
        style={{
          maxWidth: 680,
          fontFamily: SANS,
          fontSize: 15,
          lineHeight: 1.65,
          color: C.muted,
          margin: "16px 0 0",
        }}
      >
        robovac is an MCP server with one job: turn a statistics snapshot of one table into a link.
        It never connects to your database — it hands your agent a read-only{" "}
        <span style={{ fontFamily: MONO, color: C.strong }}>SELECT</span>, the agent runs it twice
        on its own connection, and robovac computes the report from the two result rows. There is no
        account, no stored state, no environment variable, and no write path anywhere.
        <sup style={{ fontFamily: MONO, fontSize: 9.5, color: C.faint }}>1</sup>
      </p>

      <div style={{ ...panel, marginTop: 26 }}>
        <div style={panelHeader}>
          <span
            style={{ fontFamily: MONO, fontSize: 11, color: C.strong, letterSpacing: "0.03em" }}
          >
            ADD TO YOUR AGENT
          </span>
          <span style={{ fontFamily: MONO, fontSize: 10, color: C.faint }}>
            streamable http · stdio
          </span>
        </div>
        <pre
          style={{
            padding: 12,
            fontFamily: MONO,
            fontSize: 11.5,
            lineHeight: 1.7,
            color: C.code,
            whiteSpace: "pre-wrap",
          }}
        >
          {CONFIG}
        </pre>
      </div>

      <div
        className="cards-grid"
        style={{
          gap: 1,
          background: C.border08,
          border: `1px solid ${C.border08}`,
          marginTop: 16,
        }}
      >
        {cards.map((card) => (
          <div key={card.title} style={{ background: C.panel, padding: 12 }}>
            <div style={{ fontFamily: MONO, fontSize: 12.5, color: "#fff" }}>{card.title}</div>
            <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.faint, marginTop: 2 }}>
              {card.sig}
            </div>
            <p
              style={{
                margin: "8px 0 0",
                fontFamily: SANS,
                fontSize: 13,
                lineHeight: 1.55,
                color: C.muted,
              }}
            >
              {card.body}
            </p>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
        <Link
          href="/"
          className="btn-primary"
          style={{ ...primaryButton, display: "inline-block" }}
        >
          → build a report from your table
        </Link>
        <Link
          href="/arcana"
          className="btn-secondary"
          style={{ ...secondaryButton, display: "inline-block" }}
        >
          browse /arcana
        </Link>
      </div>

      <div
        style={{
          marginTop: 30,
          paddingTop: 12,
          borderTop: `1px solid ${C.border08}`,
          fontFamily: MONO,
          fontSize: 10.5,
          color: C.faint,
          lineHeight: 1.6,
          maxWidth: 760,
        }}
      >
        <span style={{ marginRight: 9 }}>1</span>
        Fragments are not sent to the server on navigation (RFC 3986 §3.5), so the snapshot stays in
        the browser. A link is roughly 900 bytes after compression; a truncated one renders an error
        state rather than a partial report.
      </div>
    </div>
  );
}
