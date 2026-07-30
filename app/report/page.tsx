import type { Metadata } from "next";
import { ReportView } from "@/components/report/ReportView";

// The report carries someone's table names and statistics in its fragment.
// Never index it, and keep the generic card: crawlers cannot see the fragment.
export const metadata: Metadata = {
  title: "robovac — table report",
  robots: { index: false, follow: false },
  alternates: { canonical: "/" },
  openGraph: {
    title: "A Postgres vacuum report",
    description: "One table's autovacuum settings, read and tuned.",
  },
  twitter: {
    title: "A Postgres vacuum report",
    description: "One table's autovacuum settings, read and tuned.",
  },
};

export default function ReportPage() {
  return <ReportView />;
}
