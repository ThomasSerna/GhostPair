# GhostPair landing

The public website is a React + Vite workspace. Its production build is committed to `docs/` for the existing GitHub Pages deployment.

## Installation and Explore

The header opens two additional English screens without replacing the home page:

- `?view=installation` is a chapter-based guide to loading Chrome/Edge release ZIPs, connection settings, a first session, Docker/VPS self-hosting, updates and troubleshooting. Each chapter contains a local interactive scene with manual controls and reset. `?view=installation#self-hosting` opens the hosting chapter directly.
- `?view=explore` is a local host/guest laboratory. It opens connected in **Preview changes**, offers reproducible chapters and free exploration, and keeps host and guest perspectives synchronized. Mobile users switch perspectives without losing the session state.

These are ordinary links on the same static entry, so refreshing, Back/Forward, opening another tab and the GitHub Pages `/GhostPair/` base work without a server rewrite. Unknown `view` values show the home page. The original `#main`, `#how-it-works`, `#preview` and `#install` destinations remain available. Each screen is lazy-loaded; home motion and hero media only mount on the home page.

The laboratory separates sample-page values from presentation previews. Text and other previews have independent lifetimes, defaulting to 0.5 seconds; the host can choose **Until cleared**. **Full control** edits the example page, while navigation, scroll and tab management act in both modes. New tabs require host approval, and only the active approved tab is visible. Clipboard examples use two synthetic text buffers; both participants must enable sharing, only new copies synchronize, and pause suspends synchronization. Demonstration state stays in the page and resets on reload or **Reset demo**.

No demonstration starts signaling/WebRTC, loads visitor-entered websites, reads the real clipboard, or requests capture permissions. Guide **Copy** buttons write only after an explicit click and offer selectable text when clipboard writing is unavailable. Permission prompts and server checks are labeled examples. The self-hosting guide prepares commands for the existing SQLite/Caddy/STUN Compose configuration; it does not execute them. Custom server settings work in the release ZIPs without rebuilding the extension. There is no TURN relay.

`scripts/inspect-website-pages.mjs` extends the existing landing browser inspection with query navigation, accessibility, local-capability/network guards, installation tasks and simulator behavior. It captures both new screens at desktop/mobile sizes. The existing aggregate **150 KiB gzip** budget includes every generated JavaScript chunk, including lazy screens.

## Work locally

From the repository root:

```sh
npm install
npm run dev:landing
npm run typecheck
npm run build:landing
npm run preview:landing
npm run test:landing
```

The dev server binds to localhost. Vite prints the address. The site inspection runs against the built `docs/` site under `/GhostPair/`; build before running it. Root `npm run build` also builds the landing after the extension and server workspaces.

## Publishing

Edit source files in this workspace, then run `npm run build:landing`. Review and commit both source and generated `docs/index.html` / `docs/assets/landing/` files. Relative asset URLs support the GitHub Pages project path and a local static server. The existing Pages configuration can continue serving `main` / `docs`.

The build only replaces `docs/index.html` and clears the generated `docs/assets/landing/` directory. It preserves `.nojekyll`, privacy, release notes, documentation and product preview exports. Old content-hashed assets are removed from the dedicated landing directory on each build.

## Product examples

The exported interfaces in `docs/assets/previews/` are the source of truth for product demonstrations. Keep their contents unchanged during website design work. The Vite dev middleware serves a fixed allowlist from `docs/`; it does not duplicate these files into the app. `scripts/export-previews.mjs` remains the separate workflow for refreshing exports from the actual extension.

## Hero media

`src/components/hero/HeroScene.tsx` plays an inline, muted H.264 loop instead of calculating the sculpture on the visitor's main thread. It selects the mobile asset at 700px, pauses outside the viewport or in a hidden tab, and resumes when visible. Matching WebP artwork appears during loading, when playback fails or is blocked, and with reduced motion. Initial reduced motion downloads no video. The hero's DOM entrance and parallax remain in GSAP; pointer and scroll no longer rotate the geometry.

The original geometry lives in `scripts/landing-signal-renderer.ts`, outside the visitor's import graph. Regenerate media from the repository root with:

