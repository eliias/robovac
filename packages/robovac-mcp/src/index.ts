#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import pg from "pg";
import { z } from "zod";
import { encodeReport } from "../../../lib/core/codec.js";
import { fmtCompact, fmtDur } from "../../../lib/core/format.js";
import { threshold } from "../../../lib/core/model.js";
import { optimize } from "../../../lib/core/optimize.js";
import { SETTINGS, defaultValues, type Values } from "../../../lib/core/settings.js";
import { SnapshotSchema, type Hints, type Snapshot } from "../../../lib/core/snapshot.js";
import { TERMS, termHref } from "../../../lib/terms.js";
import { CANDIDATES_QUERY, SETTINGS_QUERY, SNAPSHOT_QUERY } from "./queries.js";

const BASE_URL = process.env.ROBOVAC_BASE_URL ?? "http://localhost:3000";

async function withClient<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url)
    throw new Error(
      "DATABASE_URL is not set. Point it at the database you want to inspect, read-only.",
    );
  const client = new pg.Client({ connectionString: url, statement_timeout: 5000 });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface StatsRow {
  db: string;
  schema_name: string;
  table_name: string;
  relpages: string;
  n_live_tup: string;
  n_dead_tup: string;
  n_tup_ins: string;
  n_tup_upd: string;
  n_tup_del: string;
  n_tup_hot_upd: string;
  last_autovacuum: Date | null;
  n_mod_since_analyze: string;
  xid_age: string;
  mxid_age: string;
  index_count: string;
  reloptions: string[] | null;
  is_partition: boolean;
  has_toast: boolean;
  version_num: number;
  xid_now: string;
  captured_at: Date;
}

function effectiveSettings(globals: Map<string, string>, reloptions: string[] | null): Values {
  const values = defaultValues();
  for (const d of SETTINGS) {
    const g = globals.get(d.key);
    if (g !== undefined) values[d.key] = Number(g);
  }
  for (const opt of reloptions ?? []) {
    const eq = opt.indexOf("=");
    if (eq < 0) continue;
    const key = opt.slice(0, eq);
    if (SETTINGS.some((d) => d.key === key)) values[key] = Number(opt.slice(eq + 1));
  }
  // Per-table cost delay/limit of -1 mean "use the global value".
  if (values.autovacuum_vacuum_cost_delay < 0)
    values.autovacuum_vacuum_cost_delay = Number(globals.get("autovacuum_vacuum_cost_delay") ?? 2);
  if (values.autovacuum_vacuum_cost_limit < 0)
    values.autovacuum_vacuum_cost_limit = Number(globals.get("vacuum_cost_limit") ?? 200);
  return values;
}

function deadDelta(row: StatsRow): number {
  return Number(row.n_tup_upd) - Number(row.n_tup_hot_upd) + Number(row.n_tup_del);
}

async function buildSnapshot(
  schema: string,
  table: string,
  sampleSeconds: number,
  hints?: Hints,
): Promise<Snapshot> {
  return withClient(async (client) => {
    const first = await client.query<StatsRow>(SNAPSHOT_QUERY, [schema, table]);
    if (!first.rows.length)
      throw new Error(`table ${schema}.${table} not found in pg_stat_user_tables`);
    await sleep(Math.max(1, sampleSeconds) * 1000);
    const second = await client.query<StatsRow>(SNAPSHOT_QUERY, [schema, table]);
    const globals = await client.query<{ name: string; setting: string }>(SETTINGS_QUERY, [
      [...SETTINGS.map((d) => d.key), "vacuum_cost_limit", "vacuum_cost_delay"],
    ]);

    const a = first.rows[0];
    const b = second.rows[0];
    const dtSeconds = Math.max(1, (b.captured_at.getTime() - a.captured_at.getTime()) / 1000);
    const dtDays = dtSeconds / 86400;
    const deadDeltaRows = deadDelta(b) - deadDelta(a);
    const insDeltaRows = Number(b.n_tup_ins) - Number(a.n_tup_ins);
    const modDeltaRows =
      deadDeltaRows + insDeltaRows + (Number(b.n_tup_hot_upd) - Number(a.n_tup_hot_upd));
    const deadPerDay = Math.max(0, Math.round(deadDeltaRows / dtDays));
    const insPerDay = Math.max(0, Math.round(insDeltaRows / dtDays));
    const xidPerDay = Math.max(1000, Math.round((Number(b.xid_now) - Number(a.xid_now)) / dtDays));
    const updDelta = Number(b.n_tup_upd) - Number(a.n_tup_upd);
    const hotDelta = Number(b.n_tup_hot_upd) - Number(a.n_tup_hot_upd);
    const rateConfidence: "high" | "low" =
      dtSeconds >= 30 && deadDeltaRows + insDeltaRows >= 50 ? "high" : "low";

    const globalMap = new Map(globals.rows.map((r) => [r.name, r.setting]));
    const current = effectiveSettings(globalMap, b.reloptions);

    const stats = {
      v: 1 as const,
      db: b.db,
      table: `${b.schema_name}.${b.table_name}`,
      capturedAt: b.captured_at.toISOString(),
      live: Number(b.n_live_tup),
      dead: Number(b.n_dead_tup),
      pages: Math.max(1, Number(b.relpages)),
      deadPerDay,
      xidAge: Number(b.xid_age),
      xidPerDay,
      lastAutovacuum: b.last_autovacuum ? b.last_autovacuum.toISOString() : null,
      indexes: Number(b.index_count),
      current,
      insPerDay,
      modPerDay: Math.max(0, Math.round(modDeltaRows / dtDays)),
      hotFraction: updDelta > 0 ? Math.min(1, Math.max(0, hotDelta / updDelta)) : undefined,
      multixactAge: Number(b.mxid_age),
      versionNum: b.version_num,
      isPartition: b.is_partition,
      hasToast: b.has_toast,
      rateConfidence,
      hints,
    };
    const proposal = optimize(stats);
    return SnapshotSchema.parse({ ...stats, proposed: proposal.values });
  });
}

