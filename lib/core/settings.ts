export type Group = "trigger" | "cost" | "freeze";

export interface SettingDef {
  key: string;
  group: Group;
  min: number;
  max: number;
  step?: number;
  log?: boolean;
  /** 0 is a valid value even when it lies below the slider range (the scale_factor = 0 recipe). */
  zeroOk?: boolean;
  def: number;
  unit: string;
  fmt: "frac" | "int";
  note: string;
}

export const SETTINGS: SettingDef[] = [
  {
    key: "autovacuum_vacuum_scale_factor",
    group: "trigger",
    min: 0.0005,
    max: 0.4,
    log: true,
    zeroOk: true,
    def: 0.2,
    unit: "× reltuples",
    fmt: "frac",
    note: "",
  },
  {
    key: "autovacuum_vacuum_threshold",
    group: "trigger",
    min: 50,
    max: 5000000,
    log: true,
    zeroOk: true,
    def: 50,
    unit: "rows",
    fmt: "int",
    note: "floor for small tables",
  },
  {
    key: "autovacuum_vacuum_insert_scale_factor",
    group: "trigger",
    min: 0.0005,
    max: 0.4,
    log: true,
    zeroOk: true,
    def: 0.2,
    unit: "× reltuples",
    fmt: "frac",
    note: "pg 13+",
  },
  {
    key: "autovacuum_vacuum_insert_threshold",
    group: "trigger",
    min: 100,
    max: 5000000,
    log: true,
    def: 1000,
    unit: "rows",
    fmt: "int",
    note: "pg 13+",
  },
  {
    key: "autovacuum_analyze_scale_factor",
    group: "trigger",
    min: 0.0005,
    max: 0.5,
    log: true,
    zeroOk: true,
    def: 0.1,
    unit: "× reltuples",
    fmt: "frac",
    note: "planner stats drift",
  },
  {
    key: "autovacuum_analyze_threshold",
    group: "trigger",
    min: 50,
    max: 5000000,
    log: true,
    zeroOk: true,
    def: 50,
    unit: "rows",
    fmt: "int",
    note: "",
  },
  {
    key: "autovacuum_vacuum_cost_delay",
    group: "cost",
    min: 0,
    max: 100,
    step: 1,
    def: 2,
    unit: "ms",
    fmt: "int",
    note: "pre-12 default, never reset",
  },
  {
    key: "autovacuum_vacuum_cost_limit",
    group: "cost",
    min: 10,
    max: 10000,
    log: true,
    def: 200,
    unit: "cost units",
    fmt: "int",
    note: "shared by all workers",
  },
  {
    key: "vacuum_cost_page_hit",
    group: "cost",
    min: 0,
    max: 20,
    step: 1,
    def: 1,
    unit: "units/page",
    fmt: "int",
    note: "page in shared_buffers",
  },
  {
    key: "vacuum_cost_page_miss",
    group: "cost",
    min: 0,
    max: 40,
    step: 1,
    def: 2,
    unit: "units/page",
    fmt: "int",
    note: "nvme, not spinning rust",
  },
  {
    key: "vacuum_cost_page_dirty",
    group: "cost",
    min: 0,
    max: 80,
    step: 1,
    def: 20,
    unit: "units/page",
    fmt: "int",
    note: "",
  },
  {
    key: "vacuum_freeze_min_age",
    group: "freeze",
    min: 0,
    max: 1000000000,
    log: true,
    def: 50000000,
    unit: "xids",
    fmt: "int",
    note: "freeze earlier, cheaper pages",
  },
  {
    key: "vacuum_freeze_table_age",
    group: "freeze",
    min: 1000000,
    max: 2000000000,
    log: true,
    def: 150000000,
    unit: "xids",
    fmt: "int",
    note: "",
  },
  {
    key: "autovacuum_freeze_max_age",
    group: "freeze",
    min: 100000000,
    max: 2000000000,
    log: true,
    def: 200000000,
    unit: "xids",
    fmt: "int",
    note: "",
  },
  {
    key: "autovacuum_multixact_freeze_max_age",
    group: "freeze",
    min: 100000000,
    max: 2000000000,
    log: true,
    def: 400000000,
    unit: "xids",
    fmt: "int",
    note: "no multixact pressure",
  },
];

// The range Postgres itself accepts for each setting (the union of the GUC
// range and the per-table reloption range). The min/max in SETTINGS is the
// narrower range the tuner explores; a database in the wild can hold any
// value in this one.
export const PG_RANGE: Record<string, readonly [number, number]> = {
  autovacuum_vacuum_scale_factor: [0, 100],
  autovacuum_vacuum_threshold: [0, 2147483647],
  autovacuum_vacuum_insert_scale_factor: [0, 100],
  autovacuum_vacuum_insert_threshold: [-1, 2147483647],
  autovacuum_analyze_scale_factor: [0, 100],
  autovacuum_analyze_threshold: [0, 2147483647],
  autovacuum_vacuum_cost_delay: [-1, 100],
  autovacuum_vacuum_cost_limit: [-1, 10000],
  vacuum_cost_page_hit: [0, 10000],
  vacuum_cost_page_miss: [0, 10000],
  vacuum_cost_page_dirty: [0, 10000],
  vacuum_freeze_min_age: [0, 1000000000],
  vacuum_freeze_table_age: [0, 2000000000],
  autovacuum_freeze_max_age: [100000, 2000000000],
  autovacuum_multixact_freeze_max_age: [10000, 2000000000],
};

export type Values = Record<string, number>;

export function defaultValues(): Values {
  const v: Values = {};
  for (const d of SETTINGS) v[d.key] = d.def;
  return v;
}

export function settingsByGroup(group: Group): SettingDef[] {
  return SETTINGS.filter((d) => d.group === group);
}
