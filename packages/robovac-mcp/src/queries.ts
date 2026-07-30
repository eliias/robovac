export const SNAPSHOT_QUERY = `
SELECT
  current_database()                                          AS db,
  s.schemaname                                                AS schema_name,
  s.relname                                                   AS table_name,
  c.relpages::bigint                                          AS relpages,
  s.n_live_tup                                                AS n_live_tup,
  s.n_dead_tup                                                AS n_dead_tup,
  s.n_tup_ins                                                 AS n_tup_ins,
  s.n_tup_upd                                                 AS n_tup_upd,
  s.n_tup_del                                                 AS n_tup_del,
  s.n_tup_hot_upd                                             AS n_tup_hot_upd,
  s.last_autovacuum                                           AS last_autovacuum,
  s.n_mod_since_analyze                                       AS n_mod_since_analyze,
  age(c.relfrozenxid)                                         AS xid_age,
  mxid_age(c.relminmxid)                                      AS mxid_age,
  (SELECT count(*) FROM pg_index i WHERE i.indrelid = c.oid)  AS index_count,
  c.reloptions                                                AS reloptions,
  c.relispartition                                            AS is_partition,
  (c.reltoastrelid <> 0)                                      AS has_toast,
  current_setting('server_version_num')::int                  AS version_num,
  pg_snapshot_xmin(pg_current_snapshot())::text::numeric      AS xid_now,
  now()                                                       AS captured_at
FROM pg_stat_user_tables s
JOIN pg_class c ON c.oid = s.relid
WHERE s.schemaname = $1 AND s.relname = $2
`;

export const SETTINGS_QUERY = `
SELECT name, setting
FROM pg_settings
WHERE name = ANY($1)
`;

export const CANDIDATES_QUERY = `
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
LIMIT $1
`;
