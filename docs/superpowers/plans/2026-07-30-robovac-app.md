# robovac app implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the robovac web app (report, explain, arcana, mcp pages) and the `robovac-mcp` stdio package from the design handoff.

**Architecture:** One Next.js App Router app at the repo root. All math lives in `lib/core` as pure functions, the report page and the MCP package are thin consumers. The design handoff at `/Users/hannes/Downloads/design_handoff_robovac/` (README.md + Robovac.dc.html) is the pixel-level source of truth, this plan carries the interfaces and formulas.

**Tech Stack:** Next.js 15 (App Router, TypeScript), React 19, vitest, zod, fflate, @modelcontextprotocol/sdk + pg (MCP package only). No chart library, no CSS framework: inline styles + a small globals.css, matching the prototype.

## Global Constraints

- Colors, sizes, spacing: exact values from the handoff README "Design tokens". Warn color `oklch(0.70 0.10 62)` appears only in the listed places.
- Fonts: IBM Plex Sans (prose) + IBM Plex Mono (everything else) via `next/font/google`, weights 400/500/600. `font-variant-numeric: tabular-nums` on the page root.
- No transitions or animation anywhere. Panels square, radius 3px/4px only on controls/buttons, 1px borders only.
- One breakpoint: 1120px (bands collapse to one column, chart column loses sticky, meta grid 3 → 2 columns).
- The report renders the demo snapshot when the URL has no fragment. A bad fragment renders the error state.
- Formulas ported exactly as in "Formulas" below. Where the prototype's static prose contradicts its own formulas (the 5.4 MB/s / 44 min copy in Band B), the formula wins and the prose is generated.
- Commit style: Conventional Commits. Work happens on branch `feat/app`.

## Formulas (canonical, from the handoff)

- `WRAP = 2147483647`
- Trigger threshold `T = autovacuum_vacuum_threshold + autovacuum_vacuum_scale_factor * live`. Period days = `T / deadPerDay`.
- Run cost: `cost = pages * (0.55*page_hit + 0.25*page_miss + 0.20*page_dirty)`, `seconds = delay > 0 ? (cost/limit)*(delay/1000) : pages*0.000004`, floored at 1. `mbps = pages*8192/1048576/seconds`.
- Sawtooth: from `(0,H)`, step by period, rise to `H - min(1, deadPerDay*dt/yMax)*H`, drop to `H`, max 500 segments. `yMax = max(thresholdCurrent, thresholdLive)`.
- Freeze: `daysToAggressive = (freeze_max_age - xidAge)/xidPerDay`, `shutdownMarginDays = (WRAP - xidAge)/xidPerDay`.
- Slider mapping: linear `(v-min)/(max-min)` w/ step rounding, log `(ln v - ln min)/(ln max - ln min)` snapping back: frac → 2 significant digits, >1e6 → nearest million, >1e3 → nearest hundred, else integer. Clamp to [min, max].
- Formatting: `fmtInt` en-US thousands, `fmtVal` frac → `toFixed(3)` if >= 0.01 else `toFixed(4)`, `fmtCompact` (`x.xx B` / `x.xx M` / `x.x k`), `fmtDur` (d >= 1 → `x.x d`, h >= 1 → `x.x h`, else `x min`), `fmtSecs` (>= 3600 → `x.x h`, >= 60 → `x min`, else `x s`). SQL numbers: no thousands separators, fractions w/o trailing zeros.

---

### Task 1: Scaffold

**Files:**

- Create: `package.json` (workspaces `["packages/*"]`), `tsconfig.json`, `next.config.ts`, `next-env.d.ts`, `vitest.config.ts`, `.gitignore`
- Create: `app/layout.tsx`, `app/globals.css`, `components/Header.tsx`, `app/page.tsx` (redirect to `/report`)

**Interfaces:**

- Produces: `Header` (sticky nav per handoff "Global header"), font CSS vars `--font-sans`, `--font-mono` from `next/font/google` (IBM_Plex_Sans, IBM_Plex_Mono).

