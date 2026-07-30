import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { headers } from "next/headers";
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
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return { ...baseMetadata, metadataBase: new URL(`${proto}://${host}`) };
}

const baseMetadata: Metadata = {
  title: "robovac",
  description: "Postgres vacuum settings, explained and tuned.",
  icons: {
    icon: [
      { url: "/brand/favicon.ico", sizes: "32x32" },
      { url: "/brand/favicon.svg", type: "image/svg+xml" },
    ],
    apple: "/brand/apple-touch-icon.png",
  },
  manifest: "/brand/site.webmanifest",
  openGraph: {
    title: "robovac",
    description: "Postgres vacuum settings, explained and tuned.",
    images: [{ url: "/brand/og-image.png", width: 1200, height: 630 }],
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
