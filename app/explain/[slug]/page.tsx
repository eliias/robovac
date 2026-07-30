import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TermLink } from "@/components/TermLink";
import { C, MONO, SANS, termLinkStyle } from "@/components/ui";
import { CONTENT } from "@/lib/explain-content";
import { TERMS } from "@/lib/terms";
import { requestOrigin } from "@/lib/origin";

export function generateStaticParams() {
  return TERMS.filter((t) => t.built).map((t) => ({ slug: t.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const term = TERMS.find((t) => t.slug === slug && t.built);
  if (!term) return { title: `robovac · ${slug}` };
  const card = {
    url: `/brand/og/explain-${slug}.png`,
    type: "image/png",
    width: 1200,
    height: 630,
    alt: `robovac: ${term.term}`,
  };
  return {
    title: `${term.term} — robovac`,
    description: term.blurb,
    alternates: { canonical: `/explain/${slug}` },
    openGraph: {
      type: "article",
      title: term.term,
      description: term.blurb,
      images: [card],
    },
    twitter: {
      card: "summary_large_image",
      title: term.term,
      description: term.blurb,
      images: [{ url: card.url, alt: card.alt }],
    },
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

      {Demo && <Demo />}

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
