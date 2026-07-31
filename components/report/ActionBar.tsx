"use client";

import { C, MONO, primaryButton, secondaryButton } from "@/components/ui";
import { fmtCadence } from "@/lib/core/format";

/**
 * Mobile only: exactly two actions, always reachable. Everything else (resets,
 * the SQL text itself) stays in the page, where it can be read before use.
 */
export function ActionBar({
  pending,
  periodDays,
  zeroCadence,
  copied,
  onOptimize,
  onCopy,
}: {
  pending: number;
  periodDays: number;
  /** The phrase after "vacuum" when the rate is zero. */
  zeroCadence: string;
  copied: boolean;
  onOptimize: () => void;
  onCopy: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 20,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 16px calc(10px + env(safe-area-inset-bottom))",
        borderTop: `1px solid ${C.border08}`,
        background: "rgba(8,8,10,0.86)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div
        style={{
          flex: 1,
          minWidth: 0,
          fontFamily: MONO,
          fontSize: 10.5,
          color: C.faint,
          lineHeight: 1.5,
          whiteSpace: "nowrap",
        }}
      >
        <div style={{ color: pending > 0 ? C.warn : C.dim }}>{pending} proposed pending</div>
        <div>vacuum {fmtCadence(periodDays, zeroCadence)}</div>
      </div>
      <button
        className="btn-secondary"
        onClick={onCopy}
        style={{ ...secondaryButton, height: 44, padding: "0 14px" }}
      >
        {copied ? "copied" : "copy SQL"}
      </button>
      <button
        className="btn-primary"
        onClick={onOptimize}
        style={{ ...primaryButton, height: 44, padding: "0 16px" }}
      >
        {pending === 0 ? "✓ optimized" : "→ optimize"}
      </button>
    </div>
  );
}
