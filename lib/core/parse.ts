/**
 * Parses pasted output of the snapshot query into rows, in the browser.
 * Accepts, without asking which is which: psql aligned output, psql expanded
 * (\x) output, CSV (\copy … csv header), and JSON (row_to_json / jsonb_agg).
 * Two result blocks (the query run twice) become the two samples that turn
 * counters into rates; a single block is a single sample.
 */

export type PastedRow = Record<string, unknown>;

export class ParseError extends Error {}

function csvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

function fromJson(text: string): PastedRow[] {
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed as PastedRow[];
  if (typeof parsed === "object" && parsed !== null) return [parsed as PastedRow];
  throw new ParseError("JSON input must be an object or an array of objects");
}

function fromExpanded(text: string): PastedRow[] {
  const rows: PastedRow[] = [];
  let current: PastedRow | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (/^-\[ RECORD \d+ \]/.test(line.trim())) {
      if (current && Object.keys(current).length) rows.push(current);
      current = {};
      continue;
    }
    const pipe = line.indexOf("|");
    if (pipe < 0) continue;
    const key = line.slice(0, pipe).trim();
    const value = line.slice(pipe + 1).trim();
    if (!key) continue;
    current ??= {};
    current[key] = value;
  }
  if (current && Object.keys(current).length) rows.push(current);
  return rows;
}

function fromAligned(text: string): PastedRow[] {
  const lines = text.split("\n");
  const rows: PastedRow[] = [];
  let header: string[] | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^[\s-]*-{3,}\+/.test(line) || /^\s*-{4,}\s*$/.test(line)) {
      // The ---+--- rule: the line above is this block's header.
      const h = lines[i - 1];
      if (h && h.includes("|")) header = h.split("|").map((c) => c.trim());
      continue;
    }
    if (!header) continue;
    if (!line.includes("|")) {
      if (/^\(\d+ rows?\)/.test(line.trim()) || line.trim() === "") header = null;
      continue;
    }
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length !== header.length) continue;
    const row: PastedRow = {};
    header.forEach((name, idx) => {
      row[name] = cells[idx];
    });
    rows.push(row);
  }
  return rows;
}

function fromCsv(text: string): PastedRow[] {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  const header = csvLine(lines[0]).map((c) => c.trim());
  return lines.slice(1).map((line) => {
    const cells = csvLine(line);
    const row: PastedRow = {};
    header.forEach((name, idx) => {
      row[name] = (cells[idx] ?? "").trim();
    });
    return row;
  });
}

/** The snapshot-query columns a report cannot be built without, in query order. */
const REQUIRED_COLUMNS = [
  "relpages",
  "n_live_tup",
  "n_dead_tup",
  "n_tup_ins",
  "n_tup_upd",
  "n_tup_del",
  "n_tup_hot_upd",
  "xid_age",
  "mxid_age",
  "index_count",
  "reloptions",
  "version_num",
  "xid_now",
  "global_settings",
  "captured_at",
] as const;

export interface PastedTable {
  name: string;
  rows: PastedRow[];
  /** n_dead_tup / n_live_tup of the first row: the choice is ranked by it. */
  deadRatio: number;
}

export type PasteError =
  | { kind: "unparseable" }
  | { kind: "query" }
  | { kind: "missing-columns"; columns: string[] }
  | { kind: "multiple-tables"; tables: PastedTable[] };

export type PasteResult =
  | { ok: true; first: PastedRow; second?: PastedRow }
  | { ok: false; error: PasteError };

function cellNum(row: PastedRow, col: string): number {
  return Number(row[col]) || 0;
}

function tableName(row: PastedRow): string {
  const v = row.relname ?? row.table_name;
  return typeof v === "string" ? v : "";
}

/**
 * The paste-box front door: turns raw text into two samples of one table,
 * or one of the four inline states (P1-P4). Formats stay in
 * parseSnapshotPaste; this layer only classifies.
 */
export function classifyPaste(text: string): PasteResult {
  const trimmed = text.trim();
  if (/^select\b/i.test(trimmed) && trimmed.includes("pg_stat_user_tables")) {
    return { ok: false, error: { kind: "query" } };
  }

  let rows: PastedRow[];
  try {
    const parsed = parseSnapshotPaste(text);
    rows = parsed.second ? [parsed.first, parsed.second] : [parsed.first];
  } catch {
    return { ok: false, error: { kind: "unparseable" } };
  }

  const names = [...new Set(rows.map(tableName).filter(Boolean))];
  if (names.length > 1) {
    const tables: PastedTable[] = names
      .map((name) => {
        const own = rows.filter((r) => tableName(r) === name);
        return {
          name,
          rows: own,
          deadRatio: cellNum(own[0], "n_dead_tup") / Math.max(1, cellNum(own[0], "n_live_tup")),
        };
      })
      .toSorted((a, b) => b.deadRatio - a.deadRatio);
    return { ok: false, error: { kind: "multiple-tables", tables } };
  }

  const missing = REQUIRED_COLUMNS.filter((c) => !(c in rows[0]));
  if (missing.length > 0) {
    return { ok: false, error: { kind: "missing-columns", columns: missing } };
  }

  return { ok: true, first: rows[0], second: rows[1] };
}

export function parseSnapshotPaste(text: string): { first: PastedRow; second?: PastedRow } {
  const trimmed = text.trim();
  if (!trimmed) throw new ParseError("nothing pasted");

  let rows: PastedRow[];
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    rows = fromJson(trimmed);
  } else if (/-\[ RECORD \d+ \]/.test(trimmed)) {
    rows = fromExpanded(trimmed);
  } else if (/-{3,}\+/.test(trimmed)) {
    rows = fromAligned(trimmed);
  } else if (trimmed.split("\n")[0].includes(",")) {
    rows = fromCsv(trimmed);
  } else {
    throw new ParseError(
      "unrecognised format: paste psql output (aligned or \\x), CSV, or JSON, headers included",
    );
  }

  rows = rows.filter((r) => Object.keys(r).length > 1);
  if (!rows.length) {
    throw new ParseError("no data rows found: paste the full result, headers included");
  }
  return { first: rows[0], second: rows[1] };
}
