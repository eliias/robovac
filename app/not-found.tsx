import Link from "next/link";
import { C, MONO, SANS, termLinkStyle } from "@/components/ui";
import { TERMS } from "@/lib/terms";

// N2: no oversized numeral, no joke. The list of destinations is the whole
// content.
export default function NotFound() {
  return (
    <div className="page-pad" style={{ maxWidth: 980, margin: "0 auto" }}>
      <div style={{ maxWidth: 600 }}>
        <div style={{ fontFamily: MONO, fontSize: 11, color: C.faint }}>404</div>
        <h1
          style={{
            margin: "8px 0 0",
            fontFamily: MONO,
            fontSize: 22,
            fontWeight: 500,
            color: "#fff",
            letterSpacing: "-0.01em",
          }}
        >
          Nothing here.
        </h1>
        <p
          style={{
            margin: "10px 0 0",
            fontFamily: SANS,
            fontSize: 14.5,
            lineHeight: 1.6,
            color: C.muted,
          }}
        >
          robovac has five places: a report builder, five demo reports, an MCP page, an index of{" "}
          {TERMS.filter((t) => t.built).length} terms, and the pages behind it.
        </p>
        <div
          style={{
            display: "flex",
            gap: 16,
            flexWrap: "wrap",
            marginTop: 16,
            fontFamily: MONO,
            fontSize: 12.5,
          }}
        >
          <Link href="/" className="term-link" style={termLinkStyle}>
            /
          </Link>
          <Link href="/demo" className="term-link" style={termLinkStyle}>
            /demo
          </Link>
          <Link href="/mcp" className="term-link" style={termLinkStyle}>
            /mcp
          </Link>
          <Link href="/arcana" className="term-link" style={termLinkStyle}>
            /arcana
          </Link>
        </div>
      </div>
    </div>
  );
}
