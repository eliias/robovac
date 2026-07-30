import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { requestOrigin } from "@/lib/origin";
import { Header } from "@/components/Header";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
});

// The base url comes from the request host (og:image needs an absolute url),
// so the same image works on any domain without configuration.
export async function generateMetadata(): Promise<Metadata> {
  return { ...baseMetadata, metadataBase: new URL(await requestOrigin()) };
}

const OG_ALT = "robovac: Postgres vacuum settings, explained and tuned";

const baseMetadata: Metadata = {
  title: "robovac — Postgres vacuum settings, explained and tuned",
  description:
    "Take a statistics snapshot of one Postgres table and see what autovacuum is doing, what it should do, and the exact ALTER TABLE that gets you there. No account, no agent, no write access.",
  icons: {
    icon: [
      { url: "/brand/favicon.ico", sizes: "32x32" },
      { url: "/brand/favicon.svg", type: "image/svg+xml" },
    ],
    apple: "/brand/apple-touch-icon.png",
  },
  manifest: "/brand/site.webmanifest",
  openGraph: {
    type: "website",
    siteName: "robovac",
    locale: "en_US",
    title: "Postgres vacuum settings, explained and tuned",
    description: "One table, one link, no account.",
    images: [
      { url: "/brand/og-default.png", type: "image/png", width: 1200, height: 630, alt: OG_ALT },
      { url: "/brand/og-square.png", type: "image/png", width: 1200, height: 1200, alt: OG_ALT },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Postgres vacuum settings, explained and tuned",
    description: "One table, one link, no account.",
    images: [{ url: "/brand/og-default.png", alt: OG_ALT }],
  },
  other: {
    "msapplication-TileColor": "#08080a",
    "msapplication-TileImage": "/brand/mstile-150.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#08080a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body>
        <div
          style={{
            background: "#08080a",
            color: "#d6d6d9",
            fontFamily: "var(--font-sans), system-ui, sans-serif",
            fontSize: 14,
            lineHeight: 1.55,
            minHeight: "100vh",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <Header />
          {children}
        </div>
      </body>
    </html>
  );
}
