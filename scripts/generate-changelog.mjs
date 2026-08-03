// Rebuilds app/changelog/entries.json from the conventional commit history.
// Output is committed: run it locally, review the diff, commit and push.
//
//   node scripts/generate-changelog.mjs   (or: pnpm changelog)
//
// The page shows feat/fix/perf plus every breaking change (the `!` marker
// or a BREAKING CHANGE footer). The rest of the history stays in git.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "app/changelog/entries.json");

const SHOWN_TYPES = new Set(["feat", "fix", "perf"]);
const SUBJECT = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;

const log = execFileSync(
  "git",
  ["log", "--no-merges", "--date=short", "--pretty=format:%h%x1f%ad%x1f%s%x1f%b%x1e"],
  { cwd: root, encoding: "utf8" },
);
const records = log
  .split("\x1e")
  .map((r) => r.replace(/^\n/, ""))
  .filter(Boolean);

const entries = [];
let nonConventional = 0;
for (const record of records) {
  const [hash, date, subject, body = ""] = record.split("\x1f");
  const m = subject.match(SUBJECT);
  if (!m) {
    nonConventional++;
    continue;
  }
  const [, type, scope, bang, description] = m;
  const breaking = bang === "!" || /^BREAKING CHANGE:/m.test(body);
  if (!SHOWN_TYPES.has(type) && !breaking) continue;
  entries.push({ hash, date, type, scope: scope ?? null, breaking, description });
}

writeFileSync(out, JSON.stringify(entries, null, 2) + "\n");
const filtered = records.length - nonConventional - entries.length;
console.log(
  `${entries.length} entries from ${records.length} commits ` +
    `(${filtered} filtered by type, ${nonConventional} non-conventional) -> ${out}`,
);
