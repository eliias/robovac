import type { Metadata } from "next";
import { HomeView } from "@/components/home/HomeView";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function Home() {
  return <HomeView />;
}
