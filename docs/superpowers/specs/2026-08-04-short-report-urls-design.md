# short report URLs: a stored id next to the permalink

A report link is roughly 1200 characters. Chat clients wrap it, glue punctuation to it, and agents re-type it instead of copying. The codec already carries a length prefix and a checksum to survive that (`lib/core/codec.ts:49`), which is treatment, not a cure. This spec trades the no-server-state property for a 45-character URL and says so in every place the old promise is written down.

## tl;dr

`create_report` returns two links instead of one: a short `/r/<id>` that expires after 30 days, and the `/report#<fragment>` permalink that never expires. A Redis store holds the fragment in production, a file store holds it in development, selected by `REDIS_URL` alone. Nine pieces of shipped copy that promise "we store nothing" become true statements about what robovac now stores. One new error state covers a short link that no longer resolves.

Two PRs, not stacked. PR 1 deletes `packages/robovac-mcp` and moves its files into the app. PR 2 adds the store. PR 1 merges first, PR 2 branches from the new main.

## PR 1: delete the fake package

`packages/robovac-mcp` is a directory wearing a `package.json`. The evidence:

- `tsconfig.json:20` excludes `packages`, and the app imports from it anyway.
- `components/home/HomeView.tsx:13,14`, `components/report/ReportView.tsx:19` and `app/api/[transport]/route.ts:2` reach into its `src/` directly.
- `packages/robovac-mcp/src/tools.ts:3-7` reaches back up with `../../../lib/core/…`. The dependency points both ways.
- It declares its own `zod` and `fflate`, duplicating the root.
- `robovac-mcp` is not on npm (404), so the `npx -y robovac-mcp` line on `app/mcp/page.tsx:35` advertises a package nobody can install.

The move follows what each file is, not where it sat:

| From | To |
| --- | --- |
| `src/report.ts` (+ test) | `lib/core/report.ts` |
| `src/queries.ts` (+ test) | `lib/core/queries.ts` |
| `src/tools.ts` | `lib/mcp/tools.ts` |

`report.ts` exports `bindingTrigger`, `insertPeriodDays`, `buildSnapshot` and `verdict`. The report UI calls the first two. `queries.ts` builds SQL that `HomeView` also renders. Neither is MCP. `tools.ts` is.

Deleted: `src/index.ts`, `packages/robovac-mcp/package.json`, its `tsconfig.json`, `dist/`, the `packages/` directory, and `pnpm-workspace.yaml`.

`lib/mcp/tools.ts:1` imports `McpServer` as a type only. It resolves today through `mcp-handler`, which is luck, so the root gains an explicit `@modelcontextprotocol/sdk` dependency.

Relative imports become `@/lib/core/…`. Config follows: `Dockerfile:4-5`, `vitest.config.ts:9,12`, `tsconfig.json:20`, `.oxlintrc.json:16`.

Copy in the same PR: `app/mcp/page.tsx:34-35` loses the `npx` block, and `:114` reads `streamable http` without `stdio`. `app/changelog/entries.json:176` is generated from commit history and stays.

No behavior changes. This is a rename.

## PR 2: the store

### Interface

`lib/links/store.ts` holds the interface and the 30-day constant, nothing else.

```ts
export interface StoredLink {
  fragment: string;
  expiresAt: number;
}

export interface LinkStore {
  put(fragment: string): Promise<{ id: string; expiresAt: number }>;
  get(id: string): Promise<StoredLink | null>;
}
```

The lifetime is a constant, not a parameter. No caller wants a different one, and a per-link TTL is surface nobody asked for.

Both implementations store the same JSON value, `{ fragment, expiresAt }`. The report page needs the expiry to print "expires in 12 days", and putting it in the value means `get` answers with one call. Redis gets `EX 2592000` as well, so it reclaims the key on its own.

### Implementations

`lib/links/redis-store.ts` uses `redis` (node-redis, already in the lockfile at 4.7.1 through `mcp-handler`). Two commands: `SET id <json> EX 2592000` and `GET id`. No collision check and no retry loop. At 72 bits the first collision arrives near 2^36 stored links, so guarding it is machinery for an event that does not happen.

`lib/links/file-store.ts` keeps one JSON file at `.links-dev.json` in the repo root, added to `.gitignore`. It drops expired entries when it reads. Links survive a `next dev` module reload, so a real 30-day flow is testable locally.

`lib/links/index.ts` selects one:

- `REDIS_URL` set → Redis.
- Not set and `NODE_ENV === "production"` → throw. A deploy that forgets the variable must fail loudly, not write links into a container filesystem that the next replica cannot read.
- Otherwise → the file store.

