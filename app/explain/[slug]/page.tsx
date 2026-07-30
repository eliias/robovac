import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ComponentType, ReactNode } from "react";
import { FreezeDemo } from "@/components/explain/FreezeDemo";
import { XminDemo } from "@/components/explain/XminDemo";
import { TermLink } from "@/components/TermLink";
import { C, MONO, SANS, termLinkStyle } from "@/components/ui";
import { TERMS } from "@/lib/terms";
import { requestOrigin } from "@/lib/origin";

interface ExplainContent {
  definition: ReactNode;
  Demo: ComponentType;
  seeAlso: { slug: string; label: string }[];
  footnote: string;
}

const m = (text: string) => <span style={{ fontFamily: MONO, color: C.strong }}>{text}</span>;

const CONTENT: Record<string, ExplainContent> = {
  xmin: {
    definition: (
      <>
        Every row version in a heap carries two hidden system columns: {m("xmin")}, the transaction
        id that created it, and {m("xmax")}, the transaction id that deleted or superseded it.
        Postgres never overwrites a row in place — an UPDATE writes a new version and stamps the old
        one&rsquo;s xmax. A transaction sees a version only if its xmin is committed and visible to
        that transaction&rsquo;s snapshot, and its xmax is not. Old versions stay on disk until
        vacuum proves no live snapshot can still need them; that backlog is what {m("n_dead_tup")}{" "}
        counts.
      </>
    ),
    Demo: XminDemo,
    seeAlso: [{ slug: "autovacuum_freeze_max_age", label: "autovacuum_freeze_max_age" }],
    footnote:
      "The demo shows one heap page and ignores HOT chains, index entries, and the visibility map. Real xids are 32-bit and compared modulo 2^31; see PostgreSQL 16 docs §66.4 “Visibility Map” and §25.1.5 “Preventing Transaction ID Wraparound Failures”.",
  },
  autovacuum_freeze_max_age: {
    definition: (
      <>
        Transaction ids are 32-bit and wrap. A row whose <TermLink slug="xmin">xmin</TermLink> falls
        more than 2^31 transactions behind the current xid would appear to be in the future, so
        Postgres must mark old rows frozen before that happens. {m("autovacuum_freeze_max_age")} is
        the table age at which autovacuum stops being optional: a worker is launched even if the
        table is otherwise idle and autovacuum is switched off. Setting it low means frequent
        aggressive scans; setting it high means fewer, larger ones and less margin before the 2^31
        limit forces a single-user shutdown.
      </>
    ),
    Demo: FreezeDemo,
    seeAlso: [{ slug: "xmin", label: "xmin" }],
    footnote:
      "Margin assumes the aggressive run completes before the next threshold. It does not: at 1,000,000 xids of remaining headroom Postgres refuses new write transactions and the cluster requires single-user VACUUM. The chart holds the table age flat during a run; a real run takes time proportional to unfrozen pages.",
  },
};

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
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "36px 24px 96px" }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div style={{ fontFamily: MONO, fontSize: 11, color: C.faint }}>/explain/{slug}</div>
      <h1
        style={{
          fontFamily: MONO,
          fontSize: 28,
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

      <Demo />

      <div style={{ marginTop: 26, display: "flex", flexDirection: "column", gap: 7 }}>
        <div style={{ fontFamily: MONO, fontSize: 11, color: C.faint, letterSpacing: "0.05em" }}>
          SEE ALSO
        </div>
        {seeAlso.map((s) => (
          <TermLink key={s.slug} slug={s.slug} style={{ fontSize: 13, alignSelf: "flex-start" }}>
            {s.label}
          </TermLink>
        ))}
        <Link
          href="/report"
          className="term-link"
          style={{ ...termLinkStyle, fontSize: 13, alignSelf: "flex-start" }}
        >
          ← back to events.event_log
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
