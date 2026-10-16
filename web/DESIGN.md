# Motion Studio — Interface Design Spec

**Direction: post-production instrument.** The app should feel like a piece of gear made by motion designers — the
edit page of a finishing suite, a broadcast monitor, a Teenage Engineering panel — not a chat product. Everything
on screen is either *the film* or *a precise readout about the film*.

## Principles

1. **The film is the only colorful thing.** The chrome is warm black and bone. Color comes from the user's
   scenes (timeline clips use each scene's real background), thumbnails and the one signal color.
2. **One signal: Tally.** `#FF3D1F` means *live / recording / primary action*. Play while playing, the playhead
   head, render in progress, the Approve and Create buttons. If two Tally things compete on a screen, one is wrong.
3. **Numbers are instruments.** Every number is mono, tabular, and as precise as the medium: timecodes
   `HH:MM:SS:FF`, frame counters, `1080×1920`, `14.2s`. Values that change tick (odometer), never jump.
4. **Labels are engraved.** Small uppercase mono with `+0.06em` tracking, Ash on Panel — like silk-screen on a deck.
5. **Hairlines, not boxes.** 1px Line rules divide space. No drop shadows on panels, no glows, no glass, no gradients
   on chrome. Radius 2px (controls) / 4px (cards) / 6px (dialogs) max.
6. **Editorial restraint.** Instrument Serif italic appears in at most one place per screen (hero line, project
   title on a card, empty-state line). It is the human voice; mono is the machine voice; Geist is the interface.
7. **Practice what we preach.** UI motion uses the engine's curves and reveals by wiping (clip-path), not fading.

## Tokens (`styles.css :root`)

| Token | Value | Use |
|---|---|---|
| `--ink` | `#0D0D0B` | app background, viewer surround |
| `--panel` | `#151512` | panes, cards |
| `--raised` | `#1C1C18` | inputs, hovered rows, buttons |
| `--line` | `#2A2925` | every hairline |
| `--line-2` | `#3A3833` | hover/strong hairline |
| `--bone` | `#ECE8DF` | primary text, focus outline, selected outline |
| `--ash` | `#8E897D` | secondary text, labels |
| `--smoke` | `#56534B` | tertiary, disabled, ruler minor ticks |
| `--tally` | `#FF3D1F` | signal (see above) |
| `--tally-ink` | `#1A0703` | text on Tally |
| `--ok` | `#8BD17C` | success, valid |
| `--warn` | `#F2C14E` | warnings, craft notes |

Spacing: 4px base — `--s1` 4 · `--s2` 8 · `--s3` 12 · `--s4` 16 · `--s5` 24 · `--s6` 32 · `--s7` 48 · `--s8` 64.
Control heights: 24 (xs) · 28 (sm) · 32 (default) · 40 (lg).

## Type

- **Geist** 13px/1.45 base, weights 400/500/600. Tight tracking (-0.005em) for UI; -0.02em for headings.
- **Geist Mono** for numbers, timecodes, IDs, sizes, durations, and all labels (`.label`: 10.5px, 500, uppercase,
  +0.06em). `font-variant-numeric: tabular-nums` globally on mono.
- **Instrument Serif** italic for editorial moments only.

| Role | Spec |
|---|---|
| Display (hero) | Instrument Serif italic 64/0.95 |
| H1 page | Geist 600 28/1.1, -0.025em |
| H2 section | Geist 600 15/1.3 |
| Body | Geist 400 13/1.45 |
| Small | Geist 400 12/1.4 |
| Label | Geist Mono 500 10.5/1 uppercase +0.06em |
| Readout | Geist Mono 500 12–13, tabular |
| Big timecode | Geist Mono 500 18, tabular |

## Components

- **AppBar** (44px): wordmark `MOTION/STUDIO` in mono, breadcrumbs, right-side readouts (mode, user). Hairline bottom.
- **Button**: `btn` raised + hairline; `btn primary` Tally fill, Ink text; `btn ghost`; `btn danger` (Tally outline).
  Square-ish (2px radius). Focus: 1px Bone outline offset 2px.
- **Readout**: label over mono value, used in grids separated by hairlines (like a hardware status strip).
- **Slate**: diagonal clapper stripes (`--slate` repeating gradient, Bone/Ink 45°) used as the top band of empty
  states, loading, the offline panel and the consent card.
- **Crop marks**: L-shaped hairline corner registration marks outside the viewer frame.
- **Safe zones**: hairline overlays — title-safe/action-safe (90%/80%) and 9:16 platform UI zones (TikTok, Reels,
  Shorts) drawn as dashed boxes with mono labels.
- **Tally dot**: 6px square-ish red dot, blinks (1s steps) while live.
- **Contact strip**: frames in a row on Ink with sprocket perforations top and bottom; frame number under each.
- **Odometer**: digits roll vertically on change (expoOut, 320ms).
- **Table**: hairline rows, mono columns right-aligned, label header row.
- **Fields**: no default controls — custom select (listbox), segmented, inputs with a hairline that turns Bone on focus.

## Motion

| Token | Curve | Use |
|---|---|---|
| `--expo-out` | `cubic-bezier(0.19,1,0.22,1)` | entrances, reveals |
| `--snap` | `cubic-bezier(0.15,0,0.1,1)` | toggles, playhead, tabs |
| `--m3-exit` | `cubic-bezier(0.3,0,0.8,0.15)` | exits |

Durations 120 (hover) · 200 (toggle) · 320 (reveal). Reveals: `clip-path: inset()` wipes (`.wipe-in`) and staggered
4–8px rises (`.rise`, `--i` index × 40ms). Never fade-only. `prefers-reduced-motion`: all transitions/animations
collapse to ≤1ms, the hero player pauses on its poster frame.

## Iconography

16px grid, 1.5px stroke, square caps and miter joins, no fills except transport glyphs. Drawn in `components/Icons.tsx`.

## Screens

- `/login`, `/signup`: 5/7 split — Swiss form left (big index numbers, hairline fields), live engine hero right.
- `/`: hero strip (live Player of `hero-spec.ts`) + reel wall of project cards (live `Thumbnail`, hover-scrub by x).
- `/p/:id`: Director (script) · Viewer (crop marks, safe zones, deck transport) · Inspector; NLE timeline below.
- `/account`: Profile · Director settings · API tokens · Connect to Claude · Render queue (left index nav).
- `/connect/authorize`: consent card with slate band; Approve (Tally) / Deny.
