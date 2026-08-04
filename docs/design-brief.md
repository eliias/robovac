# robovac

Design brief. A web app that explains and tunes Postgres vacuum settings.

## tl;dr

One report page carries the product. It explains the vacuum state of one table, lets you drag sliders, and shows the impact live. Every vacuum term links to an explain page w/ an interactive demo, so the tool doubles as a course. Monochrome, one typeface, modern, quietly nerdy.

## What

Postgres removes dead rows with a process called vacuum. The settings that control it are cryptic, and most teams run bad defaults until a table falls over. robovac takes a statistics snapshot of one table and shows three things: what the current settings do, what values fit this workload, and what changes when you move them.

An agent creates a link through our MCP server. The short form is an id that resolves for 30 days. The permalink form contains all data in the URL fragment and never expires. The person opens either one and sees the report. No login, no account. The URL is the product.

## Audience

Infra engineers and DBAs. They read Grafana all day and distrust magic. Numbers must be exact: "3.1M dead tuples", "~14 GB", "vacuum ran 6 days ago". No rounded marketing numbers, no vague words like "often" or "large".

## Surfaces

1. Report page (the product)
2. Explain pages (the learning layer)
3. Landing page (what robovac is, how to add the MCP, one demo link)
4. Empty and error states (bad link, truncated data)

Report page anatomy, top to bottom:

- **Header**: table name, database, snapshot time, size, and a one-line verdict ("autovacuum fires ~40x too rarely for this write rate").
- **Explanation**: short prose that reads the snapshot for you. Tone of a good runbook, not a blog post. 4-6 sentences.
- **Controls**: sliders for ~12 settings in three groups: trigger, cost, freeze. Each slider shows three markers: current value, proposed value, Postgres default.
- **Charts**: dead-tuple growth with vacuum trigger points, freeze horizon timeline (XID age vs the wraparound limit), estimated I/O cost. Charts react to the sliders immediately.
- **Auto-optimize**: one button that sets all sliders to the computed values.
- **Output**: a copyable SQL block (`ALTER TABLE … SET (…)`) that always mirrors the sliders.

## Explain pages (the learning layer)

Every vacuum term in the product is a link: `xmin`, `xmax`, freeze, aggressive vacuum, wraparound, `autovacuum_freeze_max_age`, and every other setting or concept we show. The link opens an explain page at a stable URL (`/explain/xmin`). The report page must make these links visible but quiet: readable as prose first, discoverable as links second.

One explain page has:

- **Definition**: 2-4 sentences in plain language. What the term is, why it exists.
- **Interactive demo** (when it makes sense): a small simulation w/ one or two controls. Example: drag `autovacuum_freeze_max_age` and watch the XID age race toward the wraparound limit. Example: write rows into a toy table and watch dead tuples and bloat grow until vacuum fires. The demo shows the effect on the thing people care about: dead rows, bloat, I/O, CPU, WAL.
- **See also**: links to related terms, so people can walk the graph.

The demos reuse the report-page chart style. One visual system, two zoom levels: the report shows your table, the explain page shows a toy table.

## Visual direction

- Strictly monochrome. Shades, weight, and texture create the hierarchy, not hue. If one accent or one warning tone turns out to be necessary (wraparound danger), propose it, but the default answer is no.
- One typeface family for everything: prose, numbers, code. It needs tabular numerals and must stay readable at small data sizes.
- The design language of the best modern developer tools as the reference: density, restraint, crisp 1px borders, subtle depth, a fast feel. Do not copy any brand.
- A quietly nerdy tone: footnotes, precise figures, small technical diagrams, a spec-sheet look. The page may be quietly funny in copy, never in decoration.
- Dark and light theme, dark first.

## Deliverables

- Type scale and spacing system.
- Report page, desktop first, readable on mobile.
- Component set: slider w/ three markers, stat block, chart frame, code block, button, footnote, term link.
- Chart style guide: axis, grid, annotations, hover states.
- Explain page template: definition, demo frame, "see also" list.
- Landing page.
