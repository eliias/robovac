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

const SETTING_NAMES = [
  ...SETTINGS.map((d) => d.key),
  "vacuum_cost_limit",
  "vacuum_cost_delay",
  // Not tunable per table, read so a freeze_max_age above it can be caught:
  // the failsafe would fire first, which inverts the two mechanisms.
  "vacuum_failsafe_age",
];

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
  c.reltuples::bigint                                         AS reltuples,
  s.n_live_tup                                                AS n_live_tup,
  s.n_dead_tup                                                AS n_dead_tup,
  s.n_tup_ins                                                 AS n_tup_ins,
  s.n_tup_upd                                                 AS n_tup_upd,
  s.n_tup_del                                                 AS n_tup_del,
  s.n_tup_hot_upd                                             AS n_tup_hot_upd,
  s.last_autovacuum::text                                     AS last_autovacuum,
  s.last_vacuum::text                                         AS last_vacuum,
  s.n_mod_since_analyze                                       AS n_mod_since_analyze,
  age(c.relfrozenxid)                                         AS xid_age,
  mxid_age(c.relminmxid)                                      AS mxid_age,
  (SELECT count(*) FROM pg_index i WHERE i.indrelid = c.oid)  AS index_count,
  c.reloptions                                                AS reloptions,
  c.relispartition                                            AS is_partition,
  (c.reltoastrelid <> 0)                                      AS has_toast,
  current_setting('server_version_num')::int                  AS version_num,
  pg_is_in_recovery()                                         AS is_replica,
  -- A platform that already meters vacuum against live load makes the cost
  -- advice redundant. missing_ok = true returns NULL on vanilla Postgres,
  -- so this probes a capability without a vendor list.
  current_setting('enable_google_adaptive_autovacuum', true)   AS adaptive_vacuum,
  -- xmax is the next xid to be assigned. Its delta over the two runs is the
  -- xid consumption rate. (xmin is the oldest running transaction, so using
  -- it here would read the horizon's movement instead, and would report a
  -- rate near zero exactly when a long transaction pins it.)
  pg_snapshot_xmax(pg_current_snapshot())::text::numeric      AS xid_now,
  -- How far behind the oldest snapshot sits, in xids. This is what makes
  -- the dead-but-not-removable floor computable.
  (pg_snapshot_xmax(pg_current_snapshot())::text::numeric
   - pg_snapshot_xmin(pg_current_snapshot())::text::numeric)  AS horizon_xids,
  -- The ProcArray snapshot above misses replication slots, and a stuck slot
  -- is the classic cause of a horizon that never advances.
  (SELECT max(GREATEST(age(s.xmin), age(s.catalog_xmin)))
     FROM pg_replication_slots s)                             AS slot_horizon_xids,
  (SELECT jsonb_object_agg(name, setting) FROM pg_settings
    WHERE name IN (${SETTING_NAMES.map((n) => `'${n}'`).join(", ")})) AS global_settings,
  now()::text                                                 AS captured_at
FROM pg_stat_user_tables s
JOIN pg_class c ON c.oid = s.relid
WHERE s.schemaname = ${literal("schema", schema)} AND s.relname = ${literal("table", table)}
`;
}

/**
 * Ranking read the agent runs itself, same contract as snapshotSql.
 *
 * Reads pg_stat_all_tables, not pg_stat_user_tables, so TOAST relations are
 * visible: they carry their own reloptions and vacuum separately, and on a
 * table with large values they outrank their parent. The rank weights the
 * pressure by the pages a pass has to walk, because a small table with a
 * high dead ratio costs seconds while a large one costs hours.
 */
export function candidatesSql(limit: number): string {
  const n = Math.max(1, Math.min(50, Math.floor(limit)));
  return `
SELECT
  s.schemaname                                     AS schema_name,
  s.relname                                        AS table_name,
  p.relname                                        AS toast_parent,
  s.n_live_tup                                     AS n_live_tup,
  s.n_dead_tup                                     AS n_dead_tup,
  c.reltuples::bigint                              AS reltuples,
  c.relpages::bigint                               AS relpages,
  age(c.relfrozenxid)                              AS xid_age,
  pg_total_relation_size(c.oid)                    AS total_bytes
FROM pg_stat_all_tables s
JOIN pg_class c ON c.oid = s.relid
LEFT JOIN pg_class p ON p.reltoastrelid = c.oid
WHERE s.schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY (
    (s.n_dead_tup::float / GREATEST(c.reltuples, 1))
  + (age(c.relfrozenxid)::float / 2147483647)
  ) * GREATEST(c.relpages, 1) DESC
LIMIT ${n}
`;
}
