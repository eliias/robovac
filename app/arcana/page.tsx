import type { Metadata } from "next";
import Link from "next/link";
import { C, MONO, SANS } from "@/components/ui";
import { TERMS, termHref } from "@/lib/terms";

export const metadata: Metadata = {
  title: "Arcana — everything vacuum-adjacent worth knowing",
  description:
    "Everything vacuum-adjacent that is worth knowing, in the order it tends to hurt you. Every term links to a place in the product where you can watch it happen.",
  alternates: { canonical: "/arcana" },
  openGraph: { title: "Arcana — everything vacuum-adjacent worth knowing" },
  twitter: { title: "Arcana — everything vacuum-adjacent worth knowing" },
};

export default function ArcanaPage() {
  return (
    <div className="page-pad" style={{ maxWidth: 980, margin: "0 auto" }}>
      <div style={{ fontFamily: MONO, fontSize: 11, color: C.faint }}>/arcana</div>
      <h1
        className="page-h1"
        style={{
          fontFamily: MONO,
          fontWeight: 500,
          color: "#fff",
          margin: "6px 0 0",
        }}
      >
        Arcana
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
        Everything vacuum-adjacent that is worth knowing, in the order it tends to hurt you. Every
        term in the report links here; every entry here links back to a place in the product where
        you can watch it happen.
      </p>
      <div style={{ borderTop: `1px solid ${C.borderStrong}`, marginTop: 22 }}>
        {TERMS.map((e) => {
          const draft = e.tag === "draft";
          const row = (
            <span
              className="arcana-row"
              style={{
                gap: 16,
                alignItems: "baseline",
                padding: "12px 0",
                borderBottom: `1px solid ${C.hair}`,
                cursor: draft ? "default" : "pointer",
              }}
            >
              <span style={{ fontFamily: MONO, fontSize: 13, color: draft ? C.faint : C.strong }}>
                {e.term}
              </span>
              <span style={{ fontFamily: SANS, fontSize: 13.5, lineHeight: 1.5, color: C.dim }}>
                {e.blurb}
              </span>
              <span
                className="arcana-tag"
                style={{ fontFamily: MONO, fontSize: 10, color: C.ghost }}
              >
                {e.kind} · {e.tag}
              </span>
            </span>
          );
          return draft ? (
            <div key={e.slug}>{row}</div>
          ) : (
            <Link
              key={e.slug}
              href={termHref(e.slug)}
              style={{ display: "block" }}
              className="arcana-link"
            >
              {row}
            </Link>
          );
        })}
      </div>
      <div
        style={{
          marginTop: 24,
          fontFamily: MONO,
          fontSize: 10.5,
          color: C.faint,
          lineHeight: 1.6,
          maxWidth: 760,
        }}
      >
        Entries marked <span style={{ color: C.dim }}>draft</span> have no page yet; the term still
        resolves in the report. Definitions follow PostgreSQL 16 behaviour. Where 16 differs from
        12, the older behaviour is noted on the page, not here.
      </div>
    </div>
  );
}
