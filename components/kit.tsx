import type { CSSProperties, ReactNode } from "react";
import { C, MONO, SANS, panelHeader } from "@/components/ui";

/**
 * The shapes every page is built from. Each one existed four or five times as
 * inline styles before it lived here, which is why the values below are single
 * numbers and not props: a page picks the shape, never its geometry.
 */

/** The path eyebrow, the title, and the opening paragraph. Every page opens this way. */
export function PageHeader({
  path,
  title,
  children,
}: {
  path: string;
  title: string;
  /** The lede. Wrap extra paragraphs in <Lede> to keep them on the same measure. */
  children?: ReactNode;
}) {
  return (
    <>
      <div style={{ fontFamily: MONO, fontSize: 11, color: C.faint }}>{path}</div>
      <h1
        className="page-h1"
        style={{
          fontFamily: MONO,
          fontWeight: 500,
          letterSpacing: "-0.01em",
          color: "#fff",
          margin: "6px 0 0",
        }}
      >
        {title}
      </h1>
      {children}
    </>
  );
}

/** A paragraph on the page's reading measure. `dim` is the second-rank aside. */
export function Lede({ children, dim }: { children: ReactNode; dim?: boolean }) {
  return (
    <p
      style={{
        maxWidth: 700,
        fontFamily: SANS,
        fontSize: 15,
        lineHeight: 1.65,
        color: dim ? C.dim : C.muted,
        margin: dim ? "12px 0 0" : "16px 0 0",
      }}
    >
      {children}
    </p>
  );
}

/** The header bar inside a panel: a label on the left, a caption on the right. */
export function PanelHead({ title, caption }: { title: string; caption?: ReactNode }) {
  return (
    <div style={panelHeader}>
      <span style={{ fontFamily: MONO, fontSize: 11, color: C.strong, letterSpacing: "0.03em" }}>
        {title}
      </span>
      {caption !== undefined && (
        <span style={{ fontFamily: MONO, fontSize: 10, color: C.faint }}>{caption}</span>
      )}
    </div>
  );
}

/** The ruled heading that opens a section of a page. */
export function SectionHead({
  children,
  caption,
  onClick,
}: {
  children: ReactNode;
  caption?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <div
      className={onClick ? "group-header" : undefined}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 12,
        borderBottom: `1px solid ${C.borderStrong}`,
        paddingBottom: 7,
        ...(onClick ? { cursor: "pointer", userSelect: "none" } : {}),
      }}
    >
      <h2
        style={{
          margin: 0,
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          fontFamily: MONO,
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: "0.06em",
          color: "#fff",
        }}
      >
        {children}
      </h2>
      {caption !== undefined && (
        <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.faint, textAlign: "right" }}>
          {caption}
        </span>
      )}
    </div>
  );
}

export interface StatCell {
  label: string;
  value: ReactNode;
  color?: string;
}

/**
 * The label-over-value grid: hairline gaps drawn by the background showing
 * through, one cell per figure. `columns` is the only thing that varies.
 */
export function StatGrid({
  cells,
  columns,
  style,
}: {
  cells: StatCell[];
  columns: number;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        display: "grid",
        gap: 1,
        background: C.border08,
        border: `1px solid ${C.border08}`,
        gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))`,
        ...style,
      }}
    >
      {cells.map((cell) => (
        <div key={cell.label} style={{ background: C.cell, padding: "10px 12px" }}>
          <div style={{ fontFamily: MONO, fontSize: 10, color: C.faint, letterSpacing: "0.03em" }}>
            {cell.label}
          </div>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 13.5,
              color: cell.color ?? C.strong,
              marginTop: 3,
            }}
          >
            {cell.value}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The rule and the small print that closes a page. */
export function PageNotes({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        marginTop: 40,
        paddingTop: 14,
        borderTop: `1px solid ${C.border08}`,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        maxWidth: 840,
        fontFamily: MONO,
        fontSize: 10.5,
        color: C.faint,
        lineHeight: 1.6,
      }}
    >
      {children}
    </div>
  );
}

/** Page notes carrying the superscript numbers the prose above points at. */
export function Footnotes({ notes }: { notes: ReactNode[] }) {
  return (
    <PageNotes>
      {notes.map((note, i) => (
        <div key={i} style={{ display: "flex", gap: 9 }}>
          <span>{i + 1}</span>
          <span>{note}</span>
        </div>
      ))}
    </PageNotes>
  );
}