- [ ] **Step 1:** `git checkout -b feat/app`. Write the config files: next 15, react 19, typescript, vitest, zod, fflate as deps. Scripts: `dev`, `build`, `test` (vitest run).
- [ ] **Step 2:** `app/globals.css`: body reset, background `#08080a`, `::selection` `#2a2a2f`, `a` inherit/hover white, `pre` margin 0.
- [ ] **Step 3:** `app/layout.tsx` loads both fonts, sets the page root div style (bg, color `#d6d6d9`, sans, 14px, line-height 1.55, min-height 100vh, tabular-nums) and renders `<Header/>` + children. `Header`: per handoff §Global header (wordmark, `snapshot · read-only` chip, nav links as real `<Link>`s to `/report` `/mcp` `/arcana`).
- [ ] **Step 4:** `npm install && npm run dev`, open `/`, expect redirect to `/report` (404 for now is fine) and the header to render.
- [ ] **Step 5:** Commit `feat: scaffold next app with global header`.

### Task 2: Core settings, snapshot, formatters

**Files:**

- Create: `lib/core/settings.ts`, `lib/core/snapshot.ts`, `lib/core/format.ts`
- Test: `lib/core/format.test.ts`, `lib/core/snapshot.test.ts`

**Interfaces (produced):**

```ts
// settings.ts
export type Group = 'trigger' | 'cost' | 'freeze'
export interface SettingDef { key: string; group: Group; min: number; max: number; step?: number; log?: boolean; def: number; unit: string; fmt: 'frac' | 'int'; note: string }
export const SETTINGS: SettingDef[]           // the 13 rows from handoff §Settings inventory, in order; static notes from the prototype defs
export type Values = Record<string, number>
// snapshot.ts
export interface Snapshot { v: 1; db: string; table: string; capturedAt: string; live: number; dead: number; pages: number; deadPerDay: number; xidAge: number; xidPerDay: number; lastAutovacuum: string | null; indexes: number | null; current: Values; proposed: Values }
export const SnapshotSchema: z.ZodType<Snapshot>   // strict, positive counts, current/proposed must contain every SETTINGS key within [min,max]
export const DEMO_SNAPSHOT: Snapshot          // handoff constants: live 412338901, dead 3148772, pages 1740000, deadPerDay 3637440, xidAge 211480336, xidPerDay 14200000, db 'prod-eu-1', table 'events.event_log', capturedAt '2026-07-30T09:14:00Z', indexes 7, current/proposed from the inventory table
// format.ts
export const fmtInt, fmtVal(def, v), fmtCompact, fmtDur(days), fmtSecs(s)
export const toPos(def, v): number            // 0..1
export const fromPos(def, p): number          // snapped, clamped
```

- [ ] **Step 1:** Write failing tests: `fmtCompact(82467830) === '82.47 M'`, `fmtDur(22.7) === '22.7 d'`, `fmtDur(0.57) === '13.7 h'`, `fmtSecs(1226.7) === '20 min'`, `fmtVal(frac, 0.005) === '0.0050'`, `fromPos` snapping (log setting at p=0.5 lands on a round value; frac gives 2 significant digits), `toPos/fromPos` round-trip within one snap step, `SnapshotSchema` accepts `DEMO_SNAPSHOT` and rejects `{...DEMO_SNAPSHOT, live: -1}` and a `current` missing one key.
- [ ] **Step 2:** Run `npm test`, expect failures (modules missing).
- [ ] **Step 3:** Implement the three modules by porting the prototype functions verbatim (prototype lines 603-648).
- [ ] **Step 4:** `npm test` green.
- [ ] **Step 5:** Commit `feat(core): settings inventory, snapshot schema, formatters`.

### Task 3: Core model (threshold, cost, sawtooth, freeze)

**Files:**

- Create: `lib/core/model.ts`
- Test: `lib/core/model.test.ts`

**Interfaces (produced):**

```ts
export const WRAP = 2147483647;
export function threshold(values: Values, live: number): number;
export function runCost(
  values: Values,
  pages: number,
): { seconds: number; mbps: number; costUnits: number };
export function sawPath(
  thresholdRows: number,
  deadPerDay: number,
  days: number,
  w: number,
  h: number,
  yMax: number,
): string;
export function daysToAggressive(freezeMaxAge: number, xidAge: number, xidPerDay: number): number;
export function shutdownMarginDays(xidAge: number, xidPerDay: number): number;
```

