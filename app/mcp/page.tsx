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
  title: "robovac · mcp",
};

const CONFIG = `{
  "robovac": {
    "command": "npx",
    "args": ["-y", "robovac-mcp"],
    "env": { "DATABASE_URL": "postgres://readonly@host:5432/prod" }
  }
}`;

const cards: { title: string; sig: string; body: React.ReactNode }[] = [
  {
    title: "snapshot_table",
    sig: "(schema, table, …hints) → url",
    body: "Reads pg_stat_user_tables, pg_class, pg_settings, and the reloptions on the table. Two reads ~30 s apart give the write and xid rates. Optional hints (pattern, replication_lag_budget, storage, fk_heavy, …) sharpen the classification.",
  },
  {
    title: "list_candidates",
    sig: "(limit) → table[]",
    body: "Ranks tables by dead-tuple ratio and xid age, so the agent knows which one to snapshot without being told.",
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
    body: "A role in pg_monitor is enough. No table data is read, ever: the server touches statistics catalogs only.",
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
        robovac is an MCP server with one job: take a statistics snapshot of one table and return a
        link. The link carries the whole snapshot in its URL fragment. There is no account, no
        stored state, and no write path back to your database — the server never issues anything but{" "}
        <span style={{ fontFamily: MONO, color: C.strong }}>SELECT</span> against the statistics
        views.
        <sup style={{ fontFamily: MONO, fontSize: 9.5, color: C.faint }}>1</sup>
      </p>

      <div style={{ ...panel, marginTop: 26 }}>
        <div style={panelHeader}>
          <span
            style={{ fontFamily: MONO, fontSize: 11, color: C.strong, letterSpacing: "0.03em" }}
          >
            ~/.config/mcp/servers.json
          </span>
          <span style={{ fontFamily: MONO, fontSize: 10, color: C.faint }}>stdio transport</span>
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
          href="/report"
          className="btn-primary"
          style={{ ...primaryButton, display: "inline-block" }}
        >
          → open the demo report
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
