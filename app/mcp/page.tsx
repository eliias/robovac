import type { Metadata } from "next";
import Link from "next/link";
import { social } from "@/lib/social";
import { Footnotes, Lede, PageHeader, PanelHead } from "@/components/kit";
import { C, MONO, SANS, panel, termLinkStyle } from "@/components/ui";

export const metadata: Metadata = {
  title: "Add robovac to your agent — robovac",
  description:
    "Install the robovac MCP server: statistics snapshot in, report link and optimized autovacuum settings out. Read-only, no account.",
  alternates: { canonical: "/mcp" },
  ...social({
    title: "Add robovac to your agent",
    description:
      "Install the robovac MCP server: statistics snapshot in, report link and optimized autovacuum settings out. Read-only, no account.",
    path: "/mcp",
  }),
};

const CONFIG = `# Claude Code
claude mcp add --transport http robovac https://robovac.hannesmoser.at/api/mcp

# Codex
codex mcp add robovac --url https://robovac.hannesmoser.at/api/mcp`;

const cards: { title: string; sig: string; body: React.ReactNode }[] = [
  {
    title: "get_snapshot_sql",
    sig: "(schema, table) → sql",
    body: "Hands your agent the read-only statistics query (pg_stat_user_tables, pg_class, pg_settings, reloptions). The agent runs it twice, 30-60 s apart, on its own connection. The delay turns counters into rates.",
  },
  {
    title: "create_report",
    sig: "(first, second, …hints) → url + permalink",
    body: "Takes the two result rows and returns two links (a short url that expires in 30 days, and a permalink that never does), the workload pattern, warnings, and the optimized settings with one reason per change. Optional hints (pattern, replicationLagBudget, storage, fkHeavy, …) sharpen the classification.",
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
    body: "For your agent's own connection: a role in pg_monitor is enough. No table data is read, ever. robovac needs no DATABASE_URL and never opens a database connection of its own. It does store two things: the report behind the short link for 30 days, and one report counter per IP address for the current hour.",
  },
];

export default function McpPage() {
  return (
    <div className="page-pad" style={{ maxWidth: 980, margin: "0 auto" }}>
      <PageHeader path="/mcp" title="Add robovac to your agent">
        <Lede>
          robovac is an MCP server with one job: turn a statistics snapshot of one table into a
          link. It never connects to your database: it hands your agent a read-only{" "}
          <span style={{ fontFamily: MONO, color: C.strong }}>SELECT</span>, the agent runs it twice
          on its own connection, and robovac computes the report from the two result rows. There is
          no account, no <span style={{ fontFamily: MONO, color: C.strong }}>DATABASE_URL</span>,
          and no write path to your database. robovac stores two things: the report behind the short
          link for 30 days, and one report counter per IP address for the current hour.
          <sup style={{ fontFamily: MONO, fontSize: 9.5, color: C.faint }}>1</sup>
        </Lede>
      </PageHeader>

      <div style={{ ...panel, marginTop: 26 }}>
        <PanelHead title="ADD TO YOUR AGENT" caption="streamable http" />
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
        <Link href="/" className="btn-primary" style={{ display: "inline-block" }}>
          → build a report from your table
        </Link>
        <Link href="/arcana" className="btn-secondary" style={{ display: "inline-block" }}>
          browse /arcana
        </Link>
      </div>

      <Footnotes
        notes={[
          "create_report returns two links. The permalink carries the whole snapshot in its fragment, which browsers never send to a server (RFC 3986 §3.5), so it stays in the browser and never expires. It runs about 1200 characters, and a truncated one renders an error state rather than a partial report. The short link is 45 characters and resolves for 30 days, which means robovac stores that snapshot for 30 days.",
        ]}
      />
    </div>
  );
}