- [ ] **Step 1:** Failing tests against the demo snapshot: `threshold(current) === 82467830` (50 + 0.2*412338901 = 82467830.2 → keep raw float, assert `toBeCloseTo`), period `22.67 d`; `runCost(current)` (delay 20, limit 200, hit 1, miss 10, dirty 20) → costUnits 12,267,000, seconds ≈ 1226.7, mbps ≈ 11.08; `runCost` with delay 0 → `pages*4e-6` seconds; seconds floor of 1; `sawPath` starts with `M 0 172`, contains no negative y, caps at 500 segments for a tiny threshold; `daysToAggressive(200e6, 211480336, 14.2e6) < 0`; `shutdownMarginDays` ≈ 136.3.
- [ ] **Step 2:** Run tests, expect fail.
- [ ] **Step 3:** Implement (prototype lines 663-688).
- [ ] **Step 4:** Tests green.
- [ ] **Step 5:** Commit `feat(core): trigger, cost, sawtooth, freeze model`.

### Task 4: Codec

**Files:**

- Create: `lib/core/codec.ts`
- Test: `lib/core/codec.test.ts`

**Interfaces (produced):**

```ts
export interface ReportPayload {
  snap: Snapshot;
  tuned?: Partial<Values>;
} // tuned = only keys differing from snap.current
export function encodeReport(p: ReportPayload): string; // '1.' + base64url(deflateRaw(JSON)), fflate
export function decodeReport(fragment: string): ReportPayload; // strips leading '#', validates version + zod; throws CodecError
export class CodecError extends Error {
  issues: string[];
}
```

- [ ] **Step 1:** Failing tests: round-trip `decodeReport(encodeReport({snap: DEMO_SNAPSHOT}))` deep-equals input; encoded demo length < 1500 chars; tuned round-trips; `decodeReport('1.garbage')` and `decodeReport('9.abc')` throw `CodecError` with non-empty `issues`; 200-iteration loop with randomly perturbed valid snapshots round-trips.
- [ ] **Step 2:** Run, fail. **Step 3:** Implement with `fflate` `deflateSync/inflateSync` + manual base64url (Buffer in node, `atob/btoa`-free: use `Uint8Array` + `btoa` fallback via `globalThis.Buffer ??` — implement `b64urlEncode/Decode(bytes)` helpers that work in both runtimes). **Step 4:** Green. **Step 5:** Commit `feat(core): url fragment codec`.

### Task 5: Report page

**Files:**

- Create: `app/report/page.tsx` (server shell + metadata), `components/report/ReportView.tsx` (client), `components/report/Slider.tsx`, `components/report/Figures.tsx` (Fig1+Fig2+Fig3+Output), `components/TermLink.tsx`, `components/ui.ts` (shared style consts: colors, mono/sans helpers, panel frame, button styles)
- Create: `components/report/ErrorState.tsx`

**Interfaces:**

- Consumes: everything from Tasks 2-4.
- Produces: `<TermLink slug>` (dotted-underline mono link to `/explain/<slug>`, used again in Task 6), `panel`/`panelHeader` style consts in `components/ui.ts`.

- [ ] **Step 1:** `ReportView` state: `{ payload, values, open: {t,c,f}, copied, narrow, badFragment }`. On mount read `location.hash`: empty → `DEMO_SNAPSHOT`, decode failure → `ErrorState` listing `CodecError.issues` and linking `/mcp`. `values` init = `snap.current` merged w/ `tuned`. Every `values` change writes the hash back via `history.replaceState` (`encodeReport({snap, tuned: diff})`, omit `tuned` when empty). `narrow` from a resize listener at 1120px.
- [ ] **Step 2:** Port Band A (eyebrow, title, verdict, 3×3 stat grid), Band B (generated prose + auto-optimize/reset buttons), Band C (three collapsible groups of `Slider`, legend row, collapse/expand links) pixel-per-handoff (prototype lines 38-207). Verdict template: `Autovacuum fires every {fmtDur(periodCur)} at the observed write rate. The table reaches {fmtCompact(thrCur)} dead tuples before each run` + (xidAge > current freeze_max_age ? `, and relfrozenxid age is past autovacuum_freeze_max_age, so every run is aggressive.` : `.`). Prose paragraph: same sentence skeleton as the prototype but every figure computed (dead rate, threshold, days-to-trigger, dead GB ≈ `thr * (pages*8192/live)`, cost delay, mbps, minutes from `runCost(current)`, freeze clause only when exceeded, proposed period from `runCost(values)`/`threshold(values)`). Footnote 1 uses `lastAutovacuum` age; footnote 2 mentions `indexes` when present.
- [ ] **Step 3:** `Slider`: three-marker track per handoff §Slider component; pointer drag captures rect on `pointerdown`, applies at down position, `window` listeners until `pointerup`, `fromPos` on every move. Notes: static from `SettingDef.note`, except `autovacuum_freeze_max_age` shows `currently exceeded` when `snap.xidAge > values.autovacuum_freeze_max_age`, and `autovacuum_vacuum_scale_factor` shows `{fmtCompact(prop*live)} dead rows`.
- [ ] **Step 4:** Figures per handoff §Fig1-3 + Output (prototype lines 210-334): sawtooth SVG (dashed current vs solid live, warn threshold line, comparison strip), freeze band (age fill, danger band from 1.6e9, ticks, legend rows, aggressive/shutdown strip), I/O bars, SQL output (`ALTER TABLE {snap.table} SET (...)` w/ changed-vs-current only, comment block when none, copy button w/ `copied` flip that resets on next change).
- [ ] **Step 5:** `npm run dev`, open `/report`: demo renders, sliders drag, auto-optimize/reset work, URL hash updates, reload restores tuned state, `#1.garbage` shows the error state. Commit `feat(report): report page`.

