# Short report URLs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `create_report` returns a 45-character `/r/<id>` link that resolves for 30 days, next to the `/report#<fragment>` permalink that never expires.

**Architecture:** A `LinkStore` interface with two implementations, Redis for production and a JSON file for development, selected by `REDIS_URL` alone. A server component at `/r/[id]` reads the store and hands the fragment to the existing `ReportView`, which gains one rule: use the hash when there is one, else use the prop.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, vitest, `redis` (node-redis v4), zod.

Spec: `docs/superpowers/specs/2026-08-04-short-report-urls-design.md`.

## Global Constraints

- **Two PRs, not stacked.** Phase 1 (Tasks 1-2) is PR 1. Phase 2 (Tasks 3-12) is PR 2, branched from main **after** PR 1 merges.
- **One commit per PR.** Commit per task while working, then `git rebase -i` and squash to one commit before opening the PR. The commit message carries the PR description.
- **Conventional Commits.** `<type>(scope): <lower-case imperative description>`, no trailing period.
- **No em dashes or en dashes** in any code comment, copy string, commit message or PR text. Use a comma, a colon, parentheses, or two sentences.
- **No semicolons as prose punctuation** in user-facing copy strings.
- **Link lifetime is 30 days**, expressed once as a constant in `lib/links/store.ts`. Never a function parameter.
- **`REDIS_URL` is the only switch.** Never add a second flag such as `USE_REDIS` or key the choice on `NODE_ENV` alone.
- Verification after every task: `pnpm lint`, `pnpm test`, `pnpm build`.

---

## File Structure

**Phase 1 moves (no content change beyond import paths):**

| From                                       | To                         |
| ------------------------------------------ | -------------------------- |
| `packages/robovac-mcp/src/report.ts`       | `lib/core/report.ts`       |
| `packages/robovac-mcp/src/report.test.ts`  | `lib/core/report.test.ts`  |
| `packages/robovac-mcp/src/queries.ts`      | `lib/core/queries.ts`      |
| `packages/robovac-mcp/src/queries.test.ts` | `lib/core/queries.test.ts` |
| `packages/robovac-mcp/src/tools.ts`        | `lib/mcp/tools.ts`         |

**Phase 2 new files:**

| File                       | Responsibility                                                         |
| -------------------------- | ---------------------------------------------------------------------- |
| `lib/links/store.ts`       | The `LinkStore` interface, the TTL constant, the id generator. No I/O. |
| `lib/links/file-store.ts`  | Development. One JSON file.                                            |
| `lib/links/redis-store.ts` | Production. Two Redis commands, plus the shared client.                |
| `lib/links/rate-limit.ts`  | One counter per IP per hour. No-op without Redis.                      |
| `lib/links/index.ts`       | Picks an implementation from the environment.                          |
| `app/r/[id]/page.tsx`      | Reads the store, renders the report or the expired state.              |

---

## Phase 1: PR 1, delete the fake package

### Task 1: Move the sources into the app

**Files:**

- Move: the five files in the Phase 1 table above
- Modify: `app/api/[transport]/route.ts:2`, `components/home/HomeView.tsx:13-14`, `components/report/ReportView.tsx:19`
- Modify: `Dockerfile:4-5`, `vitest.config.ts:9,12`, `tsconfig.json:20`, `.oxlintrc.json:16`, `package.json`
- Delete: `packages/`, `pnpm-workspace.yaml`

**Interfaces:**

- Consumes: nothing.
- Produces: `@/lib/core/report` exports `Row`, `insertPeriodDays`, `bindingTrigger`, `buildSnapshot`, `verdict`. `@/lib/core/queries` exports `snapshotSql`, `candidatesSql`. `@/lib/mcp/tools` exports `registerTools(server: McpServer): void`.

- [ ] **Step 1: Record the baseline**

Run: `pnpm test 2>&1 | tail -5`
Write the passing test count down. This task must not change it. A rename has no new behaviour, so the existing suite is the whole proof.

- [ ] **Step 2: Move the files with git**

```bash
mkdir -p lib/mcp
git mv packages/robovac-mcp/src/report.ts lib/core/report.ts
git mv packages/robovac-mcp/src/report.test.ts lib/core/report.test.ts
git mv packages/robovac-mcp/src/queries.ts lib/core/queries.ts
git mv packages/robovac-mcp/src/queries.test.ts lib/core/queries.test.ts
git mv packages/robovac-mcp/src/tools.ts lib/mcp/tools.ts
```

- [ ] **Step 3: Rewrite the imports inside the moved files**

`lib/mcp/tools.ts` lines 3-9 currently reach up three directories. Replace that block with:

```ts
import { encodeReport } from "@/lib/core/codec";
import { optimize } from "@/lib/core/optimize";
import { SETTINGS } from "@/lib/core/settings";
import type { Hints } from "@/lib/core/snapshot";
import { findTerm, TERMS, termHref } from "@/lib/terms";
import { candidatesSql, snapshotSql } from "@/lib/core/queries";
import { buildSnapshot, verdict } from "@/lib/core/report";
```

