/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { HeaderChip } from "@/components/HeaderChip";
import { C, MONO } from "@/components/ui";

export function Header() {
  return (
    <div
      className="site-header"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 20,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 24,
        height: 46,
        borderBottom: `1px solid ${C.border08}`,
        background: "rgba(8,8,10,0.86)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <Link
          href="/"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            fontFamily: MONO,
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "0.02em",
            color: "#fff",
          }}
        >
          <img
            src="/brand/mark-512-light.png"
            alt=""
            width={15}
            height={15}
            style={{ display: "block" }}
          />
          robovac
        </Link>
        <HeaderChip />
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
        <Link href="/demo">/demo</Link>
        <Link href="/mcp">/mcp</Link>
        <Link href="/arcana">/arcana</Link>
      </div>
    </div>
  );
}
