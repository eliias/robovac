"use client";

import { useRef, useState } from "react";
import { C, MONO, SANS, primaryButton, secondaryButton } from "@/components/ui";
import { selectContents, useClipboard } from "@/components/useClipboard";
import type { CodecError } from "@/lib/core/codec";

/**
 * The four blocked states (B1-B4): no report is possible, so the page says
 * what arrived, what was expected, the likely cause, and one way forward.
 * Neutral for the empty link (nothing failed), warn for the other three.
 */

function Eyebrow({ label, warn }: { label: string; warn: boolean }) {
  const color = warn ? C.warn : C.dim;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: color }} />
      <span style={{ fontFamily: MONO, fontSize: 11, color, letterSpacing: "0.04em" }}>
        {label}
      </span>
    </div>
  );
}

function Title({ children }: { children: string }) {
  return (
    <h1
      style={{
        margin: "12px 0 0",
        fontFamily: MONO,
        fontSize: 22,
        fontWeight: 500,
        color: "#fff",
        letterSpacing: "-0.01em",
      }}
    >
      {children}
    </h1>
  );
}

function Body({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        margin: "12px 0 0",
        fontFamily: SANS,
        fontSize: 14.5,
        lineHeight: 1.6,
        color: C.muted,
      }}
    >
      {children}
    </p>
  );
}

function Footer({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: MONO,
        fontSize: 10.5,
        color: C.faint,
        lineHeight: 1.6,
        marginTop: 16,
        paddingTop: 12,
        borderTop: `1px solid ${C.border08}`,
      }}
    >
      {children}
    </div>
  );
}

const mono = { fontFamily: MONO, color: C.strong } as const;

function TruncatedState({ error }: { error: CodecError }) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [url, setUrl] = useState("");
  const openPasted = () => {
    const hash = url.indexOf("#");
    if (hash < 0) return;
    window.location.hash = url.slice(hash);
    window.location.reload();
  };
  return (
    <div style={{ maxWidth: 640 }}>
      <Eyebrow label="LINK INCOMPLETE" warn />
      <Title>This link is missing its second half.</Title>
      <Body>
        The snapshot travels in the part of the URL after <span style={mono}>#</span>. Chat clients,
        ticket systems and mail clients cut long URLs there, so the report cannot be rebuilt from
        what arrived.
      </Body>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 1,
          background: C.border08,
          border: `1px solid ${C.border08}`,
          marginTop: 16,
        }}
      >
        <div style={{ background: C.cell, padding: "10px 12px" }}>
          <div style={{ fontFamily: MONO, fontSize: 10, color: C.faint, letterSpacing: "0.03em" }}>
            RECEIVED
          </div>
          <div style={{ fontFamily: MONO, fontSize: 13.5, color: C.strong, marginTop: 3 }}>
            {error.received ?? 0} bytes
          </div>
        </div>
        <div style={{ background: C.cell, padding: "10px 12px" }}>
          <div style={{ fontFamily: MONO, fontSize: 10, color: C.faint, letterSpacing: "0.03em" }}>
            EXPECTED
          </div>
          <div style={{ fontFamily: MONO, fontSize: 13.5, color: C.strong, marginTop: 3 }}>
            {error.expected !== undefined ? (
              <>{error.expected} bytes</>
            ) : (
              <>
                —<span style={{ color: C.faint, fontSize: 11 }}> · no length prefix</span>
              </>
            )}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 9, flexWrap: "wrap", marginTop: 18 }}>
        <a className="btn-primary" href="/" style={{ ...primaryButton, textDecoration: "none" }}>
          → build a fresh report
        </a>
        <button
          className="btn-secondary"
          onClick={() => setPasteOpen(true)}
          style={secondaryButton}
        >
          paste the whole URL instead
        </button>
      </div>
      {pasteOpen && (
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && openPasted()}
            placeholder="https://…/report#1.…"
            style={{
              flex: 1,
              fontFamily: MONO,
              fontSize: 12,
              color: C.body,
              background: C.bg,
              border: `1px solid ${C.borderStrong}`,
              borderRadius: 3,
              padding: "8px 10px",
              outline: "none",
            }}
          />
          <button className="btn-secondary" onClick={openPasted} style={secondaryButton}>
            open
          </button>
        </div>
      )}
      <Footer>
        Ask whoever sent it to copy the link again (the copy button on the report writes the whole
        thing). Nothing was lost on our side: robovac never had a copy of it.
      </Footer>
    </div>
  );
}

