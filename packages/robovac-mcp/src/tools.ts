import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { encodeReport } from "../../../lib/core/codec";
import { optimize } from "../../../lib/core/optimize";
import type { Hints } from "../../../lib/core/snapshot";
import { TERMS, termHref } from "../../../lib/terms";
import { candidatesSql, snapshotSql } from "./queries";
import { buildSnapshot, verdict } from "./report";

// robovac never connects to a database and reads no environment variables.
// The agent runs the SQL on its own connection and passes the rows back.
const DEFAULT_BASE_URL = "https://robovac.hannesmoser.at";

const SNAPSHOT_INSTRUCTIONS =
  "Run this read-only query on your own database connection twice, 30-60 seconds apart " +
  "(a role in pg_monitor is enough). Then call create_report with both result rows as " +
  "first and second. The delay is what turns counters into rates, so do not skip it. " +
  "Connect to the primary: replicas keep their own pg_stat_user_tables counters, which " +
  "read as zero or null there.";

/** What to expect when the agent applies the proposed settings. */
function applyNotes(table: string): string[] {
  return [
    `ALTER TABLE ... SET takes a SHARE UPDATE EXCLUSIVE lock. It does not block queries, but it queues behind a running anti-wraparound vacuum, and a lock_timeout can kill it silently. Verify after the apply: SELECT reloptions FROM pg_class WHERE oid = '${table}'::regclass;`,
    "Expect one catch-up vacuum right after the apply. Near-free runs can then re-trigger every naptime while dead-but-not-removable rows drain; the catch-up run held the xmin horizon open, so this loop is a transient. A loop that persists for hours means the threshold sits under the standing floor (churn times snapshot-horizon age): raise the threshold.",
    "Reloptions do not survive a table rewrite (pg_repack, pg-osc): re-apply after one.",
  ];
}

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

const baseUrlInput = z
  .string()
  .url()
  .optional()
  .describe(`Base URL of the robovac web app (default ${DEFAULT_BASE_URL})`);

export function registerTools(server: McpServer): void {
  server.tool(
    "get_snapshot_sql",
    "Return the read-only statistics SQL for one table. robovac never connects to a database: your agent runs this query twice on its own connection and passes both rows to create_report.",
    {
      schema: z.string().describe("Schema name, e.g. public"),
      table: z.string().describe("Table name"),
    },
    async ({ schema, table }) =>
      json({ sql: snapshotSql(schema, table), instructions: SNAPSHOT_INSTRUCTIONS }),
  );

  server.tool(
    "get_candidates_sql",
    "Return the read-only SQL that ranks tables by vacuum pressure (dead-tuple ratio plus xid age). Your agent runs it on its own connection to pick a table to snapshot.",
    {
      limit: z.number().int().min(1).max(50).default(10),
    },
    async ({ limit }) => json({ sql: candidatesSql(limit) }),
  );

  server.tool(
    "create_report",
    "Build the robovac report from two snapshot rows (the get_snapshot_sql query, run twice). Returns the report URL, a verdict, the workload pattern, warnings, optimized settings, and one reason per changed setting. Optional workload hints sharpen the classification.",
    {
      first: z.record(z.unknown()).describe("Result row of the first get_snapshot_sql run"),
      second: z.record(z.unknown()).describe("Result row of the second run, 30-60 s later"),
      pattern: z
        .enum(["append-only", "queue", "large-update-heavy", "mixed-oltp", "cold"])
        .optional()
        .describe("Override the workload classifier when you know the pattern"),
      replication_lag_budget: z
        .enum(["none", "tight", "relaxed"])
        .optional()
        .describe("How much vacuum I/O the replicas tolerate (default tight)"),
      storage: z.enum(["ssd", "hdd"]).optional(),
      ram_bytes: z
        .number()
        .positive()
        .optional()
        .describe("Server RAM, enables cluster-level advice"),
      max_workers: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Current autovacuum_max_workers"),
      long_transactions: z
        .boolean()
        .optional()
        .describe("The workload holds multi-minute transactions"),
      fk_heavy: z
        .boolean()
        .optional()
        .describe("FK checks or SELECT FOR UPDATE dominate (multixact pressure)"),
      base_url: baseUrlInput,
    },
    async ({
      first,
      second,
      pattern,
      replication_lag_budget,
      storage,
      ram_bytes,
      max_workers,
      long_transactions,
      fk_heavy,
      base_url,
    }) => {
      const provided: Hints = {
        pattern,
        replicationLagBudget: replication_lag_budget,
        storage,
        ramBytes: ram_bytes,
        maxWorkers: max_workers,
        longTransactions: long_transactions,
        fkHeavy: fk_heavy,
      };
      const hints = Object.values(provided).some((v) => v !== undefined) ? provided : undefined;
      const snap = buildSnapshot(first, second, hints);
      const proposal = optimize(snap);
      const url = `${base_url ?? DEFAULT_BASE_URL}/report#${encodeReport({ snap })}`;
      return json({
        url,
        url_note:
          "Relay this URL by copy, never by re-typing it: one changed character makes the link unusable, and the report page rejects it as damaged.",
        verdict: verdict(snap),
        pattern: proposal.pattern,
        warnings: proposal.warnings,
        diagnosis: proposal.diagnosis,
        proposed: proposal.values,
        reasons: proposal.reasons,
        companions: proposal.companions,
        apply_notes: applyNotes(snap.table),
      });
    },
  );

  server.tool(
    "explain_term",
    "Return the stable robovac explain URL for a vacuum term.",
    {
      term: z.string().describe("A term slug, e.g. xmin or autovacuum_freeze_max_age"),
      base_url: baseUrlInput,
    },
    async ({ term, base_url }) => {
      const slug = term.trim().toLowerCase().replaceAll(" ", "-");
      const entry = TERMS.find((t) => t.slug === slug);
      if (!entry) {
        throw new Error(
          `unknown term "${term}". Known terms: ${TERMS.map((t) => t.slug).join(", ")}`,
        );
      }
      return json({ url: `${base_url ?? DEFAULT_BASE_URL}${termHref(entry.slug)}` });
    },
  );
}
