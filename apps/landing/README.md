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

## Hero renderer

`src/components/hero/HeroScene.tsx` owns the canvas lifecycle, visibility, pointer input and reduced-motion behavior. `src/components/hero/signal-renderer.ts` defines the `SignalRenderer` boundary: `resize`, `setProgress`, `setPointer`, `render` and `dispose`. The page passes normalized GSAP scroll progress through a React ref, so rendering does not cause a React update on each frame. GSAP owns page transitions and scroll sequencing.

This boundary allows a later Three.js implementation of the same renderer interface without rewriting page content or navigation. A React Three Fiber alternative can replace the scene component while retaining its progress and pause props. Add those dependencies only when a 3D scene is implemented; lazy-load the renderer, retain the lightweight visual fallback, respect reduced-motion preferences, and dispose renderer resources on unmount. Keep product UI and readable content in the DOM.

Fonts are self-hosted through `@fontsource-variable/manrope`; the browser does not need a third-party font request. The extension and its exported interface examples keep their existing typography.