function VersionState({ error }: { error: CodecError }) {
  return (
    <div style={{ maxWidth: 640 }}>
      <Eyebrow label="LINK OUTDATED" warn />
      <Title>This link was built by a different robovac.</Title>
      <Body>
        {error.issues[0]}. This build reads versions 1 and 2. A report is a set of numbers people
        act on, so robovac refuses to render one that would be missing parts of itself.
      </Body>
      <div style={{ display: "flex", gap: 9, flexWrap: "wrap", marginTop: 18 }}>
        <a className="btn-primary" href="/" style={{ ...primaryButton, textDecoration: "none" }}>
          → build a fresh report
        </a>
        <a
          className="btn-secondary"
          href="/mcp"
          style={{ ...secondaryButton, textDecoration: "none" }}
        >
          how links are built
        </a>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{ maxWidth: 640 }}>
      <Eyebrow label="NOTHING TO REPORT" warn={false} />
      <Title>No snapshot in this link.</Title>
      <Body>
        The report page renders a snapshot that travels in the URL. This one arrived empty: most
        likely a bookmark of <span style={mono}>/report</span>, or a link whose fragment was
        stripped entirely.
      </Body>
      <div style={{ display: "flex", gap: 9, flexWrap: "wrap", marginTop: 18 }}>
        <a className="btn-primary" href="/" style={{ ...primaryButton, textDecoration: "none" }}>
          → build a report
        </a>
        <a
          className="btn-secondary"
          href="/demo"
          style={{ ...secondaryButton, textDecoration: "none" }}
        >
          open a demo report
        </a>
      </div>
    </div>
  );
}

function InvalidState({ error }: { error: CodecError }) {
  const { canCopy } = useClipboard();
  const [copied, setCopied] = useState(false);
  const [showPayload, setShowPayload] = useState(false);
  const payloadRef = useRef<HTMLPreElement>(null);
  const copyPayload = () => {
    if (canCopy && error.payloadText) {
      navigator.clipboard.writeText(error.payloadText).then(() => setCopied(true));
    } else {
      setShowPayload(true);
      setTimeout(() => selectContents(payloadRef.current), 0);
    }
  };
  return (
    <div style={{ maxWidth: 640 }}>
      <Eyebrow label="PAYLOAD INVALID" warn />
      <Title>This link decodes, but the snapshot is not usable.</Title>
      <Body>
        The agent that built this link either read a different relation than it thought or filled a
        field it did not have. What failed, precisely enough to paste back as a correction:
      </Body>
      <div
        style={{
          border: `1px solid ${C.border}`,
          background: C.panel,
          marginTop: 14,
          padding: "10px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 5,
        }}
      >
        {error.issues.map((issue, i) => (
          <div key={i} style={{ fontFamily: MONO, fontSize: 11.5, lineHeight: 1.6, color: C.code }}>
            {issue}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 9, flexWrap: "wrap", marginTop: 18 }}>
        <a className="btn-primary" href="/" style={{ ...primaryButton, textDecoration: "none" }}>
          → build one from the query
        </a>
        <button className="btn-secondary" onClick={copyPayload} style={secondaryButton}>
          {copied ? "copied" : canCopy ? "copy the raw payload" : "select the raw payload"}
        </button>
      </div>
      {showPayload && (
        <pre
          ref={payloadRef}
          style={{
            marginTop: 12,
            padding: 11,
            fontFamily: MONO,
            fontSize: 10.5,
            lineHeight: 1.6,
            color: C.code,
            background: C.bg,
            border: `1px solid ${C.border}`,
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            outline: "1px solid rgba(255,255,255,0.16)",
            outlineOffset: -1,
          }}
        >
          {error.payloadText}
        </pre>
      )}
      <Footer>Ranges are validated on decode, not at first use.</Footer>
    </div>
  );
}

export function ErrorState({ error }: { error: CodecError }) {
  return (
    <div className="page-pad" style={{ maxWidth: 980, margin: "0 auto" }}>
      <div style={{ fontFamily: MONO, fontSize: 11, color: C.faint }}>/report</div>
      <div style={{ marginTop: 18 }}>
        {error.kind === "empty" && <EmptyState />}
        {error.kind === "truncated" && <TruncatedState error={error} />}
        {error.kind === "version" && <VersionState error={error} />}
        {error.kind === "invalid" && <InvalidState error={error} />}
      </div>
    </div>
  );
}
