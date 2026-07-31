import Link from "next/link";
import { headers } from "next/headers";
import { C, MONO, SANS, secondaryButton } from "@/components/ui";
import { suggestTerms } from "@/lib/terms";

// N1: a wrong term is a search, not a dead end. The middleware passes the
// requested path as a header, because a not-found boundary has no params.
// The page renders with HTTP 404: suggestions for the reader, the status
// for the crawler.
export default async function TermNotFound() {
  const path = (await headers()).get("x-robovac-path") ?? "/explain";
  const slug = decodeURIComponent(path.split("/").pop() ?? "");
  const suggestions = suggestTerms(slug);
  return (
    <div className="page-pad" style={{ maxWidth: 980, margin: "0 auto" }}>
      <div style={{ maxWidth: 660 }}>
        <div style={{ fontFamily: MONO, fontSize: 11, color: C.faint }}>/explain/{slug}</div>
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
          No page for that term.
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
          There are 34 terms in <span style={{ fontFamily: MONO, color: C.strong }}>/arcana</span>.
          These three are closest to what you asked for:
        </p>
        <div style={{ marginTop: 14, border: `1px solid ${C.border}` }}>
          {suggestions.map((t) => (
            <Link
              key={t.slug}
              href={`/explain/${t.slug}`}
              className="term-link"
              style={{
                display: "grid",
                gridTemplateColumns: "260px minmax(0,1fr)",
                gap: 14,
                padding: "10px 12px",
                borderBottom: `1px solid ${C.hair}`,
                alignItems: "baseline",
              }}
            >
              <span style={{ fontFamily: MONO, fontSize: 12.5, color: C.strong }}>{t.term}</span>
              <span style={{ fontFamily: SANS, fontSize: 13, lineHeight: 1.5, color: C.dim }}>
                {t.blurb}
              </span>
            </Link>
          ))}
        </div>
        <div style={{ display: "flex", gap: 9, flexWrap: "wrap", marginTop: 16 }}>
          <Link
            href="/arcana"
            className="btn-secondary"
            style={{ ...secondaryButton, display: "inline-block", textDecoration: "none" }}
          >
            browse all 34 →
          </Link>
        </div>
      </div>
    </div>
  );
}
