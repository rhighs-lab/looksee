# looksee brand pack

Every file here derives from one source: a raster of the mark supplied by the project
owner (`ChatGPT Image Sep 4, 2026, 03_03_19 PM.png`, 1254×1254). No tracer was
available, so the glyph was **redrawn as vector** from measurements taken off that
raster — brace bounding boxes, stroke width, bar length and thickness, dot radius — and
the colors were sampled from it directly. The redrawn SVG masters are the source of
every PNG in the pack; no PNG was hand-authored.

This pack is glyph-only. There is no wordmark and no lockup: that was a deliberate
choice, not a gap.

## Colors

| Role | Hex | RGB | Use | Provenance |
| --- | --- | --- | --- | --- |
| Removed (left brace) | `#FD5F4E` | 253, 95, 78 | Left brace in the color mark | observed — sampled from source raster |
| Added (right brace) | `#4ACD78` | 74, 205, 120 | Right brace in the color mark | observed — sampled from source raster |
| Accent (bar + dot) | `#0046FC` | 0, 70, 252 | The review axis through the middle | observed — sampled from source raster |
| Ink | `#1F2328` | 31, 35, 40 | Monochrome mark on light surfaces | inferred — the app's `--fgColor-default` fallback, 0.9 |
| White | `#FFFFFF` | 255, 255, 255 | Monochrome mark on dark surfaces | observed — universal |
| Ground (dark) | `#000000` | 0, 0, 0 | The dark canvas for icons and social | observed — source raster ground |

The three mark colors are the product's own semantics: red is a deletion, green is an
addition, blue is the comment you leave between them.

## Which file to use

- **Light surface, full color** — `logo/svg/looksee-glyph-color.svg`
- **Dark surface, full color** — same file; the mark has no ground and reads on both
- **One-color on light** — `logo/svg/looksee-glyph-ink.svg`
- **One-color on dark** — `logo/svg/looksee-glyph-white.svg`
- **One-color, brand blue** — `logo/svg/looksee-glyph-primary.svg`
- **App icon with a ground** — `logo/svg/looksee-icon-dark.svg` (or `-light`)
- **Browser tab** — `favicon/icon.svg`, with `favicon/favicon.ico` as the fallback
- **README / docs hero** — `../../assets/icon.png` (640×640, exported from the color master)

## Construction

The mark is drawn on a 256 grid. Both braces are stroked paths with round caps and
joins; the bar is a stroked line with round caps; the dot is a circle. Nothing is a
filled outline, so the mark scales without hinting artifacts.

```
viewBox            0 0 256 256
brace stroke       22
bar stroke         7.1
dot radius         17.4
brace centerline   x 63 → 101 (left), 155 → 193 (right); y 70 → 185
bar centerline     x 88.75 → 167.25 at y 128
glyph masters      mark scaled ×1.329 about center — fills ~80% of the square
icon masters       mark at ×1.0 — the source raster's own ~60% framing
maskable icons     mark at ×0.82 — inside the W3C 80% safe zone
```

**Clearspace**: keep the glyph's own stroke width (22 units, ~8.6% of the square) clear
on all sides.

**Minimum sizes**: 16px for the color mark on a plain ground (verified legible in the
`.ico`); 24px for the monochrome marks, whose braces lose their color separation sooner.

## Directory map

```
design/brand/
  README.md
  logo/
    svg/    6 masters  — glyph × {color, ink, white, primary}, icon × {dark, light}
    png/   30 exports  — glyph at h32/64/128/256/512/1024 × 4 colorways,
                         icon at h256/512/1024 × 2 grounds
  favicon/  8 files    — favicon.ico (16+32+48), icon.svg, apple-touch-icon.png,
                         icon-{192,512}.png, icon-maskable-{192,512}.png,
                         site.webmanifest
  social/  12 files    — og, avatar, banner-x, banner-linkedin
                         × {default (light), -ink, -dark}
```

## Live copies

Wired into the app on generation:

| Pack file | Live path |
| --- | --- |
| `favicon/favicon.ico` | `src/client/public/favicon.ico` |
| `favicon/icon.svg` | `src/client/public/icon.svg` |
| `favicon/apple-touch-icon.png` | `src/client/public/apple-touch-icon.png` |
| `favicon/icon-{192,512}.png` | `src/client/public/icon-{192,512}.png` |
| `favicon/icon-maskable-{192,512}.png` | `src/client/public/icon-maskable-{192,512}.png` |
| `favicon/site.webmanifest` | `src/client/public/site.webmanifest` |
| `logo/png/` color master @640 | `assets/icon.png` (README hero) |

`vite.config.ts` now sets `publicDir: 'public'` so these ship with the build, and
`src/client/index.html` links them. `src/server/app.ts` gained `.png`, `.ico`,
`.webmanifest` and `.json` MIME entries so the production server serves them correctly.

## Provenance

| Input | Source | Resolution | Follow-up to harden |
| --- | --- | --- | --- |
| Product name | `package.json`, repo | observed | — |
| Glyph geometry | source raster, measured | **inferred** (redrawn, 0.9) | none needed unless the original vector exists somewhere |
| Red / green / blue | source raster, pixel-sampled | observed | promote into `tokens.json` via a `soul-design` session |
| Ink | app CSS fallback `--fgColor-default` | **inferred** (0.9) | a `tokens.json` entry would freeze it |
| Dark ground | source raster | observed | — |
| Wordmark | — | **absent by choice** | a lockup pack can be added later if the product wants one |
| Lockup metrics | — | not applicable (glyph-only) | — |
| Favicon target | vite `publicDir` | observed, user-confirmed | — |

## Gaps and next steps

- **No `tokens.json` and no `soul.md` in this repo.** Every value above lives only in
  this README. Run a `soul-design` session to canonize the palette and the signature
  device; this pack then becomes a rendering of those files rather than the record.
- **The glyph master is a redraw, not the original vector.** It matches the raster's
  measured proportions, but if a true vector of the mark exists, supplying it and
  regenerating would remove the only `inferred` geometry in the pack.
- **The mark's colors are close to, but not identical to, the app's Primer diff
  colors** (`#1a7f37` / `#d1242f` are what the UI uses today). Nothing is broken by
  that — brand and UI palettes are allowed to differ — but a decision about whether
  they should converge is worth making explicitly.
- **No wordmark.** The social cards are therefore glyph-only, with no product name in
  them. If shared links need the name visible, that is a wordmark decision, and it
  belongs in a `soul-design` session before this pack renders it.

## Notes

- Rasterization: headless Chrome (`--headless=new`, device scale 1) from the SVG
  masters. `.ico` assembly: ImageMagick.
- The SVG masters are self-contained — no external fonts, no linked assets, no scripts.
- The glyph was inspected at 900px before the pack was generated; the bar's round caps
  clear both brace waists, and the bar-to-dot union has no seam.
