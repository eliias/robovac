"use client";

import { usePathname } from "next/navigation";
import { C, MONO } from "@/components/ui";

/** Route-aware header chip. The homepage carries no chip: the page says it. */
export function HeaderChip() {
  const pathname = usePathname();
  if (pathname === "/") return null;
  const text = pathname.startsWith("/report") ? "snapshot · read-only" : "reference";
  return (
    <span
      className="m-hide"
      style={{
        fontFamily: MONO,
        fontSize: 10.5,
        color: C.faint,
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 3,
        padding: "1px 5px",
      }}
    >
      {text}
    </span>
  );
}