### Task 6: Explain pages, arcana, mcp page

**Files:**

- Create: `lib/terms.tsx` (registry), `app/explain/[slug]/page.tsx`, `components/explain/XminDemo.tsx`, `components/explain/FreezeDemo.tsx`, `app/arcana/page.tsx`, `app/mcp/page.tsx`

**Interfaces:**

- Consumes: `TermLink`, `panel` styles, `fmtInt/fmtCompact/fmtDur`, `sawPath` idea (FreezeDemo builds its own path with rate/365d per prototype lines 761-771).
- Produces:

```ts
export interface Term {
  slug: string;
  title: string;
  kind: string;
  blurb: string;
  tag: string;
  built: boolean;
  definition?: ReactNode;
  Demo?: ComponentType;
  seeAlso?: string[];
  footnote?: string;
}
export const TERMS: Term[]; // the 12 arcana entries, prototype lines 808-821; built: xmin, autovacuum_freeze_max_age
```

- [ ] **Step 1:** `TERMS` registry with the 12 entries (term, kind, blurb, tag verbatim from the prototype). `generateStaticParams` over `built` slugs; unknown/draft slug → `notFound()`.
- [ ] **Step 2:** Explain template per handoff §3 (route label, title, definition, demo frame, SEE ALSO incl. `← back to events.event_log` → `/report`, closing footnote).
- [ ] **Step 3:** `XminDemo` (client): state `{ xid, snapshotXid, rows, nextCtid }` seeded per prototype lines 588-601; UPDATE/DELETE/BEGIN-COMMIT/VACUUM/reset semantics per lines 873-892; row states visible/held/dead w/ colors and strike; right pane stats + context hint (three variants, lines 727-730).
- [ ] **Step 4:** `FreezeDemo` (client): two log sliders (freeze_max_age 1e8-2e9, rate 1e6-4e8, million-snapped), 365d sawtooth SVG, threshold label clamped `max(22, y-5)`, readouts AGGRESSIVE VACUUM EVERY / RUNS PER YEAR / MARGIN TO SHUTDOWN (warn under 5 days).
- [ ] **Step 5:** `/arcana` rows (300px/1fr/210px grid, hover wash, draft rows `fg-faint` and non-linking) + closing note; `/mcp` page per handoff §4 (config panel, 2×2 tool cards, buttons, footnote). Verify all routes in the browser. Commit `feat(pages): explain, arcana, mcp`.

### Task 7: Optimizer

**Files:**

- Create: `lib/core/optimize.ts`
- Test: `lib/core/optimize.test.ts`

**Interfaces (produced):**

```ts
export interface Proposal {
  values: Values;
  reasons: Record<string, string>;
}
export function optimize(snap: Omit<Snapshot, "proposed">): Proposal;
```

Heuristics (each changed key gets a one-sentence reason):

