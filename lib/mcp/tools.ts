import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { encodeReport } from "@/lib/core/codec";
import { optimize } from "@/lib/core/optimize";
import { SETTINGS } from "@/lib/core/settings";
import type { Hints } from "@/lib/core/snapshot";
import { findTerm, TERMS, termHref } from "@/lib/terms";
import { candidatesSql, snapshotSql } from "@/lib/core/queries";
import { buildSnapshot, verdict } from "@/lib/core/report";
import { allow, MAX_FRAGMENT_BYTES, MAX_REPORTS_PER_HOUR } from "@/lib/links/rate-limit";
import type { LinkStore } from "@/lib/links";

// robovac never connects to your database: the agent runs the SQL on its own
// connection and passes the rows back. create_report writes two things, both
// to Redis: the report behind the short link, and the per-IP report counter.
const DEFAULT_BASE_URL = "https://robovac.hannesmoser.at";

const SNAPSHOT_INSTRUCTIONS =
  "Run this read-only query on your own database connection twice (a role in pg_monitor is " +
  "enough), then call create_report with both result rows as first and second. The delay " +
  "between the two runs is what turns counters into rates. Leave 10-15 minutes: on a bursty " +
  "OLTP table a one-minute window measures the minute it ran in, and every proposed threshold " +
  "derives from it, so it can miss the real rate several times over. Better still, if you " +
  "already have hours of monitoring data, pass measured_rates to create_report and the " +
  "sampling window stops mattering. Connect to the primary: replicas keep their own " +
  "pg_stat_user_tables counters, which read as zero there.";

/** What to expect when the agent applies the proposed settings. */
function applyNotes(table: string): string[] {
  return [
    `ALTER TABLE ... SET takes a SHARE UPDATE EXCLUSIVE lock. It does not block queries, but it queues behind a running anti-wraparound vacuum, and a lock_timeout can kill it silently. Verify after the apply: SELECT reloptions FROM pg_class WHERE oid = '${table}'::regclass;`,
    "Expect one catch-up vacuum right after the apply. Near-free runs can then re-trigger every naptime while dead-but-not-removable rows drain; the catch-up run held the xmin horizon open, so this loop is a transient. A loop that persists for hours means the threshold sits under the standing floor (churn times snapshot-horizon age): raise the threshold.",
    "Reloptions do not survive a table rewrite (VACUUM FULL, pg_repack, pg_squeeze, pg-osc): re-apply after one.",
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

/**
 * The ip is the caller of this one request. Only create_report uses it: it is
 * the only tool that writes, so it is the only tool with a limit.
 */
export function registerTools(server: McpServer, store: LinkStore, ip: string): void {
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
    "Build the robovac report from two snapshot rows (the get_snapshot_sql query, run twice). Returns two links (a short url that expires in 30 days, and a permalink that never does), a verdict, the workload pattern, warnings, optimized settings, and one reason per changed setting. Optional workload hints sharpen the classification.",
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
      measured_rates: z
        .object({
          dead_per_day: z.number().nonnegative().optional(),
          ins_per_day: z.number().nonnegative().optional(),
          xid_per_day: z.number().positive().optional(),
        })
        .optional()
        .describe(
          "Rates you already measured over hours (monitoring, vacuum logs). These replace the two-sample delta, which is the weakest input in the whole report on a bursty table.",
        ),
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
      measured_rates,
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
        measuredRates: measured_rates && {
          deadPerDay: measured_rates.dead_per_day,
          insPerDay: measured_rates.ins_per_day,
          xidPerDay: measured_rates.xid_per_day,
        },
      };
      const hints = Object.values(provided).some((v) => v !== undefined) ? provided : undefined;
      const snap = buildSnapshot(first, second, hints);
      const proposal = optimize(snap);
      const base = base_url ?? DEFAULT_BASE_URL;
      const fragment = encodeReport({ snap });
      // A table name is free text, so a hostile row can inflate the payload.
      if (fragment.length > MAX_FRAGMENT_BYTES) {
        return json({ error: "snapshot too large to store", bytes: fragment.length });
      }
      // After the size check, which costs nothing, and before the write.
      if (!(await allow(ip))) {
        return json({
          error: "report limit reached",
          limit: `${MAX_REPORTS_PER_HOUR} reports per hour from one address`,
          retry_after: "the next clock hour",
          note:
            "Temporary, and only create_report is capped: get_snapshot_sql, get_candidates_sql " +
            "and explain_term still answer. Tell the user the cap resets at the top of the hour. " +
            "Do not retry in a loop.",
        });
      }
      const { id, expiresAt } = await store.put(fragment);
      const url = `${base}/r/${id}`;
      const permalink = `${base}/report#${fragment}`;
      const changed = SETTINGS.map((d) => d.key).filter(
        (key) => proposal.values[key] !== snap.current[key],
      );
      return json({
        url,
        permalink,
        expires_at: new Date(expiresAt).toISOString(),
        url_note:
          "Paste url in your reply: it is short and stops working after 30 days. permalink carries the whole report and never expires, so file that one if you store this anywhere. Relay either by copy, never by re-typing: one changed character makes the link unusable, and the report page rejects it as damaged.",
        verdict: verdict(snap),
        pattern: proposal.pattern,
        // The list a reviewer reads first. An empty one is a real answer:
        // the table is already tuned and nothing here needs an ALTER.
        changed,
        settled: changed.length === 0,
        warnings: proposal.warnings,
        diagnosis: proposal.diagnosis,
        current: snap.current,
        proposed: proposal.values,
        reasons: proposal.reasons,
        companions: proposal.companions,
        apply_notes: changed.length > 0 ? applyNotes(snap.table) : [],
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
      const entry = findTerm(slug);
      if (!entry) {
        throw new Error(
          `unknown term "${term}". Known terms: ${TERMS.map((t) => t.slug).join(", ")}`,
        );
      }
      return json({ url: `${base_url ?? DEFAULT_BASE_URL}${termHref(entry.slug)}` });
    },
  );
}
