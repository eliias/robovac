import type { Metadata } from "next";
import { C, MONO, SANS } from "@/components/ui";
import { social } from "@/lib/social";
import entries from "./entries.json";

const REPO = "https://github.com/eliias/robovac";

interface Entry {
  hash: string;
  date: string;
  type: string;
  scope: string | null;
  breaking: boolean;
  description: string;
}

export const metadata: Metadata = {
  title: "Changelog — robovac",
  description:
    "Every feature, fix, and breaking change, read straight from the conventional commit history.",
  alternates: { canonical: "/changelog" },
  ...social({
    title: "Changelog",
    description:
      "Every feature, fix, and breaking change, read straight from the conventional commit history.",
    path: "/changelog",
  }),
};

function byMonth(list: Entry[]): [string, Entry[]][] {
  const months = new Map<string, Entry[]>();
  for (const e of list) {
    const month = e.date.slice(0, 7);
    const group = months.get(month);
    if (group) group.push(e);
    else months.set(month, [e]);
  }
  return [...months.entries()];
}

export default function ChangelogPage() {
  return (
    <div className="page-pad" style={{ maxWidth: 980, margin: "0 auto" }}>
      <div style={{ fontFamily: MONO, fontSize: 11, color: C.faint }}>/changelog</div>
      <h1
        className="page-h1"
        style={{
          fontFamily: MONO,
          fontWeight: 500,
          color: "#fff",
          margin: "6px 0 0",
        }}
      >
        Changelog
      </h1>
      <p
        style={{
          maxWidth: 680,
          fontFamily: SANS,
          fontSize: 15,
          lineHeight: 1.65,
          color: C.muted,
          margin: "16px 0 0",
        }}
      >
        Every feature, fix, and breaking change, read straight from the conventional commit history.
        The rest of the history stays in git.
      </p>
      {byMonth(entries as Entry[]).map(([month, group]) => (
        <section key={month}>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 11,
              color: C.dim,
              borderBottom: `1px solid ${C.borderStrong}`,
              marginTop: 28,
              paddingBottom: 8,
            }}
          >
            {month}
          </div>
          {group.map((e) => (
            <div
              key={e.hash}
              style={{
                display: "flex",
                gap: 16,
                alignItems: "baseline",
                padding: "11px 0",
                borderBottom: `1px solid ${C.hair}`,
              }}
            >
              <span style={{ fontFamily: MONO, fontSize: 11, color: C.ghost, flexShrink: 0 }}>
                {e.date}
              </span>
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 11.5,
                  color: e.breaking ? C.warn : C.dim,
                  flexShrink: 0,
                }}
              >
                {e.type}
                {e.scope ? `(${e.scope})` : ""}
                {e.breaking ? "!" : ""}
              </span>
              <span
                style={{
                  fontFamily: SANS,
                  fontSize: 13.5,
                  lineHeight: 1.5,
                  color: C.body,
                  flexGrow: 1,
                }}
              >
                {e.description}
              </span>
              <a
                href={`${REPO}/commit/${e.hash}`}
                style={{ fontFamily: MONO, fontSize: 10.5, color: C.ghost, flexShrink: 0 }}
              >
                {e.hash}
              </a>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
