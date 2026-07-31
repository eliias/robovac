import type { Metadata } from "next";
import { ReportView } from "@/components/report/ReportView";
import { social } from "@/lib/social";

// The report carries someone's table names and statistics in its fragment.
// Never index it, and keep the generic card: crawlers cannot see the fragment.
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

export default function ReportPage() {
  return <ReportView />;
}
