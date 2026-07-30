# robovac — brand assets

Status in this repo: the kit lives in `public/brand/` and the `<head>` wiring sits in `app/layout.tsx` (Next metadata API). The missing `<style>` block in `favicon.svg` was restored, so the light-scheme inversion works. The wordmark ships as pre-rendered PNGs for the README (`docs/assets/wordmark-{light,dark}.png`, rastered from `wordmark.svg` with IBM Plex Mono SemiBold); the SVG itself still contains live text, so embed the PNGs on machines without the font.

Everything in `brand/` is generated from one piece of geometry. Nothing is hand-drawn, so any size, format or variant you still need can be regenerated exactly rather than traced.

## The mark

A heap page with its far corner reclaimed. A 4×4 grid; every cell where `row + col <= 3` is filled, the other six are absent — the missing cells fall away on the anti-diagonal, the same shape as the sawtooth every chart in the product draws.

Geometry, in grid units: **cell 18, pitch 26** (gap 8), so the full mark is 96 × 96 units. That ratio is the whole spec — scale it, never redraw it.

```js
const filled = [];
for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if (r + c <= 3) filled.push([r, c]); // 10 cells
// each cell: x = c * 26, y = r * 26, w = h = 18   (viewBox 0 0 96 96)
```

**Colour:** `#ededf0` on `#08080a`, or the exact inverse. Never the product's warning tone (`oklch(0.70 0.10 62)`), never a gradient, never an outline version, never a container shape that is not an icon-platform requirement.

**Wordmark:** IBM Plex Mono 600, lowercase, `letter-spacing: -0.01em`, cap height matched to the mark × 0.82, gap between mark and word = one cell pitch. It is typed, not drawn.

**Clear space:** one cell pitch (26 units at mark scale) on every side. Below 16px, drop the wordmark and use the mark alone.

## Files

| File                         | Size       | Purpose                                                                                                              |
| ---------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------- |
| `favicon.ico`                | 16, 32, 48 | Legacy browsers, bookmark bars. Each size is pixel-snapped (cell/gap 3/1, 6/2, 9/3) so no edge lands on a half pixel |
| `favicon.svg`                | vector     | Modern browsers. Contains a `prefers-color-scheme` rule and inverts under a light system theme                       |
| `favicon-16/32/48/96.png`    | 16–96      | Explicit PNG fallbacks where an SVG icon is not accepted                                                             |
| `apple-touch-icon.png`       | 180        | iOS home screen. Opaque background, 20% inset — iOS applies its own corner mask, so do not pre-round it              |
| `android-chrome-192.png`     | 192        | Android home screen, PWA install prompt                                                                              |
| `android-chrome-512.png`     | 512        | Splash screen, store-grade listing                                                                                   |
| `maskable-512.png`           | 512        | Adaptive icon. Mark sits inside the 27% safe zone; no platform crop reaches it                                       |
| `mstile-150.png`             | 150        | Pinned Windows tile                                                                                                  |
| `mark.svg` / `mark-dark.svg` | vector     | The mark alone, light and dark, for documents and slides                                                             |
| `wordmark.svg`               | vector     | Mark + wordmark lockup                                                                                               |
| `mark-512-light/dark.png`    | 512        | Raster mark on transparency, for README headers and decks                                                            |
| `og-image.png`               | 1200×630   | Open Graph / Twitter card                                                                                            |
| `site.webmanifest`           | —          | PWA manifest; `theme_color` and `background_color` both `#08080a`                                                    |

## `<head>`

```html
<link rel="icon" href="/brand/favicon.ico" sizes="32x32" />
<link rel="icon" href="/brand/favicon.svg" type="image/svg+xml" />
<link rel="apple-touch-icon" href="/brand/apple-touch-icon.png" />
<link rel="manifest" href="/brand/site.webmanifest" />
<meta name="theme-color" content="#08080a" />
<meta name="msapplication-TileColor" content="#08080a" />
<meta name="msapplication-TileImage" content="/brand/mstile-150.png" />
<meta property="og:image" content="/brand/og-image.png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
```

## Before you roll this out

These files were produced in a browser canvas. They are correct but not optimised, and two of them need a step I could not perform here.

**1. Outline the text in `wordmark.svg`.** It currently ships a live `<text>` element with `font-family: IBM Plex Mono`. On any machine without that font it renders in a fallback and the lockup is wrong. Convert to paths before shipping:

```bash
# Inkscape
inkscape wordmark.svg --export-text-to-path --export-plain-svg -o wordmark-outlined.svg
# or, if you already build with it
npx svgo --config=svgo.config.js wordmark-outlined.svg
```

The mark rects need no conversion — they are geometry already.

**2. Optimise the PNGs.** They are uncompressed canvas output, ~2–6× larger than they need to be. The mark is flat two-colour art, so palette quantisation is lossless in practice:

```bash
# lossless recompression, keeps 32-bit
oxipng -o 4 --strip safe brand/*.png
# or palette-reduce first (these images have 2 colours)
pngquant --quality=100 --speed 1 --ext .png --force brand/*.png && oxipng -o 4 brand/*.png
```

Do **not** run `pngquant` on `og-image.png` without checking it — it contains antialiased type and the warning tone, so verify it visually or leave it to `oxipng` alone.

**3. Minify the SVGs.**

```bash
npx svgo --multipass brand/*.svg
```

Keep the `<style>` block and the `prefers-color-scheme` media query in `favicon.svg` — some SVGO presets inline styles and drop it. Verify the icon still inverts on a light system theme afterwards.

**4. Add the sizes I could not raster.** If you need macOS `.icns`, a Safari pinned-tab mask, or Play Store artwork, generate them from `mark.svg` rather than upscaling a PNG:

```bash
# Safari pinned tab: single-colour, no background, path-only
# (take mark.svg, set fill to black, remove any background rect)
<link rel="mask-icon" href="/brand/safari-pinned-tab.svg" color="#08080a">
```

**5. Serve them right.** Immutable cache headers on everything in `/brand` except `og-image.png`, which social scrapers re-fetch; give that one a shorter TTL or a content hash in the filename when the copy changes.

**6. Check the two things that break silently.** The 16px favicon against a light browser chrome (the SVG handles it; the ICO does not — that is expected, the ICO is dark-only by design), and the maskable icon in Android's circle and squircle crops.

## Regenerating

Every raster in this folder came from the same function: fill the ten cells, at cell/pitch 18/26, inset by a per-target amount (favicons pixel-snapped; apple-touch 20%; android 15%; maskable 27%; mstile 18%). If you need a size that is not here, use that rule rather than resampling an existing PNG — the mark has hard edges and resampling will soften them.