Then check `lib/core/report.ts`, `lib/core/queries.ts` and the two test files for any remaining `../../../` or `./queries` style import and repoint it at `@/lib/core/…`.

- [ ] **Step 4: Repoint the three app importers**

```
app/api/[transport]/route.ts:2   →  import { registerTools } from "@/lib/mcp/tools";
components/home/HomeView.tsx:13  →  import { snapshotSql } from "@/lib/core/queries";
components/home/HomeView.tsx:14  →  import { buildSnapshot } from "@/lib/core/report";
components/report/ReportView.tsx:19 → import { bindingTrigger, insertPeriodDays } from "@/lib/core/report";
```

- [ ] **Step 5: Delete the package and the workspace**

```bash
git rm -r --cached packages
rm -rf packages
git rm pnpm-workspace.yaml
```

- [ ] **Step 6: Update the config files**

`vitest.config.ts` line 9 and line 12 lose the `packages` globs:

```ts
    include: ["lib/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["lib/**"],
```

`tsconfig.json` line 20:

```json
  "exclude": ["node_modules"]
```

`.oxlintrc.json` line 16:

```json
  "ignorePatterns": ["node_modules", ".next", "out"]
```

`Dockerfile` lines 4-5 become one line:

```dockerfile
COPY package.json pnpm-lock.yaml ./
```

- [ ] **Step 7: Add the two dependencies the app now owns directly**

`lib/mcp/tools.ts:1` imports `McpServer` as a type. It resolves today only because `mcp-handler` happens to pull the SDK in. Make it explicit, and add `redis` now so Phase 2 does not have to touch `package.json` again.

```bash
pnpm add @modelcontextprotocol/sdk redis
```

Confirm `package.json` `dependencies` gained both, then `pnpm install` to rewrite the lockfile without the workspace.

- [ ] **Step 8: Verify nothing changed but the paths**

```bash
grep -rn "robovac-mcp\|packages/" --include='*.ts' --include='*.tsx' --include='*.json' . \
  --exclude-dir=node_modules --exclude-dir=.next | grep -v pnpm-lock | grep -v changelog
```

Expected: no output. `app/changelog/entries.json:176` is generated commit history and keeps the old name on purpose.

Then `pnpm lint && pnpm test && pnpm build`. The test count must equal Step 1.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor(mcp): move the mcp sources into the app, delete the fake package"
```

---

### Task 2: Drop the stdio copy from /mcp

`robovac-mcp` is not on npm (`npm view robovac-mcp` returns 404), so the page advertises an install nobody can run.

**Files:**

- Modify: `app/mcp/page.tsx:34-35`, `app/mcp/page.tsx:114`

**Interfaces:**

- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Remove the npx block from the config sample**

`app/mcp/page.tsx` lines 28-35, the `CONFIG` template literal, ends after the Codex line. Delete the blank line, the `# prefer a local process? same tools over stdio:` comment and the `npx -y robovac-mcp` line, so it reads:

```ts
const CONFIG = `# Claude Code
claude mcp add --transport http robovac https://robovac.hannesmoser.at/api/mcp

# Codex
codex mcp add robovac --url https://robovac.hannesmoser.at/api/mcp`;
```

- [ ] **Step 2: Fix the transport chip**

`app/mcp/page.tsx:114` reads `streamable http · stdio`. There is one transport now:

```tsx
            streamable http
```

- [ ] **Step 3: Verify**

Run: `pnpm lint && pnpm build`
Then `pnpm dev` and open `/mcp`. The config block shows two entries and the panel header reads `streamable http`.

- [ ] **Step 4: Commit**

```bash
git add app/mcp/page.tsx
git commit -m "docs(mcp): drop the stdio install, the package was never published"
```

- [ ] **Step 5: Squash and open PR 1**

```bash
git rebase -i main   # squash Task 2 into Task 1
git push -u origin <branch>
```

PR description (also the commit body):

```
packages/robovac-mcp was a directory wearing a package.json. tsconfig excluded it
while three app files imported its internals, tools.ts reached back up with
../../../lib/core/..., and it duplicated zod and fflate from the root.

report.ts and queries.ts are domain logic (the report UI calls bindingTrigger and
insertPeriodDays, HomeView builds the same SQL), so they land in lib/core/. Only
tools.ts is MCP, it lands in lib/mcp/.

robovac-mcp was never published to npm, so /mcp advertised an npx install that
404s. That copy is gone.

@modelcontextprotocol/sdk and redis are now explicit root dependencies. The SDK
type import resolved through mcp-handler by luck, redis is for the next PR.

No behavior change. The suite passes at the same count.
```

Wait for PR 1 to merge before starting Task 3. Then `git checkout main && git pull`.

---

## Phase 2: PR 2, the store

### Task 3: The store interface and the id

**Files:**

- Create: `lib/links/store.ts`
- Test: `lib/links/store.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `LINK_TTL_MS: number`, `LINK_TTL_SECONDS: number`, `interface StoredLink { fragment: string; expiresAt: number }`, `interface LinkStore { put(fragment: string): Promise<{ id: string; expiresAt: number }>; get(id: string): Promise<StoredLink | null> }`, `newId(): string`.

