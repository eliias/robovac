import Link from "next/link";
import { C, MONO } from "@/components/ui";

export function Header() {
  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 20,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 24,
        height: 46,
        padding: "0 24px",
        borderBottom: `1px solid ${C.border08}`,
        background: "rgba(8,8,10,0.86)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <Link
          href="/report"
          style={{
            fontFamily: MONO,
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "0.02em",
            color: "#fff",
          }}
        >
          robovac
        </Link>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 10.5,
            color: C.faint,
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 3,
            padding: "1px 5px",
          }}
        >
          snapshot · read-only
        </span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 18,
          fontFamily: MONO,
          fontSize: 11.5,
          color: C.dim,
        }}
      >
        <Link href="/report" className="navlink">
          /report
        </Link>
        <Link href="/mcp" className="navlink">
          /mcp
        </Link>
        <Link href="/arcana" className="navlink">
          /arcana
        </Link>
      </div>
    </div>
  );
}
