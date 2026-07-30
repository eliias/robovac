import Link from "next/link";
import { C, MONO, SANS, panel, panelHeader, termLinkStyle } from "@/components/ui";

export function ErrorState({ issues }: { issues: string[] }) {
  return (
    <div className="page-pad" style={{ maxWidth: 980, margin: "0 auto" }}>
      <div style={{ fontFamily: MONO, fontSize: 11, color: C.faint }}>/report</div>
      <h1
        className="page-h1"
        style={{
          fontFamily: MONO,
          fontWeight: 500,
          color: "#fff",
          margin: "6px 0 0",
        }}
      >
        This link does not decode
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
        The snapshot travels inside the URL fragment. This fragment is truncated, damaged, or from a
        different robovac version, so there is nothing to render. Generate a fresh link with the MCP
        server and open it again.
      </p>
      <div style={{ ...panel, marginTop: 26, maxWidth: 680 }}>
        <div style={panelHeader}>
          <span
            style={{ fontFamily: MONO, fontSize: 11, color: C.strong, letterSpacing: "0.03em" }}
          >
            WHAT FAILED
          </span>
        </div>
        <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          {issues.map((issue, i) => (
            <div
              key={i}
              style={{ fontFamily: MONO, fontSize: 11.5, lineHeight: 1.6, color: C.muted }}
            >
              {issue}
            </div>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 26, display: "flex", flexDirection: "column", gap: 7 }}>
        <Link
          href="/mcp"
          className="term-link"
          style={{ ...termLinkStyle, fontSize: 13, alignSelf: "flex-start" }}
        >
          how to generate a link → /mcp
        </Link>
        <Link
          href="/report"
          className="term-link"
          style={{ ...termLinkStyle, fontSize: 13, alignSelf: "flex-start" }}
        >
          open the demo report instead
        </Link>
      </div>
    </div>
  );
}
