import type { Metadata } from "next";
import { ExpiredState } from "@/components/report/ErrorState";
import { ReportView } from "@/components/report/ReportView";
import { linkStore } from "@/lib/links";
import { social } from "@/lib/social";

// Same treatment as /report: this renders someone's table names and
// statistics. Never index it, keep the generic card.
export const metadata: Metadata = {
  title: "robovac — table report",
  robots: { index: false, follow: false },
  alternates: { canonical: "/" },
  ...social({
    title: "A Postgres vacuum report",
    description: "One table's autovacuum settings, read and tuned.",
    path: "/",
  }),
};

// The store is read per request. Nothing here is cacheable.
export const dynamic = "force-dynamic";

export default async function ShortReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const stored = await linkStore().get(id);
  if (!stored) return <ExpiredState />;

  // Computed on the server so the client never reads the clock during
  // hydration, which would mismatch at a day boundary.
  const expiresInDays = Math.max(0, Math.ceil((stored.expiresAt - Date.now()) / 86_400_000));
  return <ReportView fragment={stored.fragment} expiresInDays={expiresInDays} />;
}
