import type { Metadata } from "next";
import { ReportView } from "@/components/report/ReportView";

export const metadata: Metadata = {
  title: "robovac · report",
};

export default function ReportPage() {
  return <ReportView />;
}
