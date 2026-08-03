# table rewrite: one concept page, four tools

The app picks a winner. `/explain/pg_repack` calls pg_repack "the standard answer once bloat is already in the file" and files pg_squeeze under "alternatives" in the footnote. Linear runs pg_squeeze. The research chapter (`docs/research/06-bloat.md`) is already neutral, so the bias lives only in the app and in one MCP note.

## tl;dr

Replace the `pg_repack` term with `table-rewrite`, an operation, not a product. The page explains why vacuum cannot give pages back, then compares VACUUM FULL, pg_repack, pg_squeeze and pg-osc in a table. The old tool names become aliases, so `/explain/pg_repack` and `explain_term("pg_squeeze")` both land on it.

## Term entry

`lib/terms.ts` gets one optional field, `aliases?: string[]`, and the `pg_repack` entry becomes:

```
slug: "table-rewrite", term: "table rewrite", kind: "operation", tag: "page",
aliases: ["pg_repack", "pg_squeeze", "vacuum-full", "pg-osc"]
```

A new exported `findTerm(slug)` resolves a slug or an alias and replaces the four inline `TERMS.find(t => t.slug === ...)` call sites: `app/explain/[slug]/page.tsx` (metadata and page), `packages/robovac-mcp/src/tools.ts:175`, and the see-also lookup. `termHref` returns the canonical `/explain/${entry.slug}` for an alias, not the alias path.

`suggestTerms` scores aliases alongside slug and term, so a near miss on "pg_squeze" still resolves.

## Canonical URL

One URL per concept. When `findTerm` resolves through an alias, the page calls `permanentRedirect("/explain/table-rewrite")` (308, the rename is permanent). `generateStaticParams` and the sitemap keep emitting canonical slugs only, and `dynamicParams` is already true, so alias URLs are handled at request time.

## Page content

`lib/explain-content.tsx` gets a second static slot, `Panel?: ComponentType`, rendered after the definition. `Demo` keeps its "needs JavaScript" noscript notice, `Panel` gets none: a static table does not need JS, and the existing notice would be a lie. The table cannot live in `definition`, that renders inside a `<p>`.

`components/explain/RewriteTable.tsx` holds the comparison: tool, lock, what it needs, cost and risk. Four rows, no recommendation, `overflow-x: auto` for narrow screens.

The footnote carries the decision rule, stated on constraints instead of taste:

- No extension allowed and a maintenance window exists → `VACUUM FULL`.
- You can set `wal_level = logical` and restart, and you want a scheduler → `pg_squeeze`.
- You cannot restart or change `wal_level` → `pg_repack`.
- The provider blocks every extension → `pg-osc` (client-side, built for schema change, removes bloat as a side effect).

## Other pointers

- `explain-content.tsx:126`, the `bloat` see-also, points at `table-rewrite`.
- `packages/robovac-mcp/src/tools.ts:30` names all four tools in the reloptions note, not two.
- `docs/research/06-bloat.md` gains a pg-osc row, one paragraph and a source link. The page must not claim what the research chapter does not cover.
- Run `scripts/generate-og-cards.mjs`, delete `public/brand/og/explain-pg_repack.png`.

## Verification

`pnpm lint`, `pnpm test`, `pnpm build`. New cases in `lib/terms.test.ts`: `findTerm` resolves both `pg_repack` and `pg_squeeze` to `table-rewrite`, an unknown slug returns undefined, and no alias appears in the sitemap list. Manual: `/explain/pg_repack` redirects, the arcana list shows one row for the concept.