`REDIS_URL` is the only switch. One variable cannot disagree with itself, which a separate `USE_REDIS` flag can.

### The id

9 bytes from `crypto.randomBytes`, base64url, exactly 12 characters and no padding. 72 bits. The payload carries real table names and row counts, so a guessable id leaks production data. `https://robovac.hannesmoser.at/r/AbCdEf012345` is 45 characters against roughly 1200 today.

### The route

`app/r/[id]/page.tsx` is a server component. It reads the store and hands the fragment to `ReportView`. No redirect to `/report#…`, because that puts the long URL back in the address bar and loses the point.

`ReportView` needs one untangle. It reads `window.location.hash` inside a `useEffect` (`components/report/ReportView.tsx:80`), so where the payload comes from is welded to how the report renders. It gains an optional `fragment` prop and one rule: use the hash when there is one, else use the prop.

That rule also settles the slider case for free. `ReportView.tsx:98` rewrites the URL to the tuned fragment when the reader moves a slider. On a short link that produces `/r/<id>#<fragment>`, which reloads correctly because the hash wins.

`/r/` is `noindex` with the generic card, the same treatment `/report` gets at `app/report/page.tsx:9`, and `app/robots.txt/route.ts` adds `Disallow: /r/`. The trailing slash matters: a bare `/r` is a prefix match that also covers `/report`, which hides the intent.

### Rate limit

The hosted `/mcp` is the only public write path, so the limit lands there and nowhere else. Redis `INCR rl:<ip>:<hour>` with `EX 3600`, capped at 60 writes per IP per hour. A fragment over 8 KB is rejected before the write. A normal link is about 900 bytes, so the cap only catches abuse.

The file store skips both. Development has no attacker.

### MCP result

`create_report` returns three fields:

```
url:        https://robovac.hannesmoser.at/r/AbCdEf012345
permalink:  https://robovac.hannesmoser.at/report#3.xx.yy.…
expires_at: 2026-09-03T14:22:10Z
```

`url` stays the primary field name, so an agent that reads `url` keeps working and gets the short one. The tool description states which link dies and when, otherwise an agent files the short URL somewhere permanent.

### New error state

An unknown id and an expired id are indistinguishable once Redis evicts the key. So one full-page state, not two: the short link no longer resolves. It points the reader at the permalink and at building a fresh report. It cannot say "robovac never had a copy of it", because now robovac did.

This lives in `components/report/ErrorState.tsx` next to the codec states, keyed off the route rather than a `CodecError`.

## Copy

The no-server-state promise is load-bearing in nine places. Every one is now false and gets rewritten:

| File | The claim that breaks |
| --- | --- |
| `components/home/HomeView.tsx:624` | "the paste never reaches a server" |
| `components/report/ErrorState.tsx:168` | "robovac never had a copy of it" |
| `app/mcp/page.tsx:69` | "robovac itself needs nothing: no DATABASE_URL, no env, no connection" |
| `app/mcp/page.tsx:191` | the fragment footnote, which describes one link form |
| `app/api/[transport]/route.ts:5` | "no auth, no storage" |
| `app/robots.txt/route.ts:3` | the comment, plus `Disallow: /r/` |
| `app/sitemap.xml/route.ts:5` | "fragment-only payload" |
| `docs/design-brief.md:13` | "The link contains all data (URL fragment, no server state)" |
| `docs/seo.md:11,20` | the whole fragment argument, and option (b) which this supersedes |

What stays true and stays written: robovac has no database driver, never runs your SQL, and reads no `DATABASE_URL`. Only the storage claim changes. The new line is that a short link stores the report for 30 days and the permalink stores nothing.

The report page shows "expires in N days" when it loaded from `/r/`, and shows nothing when it loaded from a fragment.

## Verification

`pnpm lint`, `pnpm test`, `pnpm build` after each PR.

PR 1 is a rename, so the existing suite passing is the whole proof. `pnpm test` must still collect the moved `report.test.ts` and `queries.test.ts` after `vitest.config.ts:9` drops the `packages/**` glob.

PR 2 adds `lib/links/store.test.ts` against the file store: put returns a 12-character id, get returns the fragment, an unknown id returns null, an expired entry returns null and leaves no row behind, and two puts of the same fragment return different ids. The Redis store stays short enough to read instead of mock.

Manual: run `pnpm dev`, call `create_report` through `/mcp`, open the short URL, move a slider, reload and confirm the tuned state survives. Delete the store file and confirm the same URL renders the expired state.