- [ ] **Step 1: Write the failing test**

Create `lib/links/store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { LINK_TTL_SECONDS, newId } from "./store";

describe("newId", () => {
  it("is exactly 12 base64url characters", () => {
    expect(newId()).toMatch(/^[A-Za-z0-9_-]{12}$/);
  });

  it("does not repeat", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId()));
    expect(ids.size).toBe(1000);
  });
});

describe("LINK_TTL_SECONDS", () => {
  it("is 30 days", () => {
    expect(LINK_TTL_SECONDS).toBe(2592000);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run lib/links/store.test.ts`
Expected: FAIL, cannot resolve `./store`.

- [ ] **Step 3: Write the implementation**

Create `lib/links/store.ts`:

```ts
import { randomBytes } from "node:crypto";

/**
 * How long a short link resolves. A constant, never a parameter: no caller
 * wants a different lifetime, and a per-link TTL is surface nobody asked for.
 */
export const LINK_TTL_SECONDS = 30 * 24 * 60 * 60;
export const LINK_TTL_MS = LINK_TTL_SECONDS * 1000;

export interface StoredLink {
  /** The codec fragment, exactly as encodeReport produced it. */
  fragment: string;
  /** Epoch milliseconds. The report page prints the days left from this. */
  expiresAt: number;
}

export interface LinkStore {
  put(fragment: string): Promise<{ id: string; expiresAt: number }>;
  get(id: string): Promise<StoredLink | null>;
}

/**
 * 9 random bytes as base64url: exactly 12 characters, no padding, 72 bits.
 * The payload carries real table names, so a guessable id leaks production
 * data. There is no collision check anywhere: at 72 bits the first collision
 * arrives near 2^36 stored links.
 */
export function newId(): string {
  return randomBytes(9).toString("base64url");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run lib/links/store.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/links/store.ts lib/links/store.test.ts
git commit -m "feat(links): the link store interface and the 12-character id"
```

---

### Task 4: The file store

**Files:**

- Create: `lib/links/file-store.ts`
- Test: `lib/links/file-store.test.ts`

**Interfaces:**

- Consumes: `LINK_TTL_MS`, `newId`, `LinkStore`, `StoredLink` from `./store`.
- Produces: `fileStore(path: string): LinkStore`.

Note on testing time: the store reads the clock directly, there is no injectable clock (that is surface nobody needs). To test expiry, write an already-expired row into the JSON file by hand and then read it back.

- [ ] **Step 1: Write the failing test**

Create `lib/links/file-store.test.ts`:

```ts
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { fileStore } from "./file-store";

let path: string;

beforeEach(() => {
  path = join(mkdtempSync(join(tmpdir(), "robovac-links-")), "links.json");
});

describe("fileStore", () => {
  it("returns the fragment it stored", async () => {
    const store = fileStore(path);
    const { id } = await store.put("3.ab.cd.payload");
    expect(await store.get(id)).toMatchObject({ fragment: "3.ab.cd.payload" });
  });

  it("returns null for an unknown id", async () => {
    expect(await fileStore(path).get("nosuchid1234")).toBeNull();
  });

  it("gives two puts of the same fragment different ids", async () => {
    const store = fileStore(path);
    const a = await store.put("same");
    const b = await store.put("same");
    expect(a.id).not.toBe(b.id);
    expect(await store.get(a.id)).toMatchObject({ fragment: "same" });
    expect(await store.get(b.id)).toMatchObject({ fragment: "same" });
  });

  it("expires in 30 days", async () => {
    const { expiresAt } = await fileStore(path).put("x");
    const days = (expiresAt - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });

  it("returns null for an expired row and drops it from the file", async () => {
    writeFileSync(
      path,
      JSON.stringify({ oldlink12345: { fragment: "gone", expiresAt: Date.now() - 1000 } }),
    );
    const store = fileStore(path);
    expect(await store.get("oldlink12345")).toBeNull();
    expect(readFileSync(path, "utf8")).not.toContain("oldlink12345");
  });

  it("survives a corrupt file", async () => {
    writeFileSync(path, "not json at all");
    const store = fileStore(path);
    const { id } = await store.put("fresh");
    expect(await store.get(id)).toMatchObject({ fragment: "fresh" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run lib/links/file-store.test.ts`
Expected: FAIL, cannot resolve `./file-store`.

- [ ] **Step 3: Write the implementation**

Create `lib/links/file-store.ts`:

```ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { LINK_TTL_MS, newId, type LinkStore, type StoredLink } from "./store";

type Rows = Record<string, StoredLink>;

/**
 * The development store. One JSON file, rewritten on every call, expired rows
 * dropped whenever the file is read. A plain in-process Map would lose every
 * link on a `next dev` module reload, which makes a 30-day flow untestable.
 * A corrupt file reads as empty: this is a scratch file, not a database.
 */
export function fileStore(path: string): LinkStore {
  const load = (): Rows => {
    if (!existsSync(path)) return {};
    try {
      return JSON.parse(readFileSync(path, "utf8")) as Rows;
    } catch {
      return {};
    }
  };

  const save = (rows: Rows) => writeFileSync(path, JSON.stringify(rows, null, 2));

  const live = (rows: Rows, now: number): Rows =>
    Object.fromEntries(Object.entries(rows).filter(([, row]) => row.expiresAt > now));

  return {
    async put(fragment) {
      const now = Date.now();
      const id = newId();
      const expiresAt = now + LINK_TTL_MS;
      save({ ...live(load(), now), [id]: { fragment, expiresAt } });
      return { id, expiresAt };
    },

    async get(id) {
      const rows = live(load(), Date.now());
      save(rows);
      return rows[id] ?? null;
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run lib/links/file-store.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Ignore the dev store file**

Append to `.gitignore`:

```
.links-dev.json
```

- [ ] **Step 6: Commit**

```bash
git add lib/links/file-store.ts lib/links/file-store.test.ts .gitignore
git commit -m "feat(links): the development file store"
```

---

### Task 5: The Redis store

**Files:**

- Create: `lib/links/redis-store.ts`

**Interfaces:**

- Consumes: `LINK_TTL_MS`, `LINK_TTL_SECONDS`, `newId`, `LinkStore`, `StoredLink` from `./store`. `createClient` from `redis`.
- Produces: `redisStore(url: string): LinkStore`, `redisClient(url: string): RedisClientType` (memoized, reused by the rate limiter in Task 11).

No unit test here. There is no Redis in CI and mocking two commands proves nothing about the two commands. The file store carries the behaviour tests, this file stays short enough to read. Task 12's manual check exercises it.

- [ ] **Step 1: Write the implementation**

Create `lib/links/redis-store.ts`:

```ts
import { createClient, type RedisClientType } from "redis";
import { LINK_TTL_MS, LINK_TTL_SECONDS, newId, type LinkStore, type StoredLink } from "./store";

let client: RedisClientType | undefined;

/**
 * One connection per process, shared with the rate limiter. Connect once and
 * hand out the same promise: node-redis queues commands until it is ready.
 */
export function redisClient(url: string): RedisClientType {
  if (!client) {
    client = createClient({ url }) as RedisClientType;
    client.on("error", (err) => console.error("[links] redis:", err));
    void client.connect();
  }
  return client;
}

/**
 * Production. Two commands and no collision guard, see newId for why. The
 * expiry lives in the value as well as in EX: the report page prints the days
 * left, and reading it from the value costs no second round trip.
 */