- trigger: target interval = clamp(`0.05 * live / deadPerDay`, 0.25 d, 1 d) → wanted rows `deadPerDay * interval`; `scale_factor = clamp(wanted*0.2/live, 0.001, 0.2)` snapped to 2 significant digits, `threshold = round(wanted*0.8 / 100)*100` capped 50,000. Analyze: same shape at 2× the interval, 10% target split.
- cost: pick the smallest `cost_limit` in {200, 600, 1200, 2400, 4800, 10000} (delay 2 ms, miss 2) whose `runCost.seconds <= 4 h` and `mbps*86400 >= 2× daily dead MB`; page costs reset to defaults (1/2/20).
- freeze: if `deadPerDay/live < 0.001` (append-mostly) `freeze_min_age = 20e6` else keep; `freeze_table_age = min(2*current freeze_max_age target, 400e6)`; `freeze_max_age = clamp(round(xidPerDay * 45 / 1e6)*1e6 + xidAge headroom, 200e6, 800e6)` — concretely: `max(200e6, min(800e6, round((xidAge + 45*xidPerDay)/1e8)*1e8))`. Multixact = 1.5× freeze_max_age capped 1.2e9.

- [ ] **Step 1:** Failing tests: demo snapshot → every proposed value within its `SettingDef` range, `threshold(proposal)` period between 6 h and 24 h, cost proposal finishes a pass under 4 h, every changed key has a reason, healthy small table (live 1e5, deadPerDay 1e3, xidAge 1e7) → proposal ≈ defaults (no cost change, no freeze change).
- [ ] **Step 2:** Fail. **Step 3:** Implement. **Step 4:** Green. **Step 5:** Commit `feat(core): optimizer with per-setting reasons`.

### Task 8: robovac-mcp package

**Files:**

- Create: `packages/robovac-mcp/package.json` (bin `robovac-mcp`, deps `@modelcontextprotocol/sdk`, `pg`, `zod`), `packages/robovac-mcp/tsconfig.json`, `packages/robovac-mcp/src/index.ts`, `packages/robovac-mcp/src/queries.ts`
- Test: `packages/robovac-mcp/src/queries.test.ts` (SQL string sanity only, no live DB)

**Interfaces:**

- Consumes: `SnapshotSchema`, `optimize`, `encodeReport`, `TERMS` slugs (import from the app via relative path `../../lib/core` — the root tsconfig gets a `@core/*` path both sides use).
- Produces: stdio MCP server w/ tools:
  - `snapshot_table({schema, table, sample_seconds = 15})` → reads `pg_stat_user_tables`, `pg_statio_user_tables`, `pg_class` (reltuples, relpages, `age(relfrozenxid)`), reloptions + `pg_settings` twice `sample_seconds` apart for `deadPerDay`/`xidPerDay` (from `txid_current()` delta, fallback to defaults when on standby), builds `Snapshot` w/ `proposed = optimize(...)`, returns `{ url: BASE + '/report#' + encodeReport(...), verdict }`. `BASE` from env `ROBOVAC_BASE_URL`, default `http://localhost:3000`.
  - `list_candidates({limit = 10})` → tables ranked by `n_dead_tup::float/NULLIF(n_live_tup,0) + age(relfrozenxid)/2^31`, returns name + dead ratio + xid age.
  - `explain_term({term})` → `{ url: BASE + '/explain/' + slug }` for built terms, error listing valid slugs otherwise.
- Connection from `DATABASE_URL`, one `pg.Client`, statement_timeout 5 s, every query read-only (`BEGIN READ ONLY` not needed, plain SELECTs).

- [ ] **Step 1:** Failing test: exported SQL strings contain no write keywords (`INSERT|UPDATE|DELETE|ALTER|DROP|CREATE`), `snapshotQuery` selects the columns the schema needs.
- [ ] **Step 2:** Fail. **Step 3:** Implement server + queries. **Step 4:** `npm test` green, `node --experimental-strip-types` or tsx smoke run: server starts and lists 3 tools w/o a DB (tools fail lazily on call). **Step 5:** Commit `feat(mcp): robovac-mcp stdio server`.

### Task 9: Verification pass

- [ ] **Step 1:** `npm test` and `npm run build` both clean.
- [ ] **Step 2:** Open the prototype `Robovac.dc.html` and `localhost:3000` side by side in the browser (claude-in-chrome), screenshot `/report`, `/explain/xmin`, `/explain/autovacuum_freeze_max_age`, `/arcana`, `/mcp` and fix visual deltas (spacing, colors, type sizes).
- [ ] **Step 3:** Interaction check: drag sliders in all three groups, collapse/expand, auto-optimize, both resets, copy, xmin demo full cycle (UPDATE, BEGIN, DELETE, VACUUM blocked-then-allowed, COMMIT, VACUUM, reset), freeze demo sliders, tuned-URL reload.
- [ ] **Step 4:** Commit `fix: visual polish after prototype comparison` (or nothing if clean).
