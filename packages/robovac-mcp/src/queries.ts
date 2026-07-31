import { SETTINGS } from "../../../lib/core/settings";

const IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_$]*$/;

function literal(name: string, value: string): string {
  if (!IDENTIFIER.test(value)) {
    throw new Error(
      `invalid ${name} "${value}": expected a plain identifier (quoted identifiers are not supported)`,
    );
  }
  return `'${value}'`;
}

const SETTING_NAMES = [...SETTINGS.map((d) => d.key), "vacuum_cost_limit", "vacuum_cost_delay"];

/**
 * The statistics read the agent runs on its own connection. robovac never
 * connects to a database: the agent executes this twice, 30-60 s apart, and
 * passes both result rows to `create_report`.
 */
export function snapshotSql(schema: string, table: string): string {
  return `
SELECT
  current_database()                                          AS db,
  s.schemaname                                                AS schema_name,
  s.relname                                                   AS table_name,
  c.relpages::bigint                                          AS relpages,
  c.relallvisible::bigint                                     AS relallvisible,
  s.n_live_tup                                                AS n_live_tup,
  s.n_dead_tup                                                AS n_dead_tup,
  s.n_tup_ins                                                 AS n_tup_ins,
  s.n_tup_upd                                                 AS n_tup_upd,
  s.n_tup_del                                                 AS n_tup_del,
  s.n_tup_hot_upd                                             AS n_tup_hot_upd,
  s.last_autovacuum::text                                     AS last_autovacuum,
  s.n_mod_since_analyze                                       AS n_mod_since_analyze,
  age(c.relfrozenxid)                                         AS xid_age,
  mxid_age(c.relminmxid)                                      AS mxid_age,
  (SELECT count(*) FROM pg_index i WHERE i.indrelid = c.oid)  AS index_count,
  c.reloptions                                                AS reloptions,
  c.relispartition                                            AS is_partition,
  (c.reltoastrelid <> 0)                                      AS has_toast,
  current_setting('server_version_num')::int                  AS version_num,
  pg_snapshot_xmin(pg_current_snapshot())::text::numeric      AS xid_now,
  (SELECT jsonb_object_agg(name, setting) FROM pg_settings
    WHERE name IN (${SETTING_NAMES.map((n) => `'${n}'`).join(", ")})) AS global_settings,
  now()::text                                                 AS captured_at
FROM pg_stat_user_tables s
JOIN pg_class c ON c.oid = s.relid
WHERE s.schemaname = ${literal("schema", schema)} AND s.relname = ${literal("table", table)}
`;
}

/** Ranking read the agent runs itself, same contract as snapshotSql. */
export function candidatesSql(limit: number): string {
  const n = Math.max(1, Math.min(50, Math.floor(limit)));
  return `
SELECT
  s.schemaname                                     AS schema_name,
  s.relname                                        AS table_name,
  s.n_live_tup                                     AS n_live_tup,
  s.n_dead_tup                                     AS n_dead_tup,
  age(c.relfrozenxid)                              AS xid_age,
  pg_total_relation_size(c.oid)                    AS total_bytes
FROM pg_stat_user_tables s
JOIN pg_class c ON c.oid = s.relid
ORDER BY (s.n_dead_tup::float / GREATEST(s.n_live_tup, 1))
       + (age(c.relfrozenxid)::float / 2147483647) DESC
LIMIT ${n}
`;
}