export function redisStore(url: string): LinkStore {
  const redis = redisClient(url);

  return {
    async put(fragment) {
      const id = newId();
      const expiresAt = Date.now() + LINK_TTL_MS;
      const row: StoredLink = { fragment, expiresAt };
      await redis.set(`link:${id}`, JSON.stringify(row), { EX: LINK_TTL_SECONDS });
      return { id, expiresAt };
    },

    async get(id) {
      const raw = await redis.get(`link:${id}`);
      return raw ? (JSON.parse(raw) as StoredLink) : null;
    },
  };
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm lint && npx tsc --noEmit`
Expected: no errors. If `{ EX: … }` is rejected, check the installed node-redis major with `npm ls redis`. v4 takes `{ EX: n }`, v5 and later take `{ expiration: { type: "EX", value: n } }`.

- [ ] **Step 3: Commit**

```bash
git add lib/links/redis-store.ts
git commit -m "feat(links): the redis store"
```

---

### Task 6: Pick a store from the environment

**Files:**

- Create: `lib/links/index.ts`
- Test: `lib/links/index.test.ts`

**Interfaces:**

- Consumes: `fileStore` from `./file-store`, `redisStore` from `./redis-store`, `LinkStore` from `./store`.
- Produces: `linkStore(): LinkStore`.

- [ ] **Step 1: Write the failing test**

Create `lib/links/index.test.ts`. Each case needs a fresh module registry, because `linkStore` memoizes.

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.resetModules();
});

async function load() {
  vi.resetModules();
  return (await import("./index")).linkStore;
}

describe("linkStore", () => {
  it("throws in production without REDIS_URL", async () => {
    delete process.env.REDIS_URL;
    process.env.NODE_ENV = "production";
    const linkStore = await load();
    expect(() => linkStore()).toThrow(/REDIS_URL/);
  });

  it("uses the file store in development", async () => {
    delete process.env.REDIS_URL;
    process.env.NODE_ENV = "development";
    const linkStore = await load();
    expect(linkStore()).toHaveProperty("put");
  });

  it("returns the same instance on every call", async () => {
    delete process.env.REDIS_URL;
    process.env.NODE_ENV = "development";
    const linkStore = await load();
    expect(linkStore()).toBe(linkStore());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run lib/links/index.test.ts`
Expected: FAIL, cannot resolve `./index`.

- [ ] **Step 3: Write the implementation**

Create `lib/links/index.ts`:

```ts
import { fileStore } from "./file-store";
import { redisStore } from "./redis-store";
import type { LinkStore } from "./store";

export type { LinkStore, StoredLink } from "./store";

/** Where the development store keeps its rows. Gitignored. */
const DEV_STORE_PATH = ".links-dev.json";

let store: LinkStore | undefined;

/**
 * REDIS_URL is the only switch. One variable cannot disagree with itself the
 * way a separate USE_REDIS flag can. A production deploy that forgets it
 * fails here, instead of quietly writing links into a container filesystem
 * that the next replica cannot read.
 */
export function linkStore(): LinkStore {
  if (store) return store;

  const url = process.env.REDIS_URL;
  if (url) {
    store = redisStore(url);
  } else if (process.env.NODE_ENV === "production") {
    throw new Error("REDIS_URL is required in production: short report links need a store");
  } else {
    store = fileStore(DEV_STORE_PATH);
  }
  return store;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run lib/links/index.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/links/index.ts lib/links/index.test.ts
git commit -m "feat(links): select the store from REDIS_URL, fail loudly in production"
```

---

### Task 7: Let ReportView take a fragment prop

Today `ReportView` reads `window.location.hash` inside a `useEffect`, so where the payload comes from is welded to how the report renders. Split those.

**Files:**

- Modify: `components/report/ReportView.tsx:61-90`, and the render root at `:255`

**Interfaces:**

- Consumes: `NoticeBar` from `@/components/report/states` (already imported in this file).
- Produces: `ReportView(props?: { fragment?: string; expiresInDays?: number })`.

Why `expiresInDays` and not `expiresAt`: the caller is a server component. Calling `Date.now()` during a client render of a server-rendered page risks a hydration mismatch at a day boundary. The server computes the number, the client only prints it.

- [ ] **Step 1: Change the signature and the payload source**

`components/report/ReportView.tsx:61` becomes:

```tsx
export function ReportView({
  fragment,
  expiresInDays,
}: {
  /** Set by /r/[id]. The hash still wins when there is one. */
  fragment?: string;
  /** Set by /r/[id]. Absent on a permalink, which never expires. */
  expiresInDays?: number;
} = {}) {
```

Inside the first `useEffect` (line 80), replace the decode line:

```tsx
const p = decodeReport(window.location.hash || fragment || "");
```

and change the dependency array on line 90 from `[]` to `[fragment]`.

- [ ] **Step 2: Render the expiry notice**

In the render root at line 255, immediately after the closing `)}` of the `{snap.demo && ( … )}` block, insert:

```tsx
{
  expiresInDays !== undefined && (
    <div style={{ paddingTop: 16 }}>
      <NoticeBar
        severity="neutral"
        title="short link"
        body={`This link stops working in ${expiresInDays} ${
          expiresInDays === 1 ? "day" : "days"
        }. The permalink in the MCP result has no expiry, keep that one if you file this somewhere.`}
      />
    </div>
  );
}
```

- [ ] **Step 3: Verify the permalink path is untouched**

Run: `pnpm lint && pnpm test && pnpm build`
Then `pnpm dev`, open an existing `/report#…` link. No notice bar, the report renders as before, and moving a slider still rewrites the hash.

- [ ] **Step 4: Commit**

```bash
git add components/report/ReportView.tsx
git commit -m "refactor(report): take the payload from a prop when there is no hash"
```

---

### Task 8: The expired state

**Files:**

- Modify: `components/report/ErrorState.tsx` (add one exported component, leave `ErrorState` alone)

**Interfaces:**

- Consumes: the local `Eyebrow`, `Title`, `Body`, `Footer` helpers already in the file, `C`, `MONO`, `primaryButton` from `@/components/ui`.
- Produces: `ExpiredState(): JSX.Element`.

This is a route condition, not a `CodecError`, so it stays out of the `error.kind` switch. `ErrorState` keeps its one job.

- [ ] **Step 1: Add the component**

Append to `components/report/ErrorState.tsx`, after the existing `ErrorState` export:

```tsx
/**
 * A short link that no longer resolves. An expired id and an id that never
 * existed are indistinguishable once the entry is gone, so this is one state
 * and it does not guess which happened.
 */
export function ExpiredState() {
  return (
    <div className="page-pad" style={{ maxWidth: 980, margin: "0 auto" }}>
      <div style={{ fontFamily: MONO, fontSize: 11, color: C.faint }}>/r</div>
      <div style={{ marginTop: 18, maxWidth: 640 }}>
        <Eyebrow label="LINK EXPIRED" warn />
        <Title>This short link no longer resolves.</Title>
        <Body>
          A short link holds the report for 30 days. This one is past that, or it never existed.
          robovac cannot tell the two apart, because it keeps no record of what it dropped.
        </Body>
        <div style={{ display: "flex", gap: 9, flexWrap: "wrap", marginTop: 18 }}>
          <a className="btn-primary" href="/" style={{ ...primaryButton, textDecoration: "none" }}>
            → build a fresh report
          </a>
        </div>
        <Footer>
          Ask whoever sent it for the permalink instead. Every MCP result carries both links, and
          the permalink form has no expiry.
        </Footer>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `pnpm lint && pnpm build`
Expected: no unused-import warnings, no type errors.

- [ ] **Step 3: Commit**

```bash
git add components/report/ErrorState.tsx
git commit -m "feat(report): the expired short link state"
```

---

### Task 9: The /r/[id] route

**Files:**

- Create: `app/r/[id]/page.tsx`
- Modify: `app/robots.txt/route.ts`, `app/sitemap.xml/route.ts:5`

**Interfaces:**

- Consumes: `linkStore` from `@/lib/links`, `ReportView` from `@/components/report/ReportView`, `ExpiredState` from `@/components/report/ErrorState`, `social` from `@/lib/social`.
- Produces: the route. Nothing imports it.

- [ ] **Step 1: Write the page**

Create `app/r/[id]/page.tsx`:

```tsx
import type { Metadata } from "next";
import { ExpiredState } from "@/components/report/ErrorState";
import { ReportView } from "@/components/report/ReportView";
import { linkStore } from "@/lib/links";
import { social } from "@/lib/social";

// Same treatment as /report: this renders someone's table names and
// statistics. Never index it, keep the generic card.
export const metadata: Metadata = {
  title: "robovac — table report",
  robots: { index: false, follow: false },
  alternates: { canonical: "/" },
  ...social({
    title: "A Postgres vacuum report",
    description: "One table's autovacuum settings, read and tuned.",
    path: "/",
  }),
};

// The store is read per request. Nothing here is cacheable.
export const dynamic = "force-dynamic";

export default async function ShortReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const stored = await linkStore().get(id);
  if (!stored) return <ExpiredState />;

  // Computed on the server so the client never reads the clock during
  // hydration, which would mismatch at a day boundary.
  const expiresInDays = Math.max(0, Math.ceil((stored.expiresAt - Date.now()) / 86_400_000));
  return <ReportView fragment={stored.fragment} expiresInDays={expiresInDays} />;
}
```

- [ ] **Step 2: Keep crawlers out**

`app/robots.txt/route.ts`, the comment on lines 3-4 and the body:

```ts
// The report routes carry someone's table statistics, /report in its fragment
// and /r/ in a stored payload: never crawl either. The rest is public docs.
export async function GET() {
  const origin = await requestOrigin();
  const body = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /report",
    "Disallow: /r/",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
```

The trailing slash on `/r/` matters. A bare `/r` is a prefix match that also covers `/report`, which hides the intent.

`app/sitemap.xml/route.ts:5`:

```ts
// The report routes are deliberately absent (noindex, private payloads).
```

- [ ] **Step 3: Verify by hand**

```bash
pnpm build && pnpm dev
```

The route needs a stored link, which Task 10 creates. For now check the failure path only:

Open `http://localhost:3000/r/aaaaaaaaaaaa`. Expected: the LINK EXPIRED state.
Open `http://localhost:3000/robots.txt`. Expected: both `Disallow` lines.

- [ ] **Step 4: Commit**

```bash
git add app/r app/robots.txt/route.ts app/sitemap.xml/route.ts
git commit -m "feat(report): serve a stored report at /r/<id>"
```

---

### Task 10: Return both links from create_report

**Files:**

- Modify: `lib/mcp/tools.ts` (the `registerTools` signature, the `create_report` handler around line 141, the `json` result block)
- Modify: `app/api/[transport]/route.ts:7`

**Interfaces:**

- Consumes: `LinkStore` and `linkStore` from `@/lib/links`.
- Produces: `registerTools(server: McpServer, store: LinkStore): void`. The `create_report` result gains `permalink` and `expires_at`, and `url` changes meaning from the permalink to the short link.

- [ ] **Step 1: Take a store**

`lib/mcp/tools.ts`, add to the imports:

```ts
import { MAX_FRAGMENT_BYTES } from "@/lib/links/rate-limit";
import type { LinkStore } from "@/lib/links";
```

and change the export:

```ts
export function registerTools(server: McpServer, store: LinkStore) {
```

Note: `MAX_FRAGMENT_BYTES` does not exist yet, it arrives in Task 11. Write the import now and expect the typecheck to fail until then, or do Task 11 first. The two tasks touch different files, so either order works.

- [ ] **Step 2: Build both links**

Replace line 141:

```ts
const url = `${base_url ?? DEFAULT_BASE_URL}/report#${encodeReport({ snap })}`;
```

with:

```ts
const base = base_url ?? DEFAULT_BASE_URL;
const fragment = encodeReport({ snap });
// A table name is free text, so a hostile row can inflate the payload.
if (fragment.length > MAX_FRAGMENT_BYTES) {
  return json({ error: "snapshot too large to store", bytes: fragment.length });
}
const { id, expiresAt } = await store.put(fragment);
const url = `${base}/r/${id}`;
const permalink = `${base}/report#${fragment}`;
```

- [ ] **Step 3: Return the new fields**

In the same handler's `json({ … })` call, replace the `url` and `url_note` entries with:

```ts
        url,
        permalink,
        expires_at: new Date(expiresAt).toISOString(),
        url_note:
          "url is short and stops working after 30 days. permalink carries the whole report and never expires, so file that one if you store this anywhere. Relay either by copy, never by re-typing: one changed character makes the link unusable, and the report page rejects it as damaged.",
```

- [ ] **Step 4: Say it in the tool description too**

The `create_report` description string (line 67) ends with "Optional workload hints sharpen the classification." Insert before that sentence:

```
Returns two links: a short url that expires in 30 days, and a permalink that never does.
```

- [ ] **Step 5: Pass the store at the route**

`app/api/[transport]/route.ts`, add the import and thread it through:

```ts
import { linkStore } from "@/lib/links";
```

```ts
const handler = createMcpHandler(
  (server) => registerTools(server, linkStore()),
```

Also fix the comment on line 5, which now lies:

```ts
// The public MCP endpoint at /api/mcp. No auth. A short link stores the
// report for 30 days, the permalink stores nothing.
```

- [ ] **Step 6: Verify end to end**

```bash
pnpm lint && pnpm test && pnpm build && pnpm dev
```

Call `create_report` through `/mcp` from your agent, or drive it by hand with the demo fixtures. Confirm the result has `url`, `permalink` and `expires_at`, that `.links-dev.json` gained a row, and that opening `url` renders the report with the "short link" notice.

- [ ] **Step 7: Commit**

```bash
git add lib/mcp/tools.ts "app/api/[transport]/route.ts"
git commit -m "feat(mcp): return a short url and a permalink from create_report"
```

---

### Task 11: Rate limit the hosted endpoint

The hosted `/mcp` is the only public write path. Two separate limits with two natural homes: a request counter at the route (it has the IP), and a payload cap inside the tool (it has the fragment, used in Task 10).

Scope note, differing from the spec: the counter caps **all** MCP requests per IP, not only writes. The route cannot see which tool a request will call without parsing the JSON-RPC body, and that parse is not worth the entanglement.

**Files:**

- Create: `lib/links/rate-limit.ts`
- Modify: `app/api/[transport]/route.ts`

**Interfaces:**

- Consumes: `redisClient` from `./redis-store`.
- Produces: `MAX_FRAGMENT_BYTES: number`, `MAX_REQUESTS_PER_HOUR: number`, `allow(ip: string): Promise<boolean>`.

- [ ] **Step 1: Write the limiter**

Create `lib/links/rate-limit.ts`:

```ts
import { redisClient } from "./redis-store";

/** A normal fragment is about 900 bytes. This only catches abuse. */
export const MAX_FRAGMENT_BYTES = 8192;

export const MAX_REQUESTS_PER_HOUR = 60;

/**
 * One counter per IP per clock hour. Without Redis there is nothing to
 * protect and nowhere to count, so development always allows.
 */
export async function allow(ip: string): Promise<boolean> {
  const url = process.env.REDIS_URL;
  if (!url) return true;

  const hour = Math.floor(Date.now() / 3_600_000);
  const key = `rl:${ip}:${hour}`;
  const redis = redisClient(url);
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 3600);
  return count <= MAX_REQUESTS_PER_HOUR;
}
```

- [ ] **Step 2: Apply it at the route**

`app/api/[transport]/route.ts`, inside `normalized`, before the handler runs:

```ts
const normalized = async (request: Request) => {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";
  if (!(await allow(ip))) {
    return new Response("rate limit exceeded", { status: 429 });
  }

  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) {
    url.pathname = `/api${url.pathname}`;
    return handler(new Request(url, request));
  }
  return handler(request);
};
```

Add the import:

```ts
import { allow } from "@/lib/links/rate-limit";
```

- [ ] **Step 3: Verify**

Run: `pnpm lint && pnpm test && pnpm build`
Then `pnpm dev` and call `/mcp` more than 60 times. Expected: all succeed, because development has no `REDIS_URL` and `allow` returns true.

- [ ] **Step 4: Commit**

```bash
git add lib/links/rate-limit.ts "app/api/[transport]/route.ts"
git commit -m "feat(mcp): cap requests per ip and reject oversized snapshots"
```

---

### Task 12: Rewrite the copy that promised no server state

Nine claims are now false. What stays true and stays written: robovac has no database driver, never runs your SQL, and reads no `DATABASE_URL`. Only the storage claim changes.

**Files:**

- Modify: `components/home/HomeView.tsx:624`, `components/report/ErrorState.tsx:167-169`, `app/mcp/page.tsx:69`, `app/mcp/page.tsx:191`, `docs/design-brief.md:13`, `docs/seo.md:11,20`

`app/api/[transport]/route.ts:5`, `app/robots.txt/route.ts:3` and `app/sitemap.xml/route.ts:5` were already fixed in Tasks 9 and 10.

**Interfaces:**

- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: The home page footnote**

`components/home/HomeView.tsx:624`, replace the string:

```ts
          "robovac has no database driver. The query is yours to run and the output is yours to paste. The report is computed in your browser from what you paste. A short link stores that report for 30 days so it fits in a chat message, and the permalink form stores nothing at all.",
