import type { Metadata } from "next";

// Next.js replaces a page's openGraph/twitter object instead of a deep
// merge, so a page that sets only a title silently drops the card image.
// Every page builds its complete block through this helper.
export interface SocialInput {
  title: string;
  description: string;
  /** The page path for og:url, resolved against metadataBase. */
  path: string;
  type?: "website" | "article";
  image?: { url: string; alt: string };
}

const DEFAULT_CARD = {
  url: "/brand/og-default.png",
  alt: "robovac: Postgres vacuum settings, explained and tuned",
};

export function social({
  title,
  description,
  path,
  type = "website",
  image = DEFAULT_CARD,
}: SocialInput): Pick<Metadata, "openGraph" | "twitter"> {
  return {
    openGraph: {
      type,
      siteName: "robovac",
      locale: "en_US",
      url: path,
      title,
      description,
      images: [{ url: image.url, type: "image/png", width: 1200, height: 630, alt: image.alt }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [{ url: image.url, alt: image.alt }],
    },
  };
}