function verdict(snap: Snapshot): string {
  const thr = threshold(snap.current, snap.live);
  const period = snap.deadPerDay > 0 ? fmtDur(thr / snap.deadPerDay) : "∞";
  const aggressive = snap.xidAge > snap.current.autovacuum_freeze_max_age;
  return (
    `Autovacuum fires every ${period} at the observed write rate. ` +
    `The table reaches ${fmtCompact(thr)} dead tuples before each run` +
    (aggressive
      ? ", and relfrozenxid age is past autovacuum_freeze_max_age, so every run is aggressive."
      : ".")
  );
}

const server = new McpServer({ name: "robovac", version: "0.1.0" });

server.tool(
  "snapshot_table",
  "Snapshot one table's vacuum statistics and return a robovac report URL plus optimized settings. Reads statistics views only, never table data. Samples twice to measure write and xid rates. Optional workload hints sharpen the pattern classification.",
  {
    schema: z.string().describe("Schema name, e.g. public"),
    table: z.string().describe("Table name"),
    sample_seconds: z
      .number()
      .min(1)
      .max(120)
      .default(30)
      .describe("Delay between the two statistics reads; 30s+ gives high-confidence rates"),
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
    max_workers: z.number().int().positive().optional().describe("Current autovacuum_max_workers"),
    long_transactions: z
      .boolean()
      .optional()
      .describe("The workload holds multi-minute transactions"),
    fk_heavy: z
      .boolean()
      .optional()
      .describe("FK checks or SELECT FOR UPDATE dominate (multixact pressure)"),
  },
  async ({
    schema,
    table,
    sample_seconds,
    pattern,
    replication_lag_budget,
    storage,
    ram_bytes,
    max_workers,
    long_transactions,
    fk_heavy,
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
    const snap = await buildSnapshot(schema, table, sample_seconds, hints);
    const proposal = optimize(snap);
    const url = `${BASE_URL}/report#${encodeReport({ snap })}`;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              url,
              verdict: verdict(snap),
              pattern: proposal.pattern,
              warnings: proposal.warnings,
              diagnosis: proposal.diagnosis,
              proposed: proposal.values,
              reasons: proposal.reasons,
              companions: proposal.companions,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

server.tool(
  "list_candidates",
  "Rank tables by vacuum pressure (dead-tuple ratio plus xid age), so the agent knows which table to snapshot.",
  {
    limit: z.number().int().min(1).max(50).default(10),
  },
  async ({ limit }) => {
    const rows = await withClient(
      async (client) => (await client.query(CANDIDATES_QUERY, [limit])).rows,
    );
    return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
  },
);

server.tool(
  "explain_term",
  "Return the stable robovac explain URL for a vacuum term.",
  {
    term: z.string().describe("A term slug, e.g. xmin or autovacuum_freeze_max_age"),
  },
  async ({ term }) => {
    const slug = term.trim().toLowerCase().replaceAll(" ", "-");
    const entry = TERMS.find((t) => t.slug === slug);
    if (!entry) {
      throw new Error(
        `unknown term "${term}". Known terms: ${TERMS.map((t) => t.slug).join(", ")}`,
      );
    }
    return { content: [{ type: "text", text: `${BASE_URL}${termHref(entry.slug)}` }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
