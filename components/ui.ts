import type { CSSProperties } from "react";

export const C = {
  bg: "#08080a",
  panel: "#0b0b0d",
  cell: "#0c0c0e",
  control: "#101013",
  fg: "#ffffff",
  body: "#d6d6d9",
  strong: "#e8e8ea",
  muted: "#b8b8bd",
  dim: "#8a8a90",
  faint: "#6a6a70",
  ghost: "#55555c",
  code: "#c8c8cd",
  border: "rgba(255,255,255,0.09)",
  border08: "rgba(255,255,255,0.08)",
  borderStrong: "rgba(255,255,255,0.14)",
  hair: "rgba(255,255,255,0.055)",
  grid: "rgba(255,255,255,0.07)",
  warn: "oklch(0.70 0.10 62)",
} as const;

export const SANS = "var(--font-sans), system-ui, sans-serif";
export const MONO = "var(--font-mono), monospace";

export function mono(size: number, color: string, extra?: CSSProperties): CSSProperties {
  return { fontFamily: MONO, fontSize: size, color, ...extra };
}

export const panel: CSSProperties = {
  border: `1px solid ${C.border}`,
  background: C.panel,
};

export const panelHeader: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  padding: "9px 12px",
  borderBottom: `1px solid ${C.border08}`,
};

export const primaryButton: CSSProperties = {
  fontFamily: MONO,
  fontSize: 12.5,
  color: C.bg,
  background: "#ededf0",
  border: "none",
  borderRadius: 4,
  padding: "9px 12px",
  cursor: "pointer",
  fontWeight: 500,
};

export const secondaryButton: CSSProperties = {
  fontFamily: MONO,
  fontSize: 12,
  color: C.muted,
  background: C.control,
  border: "1px solid rgba(255,255,255,0.11)",
  borderRadius: 4,
  padding: "8px 10px",
  cursor: "pointer",
};

export const termLinkStyle: CSSProperties = {
  fontFamily: MONO,
  color: C.strong,
  borderBottom: "1px dotted #45454c",
  cursor: "pointer",
};