```

- [ ] **Step 2: The truncated-link footer**

`components/report/ErrorState.tsx`, the `Footer` at lines 167-169. "robovac never had a copy of it" is no longer true for a short link:

```tsx
<Footer>
  Ask whoever sent it to copy the link again (the copy button on the report writes the whole thing).
  A short link would not fail this way, so this one is a permalink and its payload travelled in the
  URL.
</Footer>
```

- [ ] **Step 3: The /mcp grants card**

`app/mcp/page.tsx:69`, the `required grants` card body:

```ts
    body: "For your agent's own connection: a role in pg_monitor is enough. No table data is read, ever. robovac needs no DATABASE_URL and never opens a connection of its own. It does store one thing: a short link holds the report for 30 days.",
```

- [ ] **Step 4: The /mcp footnote**

`app/mcp/page.tsx:191`, the numbered footnote. It describes one link form and there are two:

```tsx
        create_report returns two links. The permalink carries the whole snapshot in its fragment,
        which browsers never send to a server (RFC 3986 §3.5), so it stays in the browser and never
        expires. It runs about 1200 characters. The short link is 45 characters and resolves for 30
        days, which means robovac stores that snapshot for 30 days.
```

- [ ] **Step 5: The design brief**

`docs/design-brief.md:13`:

```
An agent creates a link through our MCP server. The short form is an id that resolves for 30 days.
The permalink form contains all data in the URL fragment and never expires. The person opens either
one and sees the report. No login, no account. The URL is the product.
```

- [ ] **Step 6: The SEO doc**

`docs/seo.md`, line 11 opens "A report URL carries its whole payload in the fragment." Change it to say the permalink does, and that `/r/` does not. Line 20's option (b) proposed exactly this feature as a hypothetical, so replace that paragraph with a note that `/r/` now exists, is `noindex`, and that a per-report `og:image` is possible from it but is not built.

- [ ] **Step 7: Check nothing was missed**

```bash
grep -rn -i "never reaches a server\|never had a copy\|no server state\|no storage" \
  app components lib docs --include='*.ts' --include='*.tsx' --include='*.md'
