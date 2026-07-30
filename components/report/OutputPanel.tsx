"use client";

import { C, MONO, panel, panelHeader } from "@/components/ui";
import { fmtVal } from "@/lib/core/format";
import { SETTINGS, type Values } from "@/lib/core/settings";
import type { Snapshot } from "@/lib/core/snapshot";

export function buildSql(snap: Snapshot, values: Values): string {
  const changed = SETTINGS.filter((d) => values[d.key] !== snap.current[d.key]);
  if (!changed.length) {
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
  onCopy,
}: {
  snap: Snapshot;
  values: Values;
  copied: boolean;
  onCopy: (sql: string) => void;
}) {
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
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre
        style={{
          padding: 12,
          fontFamily: MONO,
          fontSize: 11.5,
          lineHeight: 1.7,
          color: C.code,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {sql}
      </pre>
    </div>
  );
}
