"use client";

import type { CSSProperties, ReactNode } from "react";
import { C, MONO, SANS } from "@/components/ui";

/**
 * The three components every error and empty state is built from:
 * notice bar (above the report header), unknown cell value (inside the
 * stat grid), unavailable frame (in place of a chart body).
 */

export function NoticeBar({
  severity,
  title,
  body,
  action,
}: {
  severity: "neutral" | "warn";
  title: string;
  body: ReactNode;
  action?: { label: string; onClick?: () => void; href?: string };
}) {
  const dot = severity === "warn" ? C.warn : C.dim;
  const border = severity === "warn" ? "oklch(0.70 0.10 62 / 0.32)" : C.borderStrong;
  const button: CSSProperties = {
    flex: "none",
    fontFamily: MONO,
    fontSize: 11,
    color: C.body,
    background: C.control,
    border: `1px solid ${C.borderStrong}`,
    borderRadius: 3,
    padding: "6px 10px",
    cursor: "pointer",
    whiteSpace: "nowrap",
    textDecoration: "none",
  };
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 11,
        border: `1px solid ${border}`,
        background: C.panel,
        padding: "11px 13px",
      }}
    >
      <span
        style={{
          flex: "none",
          marginTop: 5,
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: dot,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: MONO, fontSize: 12.5, color: "#fff" }}>{title}</div>
        <p
          style={{
            margin: "5px 0 0",
            fontFamily: SANS,
            fontSize: 13.5,
            lineHeight: 1.55,
            color: C.muted,
            maxWidth: 640,
          }}
        >
          {body}
        </p>
      </div>
      {action &&
        (action.href ? (
          <a className="btn-secondary" href={action.href} style={button}>
            {action.label}
          </a>
        ) : (
          <button className="btn-secondary" onClick={action.onClick} style={button}>
            {action.label}
          </button>
        ))}
    </div>
  );
}

/**
 * The value part of a stat cell whose number is unknown. Same geometry as a
 * normal value so the grid does not shift: dash on the value line, the
 * reason beneath at 9.5px. Never a zero, never a blank.
 */
export function UnknownValue({ reason }: { reason: string }) {
  return (
    <>
      <span style={{ color: C.ghost }}>—</span>
      <div style={{ fontFamily: MONO, fontSize: 9.5, color: C.ghost, marginTop: 1 }}>{reason}</div>
    </>
  );
}

/**
 * A chart body that cannot be drawn: hatch and one sentence. The frame and
 * its figure number stay, so the reader learns the figure exists and why it
 * is empty.
 */
export function UnavailableBody({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        minHeight: 96,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background:
          "repeating-linear-gradient(135deg,rgba(255,255,255,0.022) 0 6px,transparent 6px 12px)",
      }}
    >
      <span
        style={{
          fontFamily: MONO,
          fontSize: 11,
          color: C.faint,
          textAlign: "center",
          padding: "0 16px",
          lineHeight: 1.7,
        }}
      >
        {children}
      </span>
    </div>
  );
}
