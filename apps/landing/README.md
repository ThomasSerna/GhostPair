# GhostPair landing

The public website is a React + Vite workspace. Its production build is committed to `docs/` for the existing GitHub Pages deployment.

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

The mode illustration separates guest input from the host’s shared page. Visual only shows passive text, checkbox and button overlays on the host without changing original values or saving. Each demo preview expires one second after its latest action; typing and choices have independent timers. The small duration note labels this as the demo timing: the extension supports configurable text/choice lifetimes, with persistent previews by default. Guest inputs return to the host’s original values when their previews expire.

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
