// Generates the per-term social cards from scripts/og/card-template.html.
// Output is committed: run this when a term is added or a blurb changes.
//
//   pnpm dlx playwright install chromium   (once)
//   node scripts/generate-og-cards.mjs
//
// Rendering happens in a real Chromium via the playwright CLI, so the cards
// use real IBM Plex from Google Fonts (network required).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TERMS } from "../lib/terms.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const template = readFileSync(join(root, "scripts/og/card-template.html"), "utf8");
const mark = readFileSync(join(root, "public/brand/mark-512-light.png"));
const markDataUri = `data:image/png;base64,${mark.toString("base64")}`;

const outDir = join(root, "public/brand/og");
mkdirSync(outDir, { recursive: true });
const workDir = join(tmpdir(), "robovac-og");
mkdirSync(workDir, { recursive: true });

for (const term of TERMS.filter((t) => t.built)) {
  const footer = term.tag.includes("demo")
    ? "definition · interactive demo · see also"
    : "definition · see also";
  const html = template
    .replaceAll("/brand/mark-512-light.png", markDataUri)
    .replaceAll("{{KIND}}", term.kind)
    .replaceAll("{{ROUTE}}", `/explain/${term.slug}`)
    .replaceAll("{{TITLE}}", term.term)
    .replaceAll("{{BLURB}}", term.blurb)
    .replaceAll("{{FOOTER}}", footer);
  const htmlPath = join(workDir, `${term.slug}.html`);
  const outPath = join(outDir, `explain-${term.slug}.png`);
  writeFileSync(htmlPath, html);
  execFileSync(
    "pnpm",
    [
      "dlx",
      "playwright",
      "screenshot",
      "--viewport-size=1200,630",
      "--wait-for-timeout=2000",
      `file://${htmlPath}`,
      outPath,
    ],
    { stdio: "inherit" },
  );
  console.log(`wrote ${outPath}`);
}
