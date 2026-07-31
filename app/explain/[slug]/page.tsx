import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TermLink } from "@/components/TermLink";
import { C, MONO, SANS, termLinkStyle } from "@/components/ui";
import { CONTENT } from "@/lib/explain-content";
import { TERMS } from "@/lib/terms";
import { requestOrigin } from "@/lib/origin";
import { social } from "@/lib/social";

export function generateStaticParams() {
  return TERMS.filter((t) => t.built).map((t) => ({ slug: t.slug }));
}

// Unknown slugs reach the page, which calls notFound() so the sibling
// not-found boundary renders the suggestions with a real 404 status (N1).
export const dynamicParams = true;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const term = TERMS.find((t) => t.slug === slug && t.built);
  if (!term) return { title: `robovac · ${slug}` };
  return {
    title: `${term.term} — robovac`,
    description: term.blurb,
    alternates: { canonical: `/explain/${slug}` },
    ...social({
      title: term.term,
      description: term.blurb,
      path: `/explain/${slug}`,
      type: "article",
      image: { url: `/brand/og/explain-${slug}.png`, alt: `robovac: ${term.term}` },
    }),
  };
}

export default async function ExplainPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const term = TERMS.find((t) => t.slug === slug && t.built);
  const content = CONTENT[slug];
  if (!term || !content) notFound();

  const { definition, Demo, seeAlso, footnote } = content;

  // These pages are literally definitions; DefinedTerm is the one schema type
  // that fits without inventing claims.
  const origin = await requestOrigin();
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "DefinedTerm",
    name: term.term,
    description: term.blurb,
    inDefinedTermSet: {
      "@type": "DefinedTermSet",
      name: "robovac arcana",
      url: `${origin}/arcana`,
    },
    url: `${origin}/explain/${slug}`,
  };

  return (
    <div className="page-pad" style={{ maxWidth: 980, margin: "0 auto" }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div style={{ fontFamily: MONO, fontSize: 11, color: C.faint }}>/explain/{slug}</div>
      <h1
        className="page-h1"
        style={{
          fontFamily: MONO,
          fontWeight: 500,
          color: "#fff",
          margin: "6px 0 0",
        }}
      >
        {term.term}
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
        {definition}
      </p>

      {Demo && (
        <>
          <noscript>
            <div
              style={{
                border: "1px solid rgba(255,255,255,0.09)",
                background: "#0b0b0d",
                padding: "11px 13px",
                fontFamily: MONO,
                fontSize: 11,
                color: "#8a8a90",
                lineHeight: 1.6,
              }}
            >
              The demo below needs JavaScript. Every definition, every formula and the snapshot
              query are plain text and are on this page already.
            </div>
          </noscript>
          <Demo />
        </>
      )}

      <div style={{ marginTop: 26, display: "flex", flexDirection: "column", gap: 7 }}>
        <div style={{ fontFamily: MONO, fontSize: 11, color: C.faint, letterSpacing: "0.05em" }}>
          SEE ALSO
        </div>
        {seeAlso.map((slug2) => (
          <TermLink key={slug2} slug={slug2} style={{ fontSize: 13, alignSelf: "flex-start" }}>
            {TERMS.find((t) => t.slug === slug2)?.term ?? slug2}
          </TermLink>
        ))}
        <Link
          href="/"
          className="term-link"
          style={{ ...termLinkStyle, fontSize: 13, alignSelf: "flex-start" }}
        >
          ← back to start
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
        {footnote}
      </div>
    </div>
  );
}
