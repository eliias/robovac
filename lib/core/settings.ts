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
    unit: "× n_live_tup",
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
    unit: "× n_live_tup",
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
    unit: "× n_live_tup",
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

export type Values = Record<string, number>;

export function defaultValues(): Values {
  const v: Values = {};
  for (const d of SETTINGS) v[d.key] = d.def;
  return v;
}

export function settingsByGroup(group: Group): SettingDef[] {
  return SETTINGS.filter((d) => d.group === group);
}
