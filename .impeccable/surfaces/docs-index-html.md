---
version: 1
slug: "docs-index-html"
primary_target: "docs/index.html"
related_targets: ["apps/landing/src/App.tsx","apps/landing/src/styles.css","apps/landing/src/components/hero/HeroScene.tsx"]
---

# GhostPair connection experience

Target: React/Vite source in `apps/landing/`, built to `docs/index.html` and `docs/assets/landing/` for the existing GitHub Pages deployment.
Mode: Persuade. Build path: code, recorded in project configuration.
Audience: people collaborating in two Chrome/Edge browsers on Windows.
Action: download the correct extension release and install it in both browsers.
Proof: unchanged extension HTML exports and a clearly labeled interaction-mode illustration.
Constraints: preserve the linked-loop identity, forest/mint palette, product truth, release destinations, exported previews, and extension implementation. User delegates the experimental redesign and asks for GSAP, responsive behavior, and a future Three/R3F hero seam.

## Direction contract

THESIS: Two independent points of view become one shared space. An interlinked signal sculpture demonstrates connection immediately; the product interface then makes it concrete.

OWN-WORLD: Deep forest ground, pale mint lettering, tightly threaded spatial loops, generous asymmetric type, fine technical diagram lines, and quiet green interface fields. Self-hosted Manrope expands the established identity; authentic extension lettering remains unchanged.

STORY: See two browsers connect, understand local host approval, inspect the actual extension, try the difference between preview and live edits, then install in both browsers.

FIRST VIEWPORT: A lean brand/navigation row. A large two-line “Browse together.” headline and download action occupy the left; a luminous interlinked ribbon sculpture fills the right. Mobile keeps the offer and action before a shorter full-width sculpture. The former introductory status strip and pause control have been removed at the user's request.

FORM: Grounded direction 3, paired signal instrument, seed `df53420a`. Alternatives considered: shared-browser stage, correspondence spread, paired signal instrument, optical bench, collaborative annotation sheet, transit connection map, kinetic identity poster. Challenger disciplines retained: print registration as ordered arrival; wrap seams as continuity between sections; archive labels as explicit example states; chromatophore response as input feedback; cracktro depth as restrained motion; step-row chase as the connection sequence. Their literal materials do not improve product clarity or preserve the pinned identity. Signature interaction: GSAP traces Host → GhostPair → Guest as the visitor scrolls, completing earlier with brighter mint symbols. The original hero sculpture plays as an automatic prerendered 42s loop, with responsive media, matching static posters and automatic offscreen suspension. Visual only clicks in the guest illustration use the original extension halo. Native scrolling and keyboard controls remain intact.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Verification and completion

Completed against the production build:

- Root typecheck and build passed. All 149 unit/release tests passed with a single Vitest worker after a Windows IPC failure in the parallel run.
- Browser checks at 320, 375, 390, 768, and 1440px passed: native keyboard focus, navigation and Escape behavior, all three preview selections and full-size links, iframe scaling, mode illustration typing/checkbox synchronization and reset, pause/reduced motion, native scrolling, relative-base loading, and self-hosted fonts. No horizontal overflow or browser errors were observed.
- Production JavaScript totals 114.8 KiB gzip. The design detector returned `[]`.
- Desktop, tablet, mobile, and complete hero captures are saved in `.impeccable/review/`: `desktop.png`, `tablet.png`, `mobile.png`, `desktop-hero.png`, and `mobile-hero.png`.
- The existing favicon's pixel artwork is unchanged. Its embedded provenance was recorded, and the shipping-raster provenance scan found zero missing records.
- Fresh independent finish review returned **ship**, with no material fixes requested. `DESIGN.md` now records the built tokens and components; `.impeccable/design.json` contains their schemaVersion 2 metadata and component snippets.

These results cover the website build and browser checks. They do not establish Safari support, accessibility conformance, or an actual paired network session.

### Motion and illustration update, 2026-10-02

- Root typecheck/build, 141 unit tests (Windows thread pool), and 8 release tests passed. Landing browser checks and final confirmation passed at all five existing widths, including native video looping, visibility suspension, static fallbacks, reduced motion, earlier/brighter connection completion, click/tap/keyboard halos, Save plans and reset. The extension source and its exported interfaces remain unchanged.
- Original sculpture geometry was prerendered into desktop/mobile 42-second, 30fps H.264 loops and matching lossless posters. First and period-boundary source frames match exactly. Poster provenance is retained in source sidecars and emitted beside hashed production media; the production scan found zero missing records.
- Desktop/mobile captures were refreshed in `.impeccable/review/`; independent finish review returned **ship**, with no material fixes.
- Three eight-second samples per viewport in headless Chrome 154, DPR 1: scripting fell 96.2% on desktop and 95.9% on mobile; main-thread work fell 24.2% and 41.4%. Page frame opportunities reached approximately 60fps. JavaScript is 113.5 KiB gzip and contains no procedural hero renderer. The videos add 5.02 MiB desktop or 2.11 MiB mobile to downloads. These are page main-thread measurements, not whole-PC CPU/GPU or physical-device guarantees. Reproduction and the full comparison are recorded in `apps/landing/README.md`.
