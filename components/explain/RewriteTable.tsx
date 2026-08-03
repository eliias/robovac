import { C, MONO, SANS } from "@/components/ui";

const ROWS = [
  {
    tool: "VACUUM FULL",
    lock: "ACCESS EXCLUSIVE, the whole run",
    needs: "Nothing, it is core SQL",
    risk: "Blocks reads and writes until it finishes",
  },
  {
    tool: "pg_repack",
    lock: "Brief ACCESS EXCLUSIVE at the start and at the swap",
    needs: "The extension and its client CLI, a primary key or unique index",
    risk: "Blocks DDL for the whole run, a killed run leaves a repack schema",
  },
  {
    tool: "pg_squeeze",
    lock: "Brief lock at the swap only",
    needs:
      "The extension in shared_preload_libraries (restart), wal_level = logical, a replication slot, a replica identity",
    risk: "Copies rows as stored, so the space of dropped columns stays",
  },
  {
    tool: "pg-osc",
    lock: "Brief ACCESS EXCLUSIVE at the swap",
    needs: "No server extension, a client CLI and a primary key",
    risk: "Runs outside the database, an interrupted run needs manual cleanup",
  },
];

const cell: React.CSSProperties = {
  background: C.panel,
  padding: "9px 11px",
  verticalAlign: "top",
  textAlign: "left",
  fontFamily: SANS,
  fontSize: 12.5,
  lineHeight: 1.55,
  color: C.muted,
  fontWeight: 400,
};

const head: React.CSSProperties = {
  ...cell,
  fontFamily: MONO,
  fontSize: 9.5,
  letterSpacing: "0.05em",
  color: C.faint,
};

/** How the four rewrite tools differ. No ranking: the constraint picks one. */
export function RewriteTable() {
  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            borderCollapse: "separate",
            borderSpacing: 1,
            background: C.border08,
            minWidth: 620,
            width: "100%",
          }}
        >
          <thead>
            <tr>
              <th style={{ ...head, width: "16%" }}>TOOL</th>
              <th style={{ ...head, width: "26%" }}>LOCK</th>
              <th style={{ ...head, width: "31%" }}>NEEDS</th>
              <th style={{ ...head, width: "27%" }}>MAIN RISK</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.tool}>
                <th style={{ ...cell, fontFamily: MONO, fontSize: 12, color: C.strong }}>
                  {r.tool}
                </th>
                <td style={cell}>{r.lock}</td>
                <td style={cell}>{r.needs}</td>
                <td style={cell}>{r.risk}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p
        style={{
          maxWidth: 680,
          margin: "10px 0 0",
          fontFamily: MONO,
          fontSize: 10.5,
          lineHeight: 1.6,
          color: C.faint,
        }}
      >
        No tool wins on merit here, the constraint picks it. With a maintenance window: VACUUM FULL.
        With wal_level = logical and a restart: pg_squeeze. Without either: pg_repack. With no
        extensions at all: pg-osc.
      </p>
    </div>
  );
}