```sh
npm run render:landing-hero
```

This requires FFmpeg on PATH (or `GHOSTPAIR_FFMPEG` pointing to its executable) and Playwright Chromium, Chrome or Edge. The generator produces desktop 1280×1080 and mobile 720×608 videos at 30 fps for exactly 42 seconds, without audio, plus lossless WebP posters. Geometry and three filament revolutions share the same period; the generator verifies the first frame against the loop boundary. Committed assets in `src/assets/hero/` are imported and emitted with relative hashed URLs by Vite. Normal builds and CI do not require FFmpeg or regenerate these media.

## Interaction illustration and performance checks

The product-example selector uses its original mint selected-label feedback with native radio controls. The gallery transition remains unchanged and respects reduced motion.

The mode illustration separates guest input from the host’s shared page. Visual only shows passive text, checkbox and button overlays on the host without changing original values or saving. Each demo preview expires one second after its latest action; typing and choices have independent timers. The small duration note labels this as the demo timing: the extension defaults text/other previews to 0.5 seconds, configurable from 0.1 to 10 seconds or **Until cleared**. Guest inputs return to the host’s original values when their previews expire.

Live control applies subsequent field edits to the host and Save plans confirms in both panels. Click halos originate on the host in both modes; Visual only checkbox choices use their own marker. The demo extends transient button/click feedback to one second to make it legible, while the extension’s own button and halo timings remain unchanged. In a real session the guest receives the host’s captured page, including visible overlays; the guest card here represents input, rather than a separate video rendering. Switching modes discards pending previews; reset clears fields, confirmations and click effects. Reduced motion retains static click feedback.

`npm run test:landing` verifies five viewport widths, keyboard/touch interaction, video lifetime and poster fallbacks, earlier connection completion, authentic examples, and relative asset loading. It also saves stable desktop/mobile review captures using reduced motion.

For a repeatable local before/after comparison, run `npm run benchmark:landing -- --label baseline` before rebuilding and `npm run benchmark:landing -- --label optimized --require-video` afterward, with other browser/encoding work stopped. Reports go to the ignored `.impeccable/review/` folder. Three eight-second samples per viewport measure scripting, main-thread work, frame intervals, transfer sizes and video playback. They measure headless Chromium's page main thread, not whole-PC CPU or GPU decoding.

### Verified results, 2026-10-02

The root typecheck/build passed, along with 141 unit tests and 8 release tests. On this Windows host, the existing forked Vitest runner hit an IPC channel error; the same 141 tests passed with `--pool=threads --maxWorkers=1 --minWorkers=1`. Landing browser QA passed at 320, 375, 390, 768 and 1440px, including native looping, offscreen/hidden-tab suspension, missing/blocked media fallbacks, reduced motion, keyboard/touch effects, saving and reset. An independent visual review found no material defects.

Chrome 154, headless, DPR 1, three eight-second samples per viewport; medians:

| Metric | Desktop before → after | Mobile before → after |
| --- | --- | --- |
| Scripting | 1353.4 → 51.1 ms (−96.2%) | 1303.8 → 53.2 ms (−95.9%) |
| Main-thread work | 2179.5 → 1651.6 ms (−24.2%) | 2457.6 → 1439.1 ms (−41.4%) |
| Page frame opportunities | 30.86 → 60.08 fps | 51.93 → 60.04 fps |
| p95 frame interval | 50.2 → 17.4 ms | 33.3 → 17.5 ms |
| Video download | 0 → 5.02 MiB | 0 → 2.11 MiB |

Each video sample advanced about 8.04 seconds with 241 total frames. Desktop dropped no frames; mobile dropped 2, 0 and 0 across its three samples. Production JavaScript decreased from 117,568 to 116,246 gzip bytes, and the procedural renderer is absent from the visitor bundle. Videos increase the initial download: 5,260,766 bytes for desktop or 2,210,481 for mobile, plus the matching poster. Results do not establish whole-PC CPU, GPU, battery usage, or performance on physical mobile hardware.

Fonts are self-hosted through `@fontsource-variable/manrope`; the browser does not need a third-party font request. The extension and its exported interface examples keep their existing typography.
