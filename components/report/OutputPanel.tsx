"use client";

import { C, MONO, panel, panelHeader } from "@/components/ui";
import { useViewport } from "@/components/useViewport";
import { fmtVal } from "@/lib/core/format";
import { SETTINGS, type Values } from "@/lib/core/settings";
import { isSmallTable, type Snapshot } from "@/lib/core/snapshot";

export function buildSql(snap: Snapshot, values: Values): string {
  const changed = SETTINGS.filter((d) => values[d.key] !== snap.current[d.key]);
  if (!changed.length) {
    if (isSmallTable(snap)) {
      return `-- no changes recommended for a table this size.`;
    }
    return `-- sliders match the current settings on ${snap.table}.\n-- nothing to apply.`;
  }
  const sqlNum = (d: (typeof SETTINGS)[number]) => {
    const raw = fmtVal(d, values[d.key]).replace(/,/g, "");
    return d.fmt === "frac" ? String(parseFloat(raw)) : raw;
  };
  return (
    `ALTER TABLE ${snap.table} SET (\n` +
    changed.map((d) => `  ${d.key} = ${sqlNum(d)}`).join(",\n") +
    "\n);"
  );
}

export function OutputPanel({
  snap,
  values,
  copied,
  canCopy,
  onCopy,
}: {
  snap: Snapshot;
  values: Values;
  copied: boolean;
  /** E1: without clipboard access the button reads "select all". */
  canCopy: boolean;
  onCopy: (sql: string) => void;
}) {
  const { mobile } = useViewport();
  const changedCount = SETTINGS.filter((d) => values[d.key] !== snap.current[d.key]).length;
  const sql = buildSql(snap, values);
  return (
    <div style={panel}>
      <div style={{ ...panelHeader, alignItems: "center" }}>
        <span style={{ fontFamily: MONO, fontSize: 11, color: C.strong, letterSpacing: "0.03em" }}>
          OUTPUT — {changedCount} CHANGED
        </span>
        <button
          className="copy-btn"
          onClick={() => onCopy(sql)}
          style={{
            fontFamily: MONO,
            fontSize: 10.5,
            color: C.muted,
            background: "transparent",
            border: `1px solid ${C.borderStrong}`,
            borderRadius: 3,
            padding: "3px 8px",
            cursor: "pointer",
          }}
        >
          {canCopy ? (copied ? "copied" : "copy") : "select all"}
        </button>
      </div>
      <pre
        id="output-sql"
        style={{
          padding: 12,
          fontFamily: MONO,
          fontSize: 11.5,
          lineHeight: 1.7,
          color: C.code,
          // The one intentional horizontal scroller: wrapping ALTER TABLE to a
          // phone width makes it unreadable and unpasteable.
          whiteSpace: mobile ? "pre" : "pre-wrap",
          overflowX: mobile ? "auto" : undefined,
          wordBreak: "break-word",
          ...(canCopy ? {} : { outline: "1px solid rgba(255,255,255,0.16)", outlineOffset: -1 }),
        }}
      >
        {sql}
      </pre>
      {!canCopy && (
        <div
          style={{
            padding: "9px 12px",
            borderTop: `1px solid ${C.border08}`,
            fontFamily: MONO,
            fontSize: 10.5,
            color: C.faint,
            lineHeight: 1.6,
          }}
        >
          Clipboard access needs a secure context. Select the block and copy.
        </div>
      )}
    </div>
  );
}