```

Expected: no output.

- [ ] **Step 8: Verify**

Run: `pnpm lint && pnpm test && pnpm build`
Then read `/`, `/mcp` and a `/r/<id>` page in the browser. No sentence claims robovac stores nothing.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "docs(copy): say what robovac stores now that short links exist"
```

- [ ] **Step 10: Squash and open PR 2**

```bash
git rebase -i main   # squash Tasks 3-12 into one commit
git push -u origin <branch>
```

PR description (also the commit body):

```
A report link runs about 1200 characters. Chat clients wrap it, glue punctuation
to it, and agents re-type it instead of copying. The codec's length prefix and
checksum are treatment, not a cure.

create_report now returns two links: url is /r/<id> and resolves for 30 days,
permalink is the old /report#<fragment> and never expires. url keeps the primary
field name so an agent that reads url gets the short one.

REDIS_URL is the only switch. Set it and links go to Redis, leave it unset in
development and they go to .links-dev.json, leave it unset in production and the
process throws instead of writing links to a filesystem the next replica cannot
read.

The no-server-state promise is dead and nine pieces of copy said otherwise. All
rewritten. What stays true: no database driver, no DATABASE_URL, robovac never
runs your SQL.

An expired id and an id that never existed are indistinguishable once the entry
is gone, so /r/ has one failure state, not two.

The rate limit counts all MCP requests per IP per hour (60), not only writes.
Telling them apart needs a JSON-RPC body parse at the route, which is not worth
it. Payload cap is 8 KB against a ~900 byte normal fragment.

Design: docs/superpowers/specs/2026-08-04-short-report-urls-design.md
```

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: PR 1 → Tasks 1-2. Interface → Task 3. Implementations → Tasks 4-5. Selection → Task 6. The id → Task 3. The route → Tasks 7-9. Rate limit → Task 11. MCP result → Task 10. New error state → Task 8. Copy → Task 12 plus the pieces folded into Tasks 9 and 10. Verification → each task's own step plus the manual checks in Tasks 10 and 12.

**Two deliberate departures from the spec**, both flagged in place:

1. `ReportView` takes `expiresInDays`, not `expiresAt`. The spec implied the client computes the days left. A client component rendered inside a server component would then read the clock during hydration and can mismatch at a day boundary. The server computes it.
2. The rate limit counts all MCP requests per IP, not only writes. The route cannot tell which tool a request targets without parsing the JSON-RPC body.

**Known ordering trap.** Task 10 Step 1 imports `MAX_FRAGMENT_BYTES` from Task 11's file. The two tasks touch different files, so run them in either order, but the typecheck only passes once both are done.
