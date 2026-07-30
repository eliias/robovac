import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
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

export const metadata: Metadata = {
  title: "robovac",
  description: "Explains and tunes Postgres autovacuum settings, one table at a time.",
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
