# GhostPair Public Website

<!-- impeccable:product-schema 1 -->

## Platform

web

## Scope

- The user confirmed that design work is limited to the public website deployed on GitHub Pages. Its React/Vite source lives in `apps/landing/` and builds to `docs/index.html` and `docs/assets/landing/`.
- The browser extension must remain exactly as it is. Website redesign does not authorize changes to `apps/extension/`, shared protocol, signaling, or extension behavior.
- The extension examples in `docs/assets/previews/` represent the actual product. Preserve their interface and content; website layout around them can change.
- This record scopes website work. Durable visual decisions live in `DESIGN.md`; route strategy lives in the website surface brief.

## Users

The existing public page addresses people considering browser collaboration with another person using Chrome or Edge on Windows. Visitors need to understand the product, inspect examples, download the appropriate package, and install it in both browsers.

A narrower primary audience, such as support teams or people completing forms together, has not been confirmed.

## Product Purpose

Explain what GhostPair makes possible and help visitors start an authorized session between two browsers. The website introduces the product and provides installation guidance; sessions run inside the installed extension.

## Positioning

The implementation combines host-approved tab sharing, a default Visual only mode for previewing interactions, and optional Live control for real page interactions. Video and interactions travel directly over WebRTC, while a signaling server coordinates pairing. Describe these mechanisms accurately without claiming unique market position or universal compatibility.

## Operating Context

- The website uses React, Vite, and GSAP. Source in `apps/landing/` builds to `docs/`, with a relative Vite base and asset links suitable for the existing GitHub Pages project path. Edit the source and commit the generated website with it.
- Public website: https://thomasserna.github.io/GhostPair/.
- Download and release links point to https://github.com/ThomasSerna/GhostPair/releases. The installation instructions describe extracting the Chrome or Edge ZIP and loading it as an unpacked extension through Developer mode.
- Current website copy and installation instructions are in English. A language change has not been requested.
- The visitor can inspect three static examples: sharing a tab, connecting to a host, and the connected guest viewer. These are demonstrations with example data.
- The page explains the connection, local host approval, product examples, interaction modes, and installation in that order. A separate, labeled interaction-mode illustration lets visitors compare preview edits with live edits using example data; it does not start a session.
- GSAP sequences page transitions and the connection diagram. The lazy-loaded hero has a canvas renderer behind a `SignalRenderer` interface for resizing, progress, pointer input, rendering, and disposal. This leaves a defined seam for a future Three.js or React Three Fiber implementation.

## Capabilities and Constraints

Product facts are grounded in `README.md`, `docs/architecture.md`, and the extension implementation:

- One host and one guest participate. The host supplies a session password and authorizes each shared tab locally; the guest connects using the host address and password.
- Sharing is limited to one authorized browser window, with up to five approved tabs retained and only the active approved tab transmitted. The host can pause, withdraw control, release a tab, or end the session.
- Sessions start in **Visual only**: supported clicks, choices, and typing are previews. Scrolling, navigation, and tab management remain real. The host can switch to **Live control**.
- Clipboard text synchronization is optional and requires both participants. It can include text copied in other Windows applications; it is not limited to the shared tab.
- Chrome and Edge on Windows are the documented environment. Audio, desktop sharing, browser chrome, internal browser pages, and native dialogs are unsupported.
- There is no TURN relay, so some networks cannot connect. Live control uses synthetic events and does not guarantee compatibility with every site.
- Browser permissions and native capture indicators remain enabled. Avoid claims of invisible control or bypassing site restrictions.
- Preserve the documented production signaling endpoint, `https://ghostpair.onrender.com`, and keep credentials out of Git and public build variables. Website work does not require a signaling deployment.

## Brand Commitments

GhostPair is the established product name. The website uses a linked-loop logo and plain collaboration language, including “Browse together” and “Connected, together.” The user granted creative freedom for the website redesign while requiring a visual identity similar to the extension. Preserve the linked-loop identity and forest/mint relationship. The approved website uses self-hosted Manrope Variable; the extension and its exported interfaces keep their existing typography.

## Evidence on Hand

- `apps/landing/src/App.tsx` and `apps/landing/src/styles.css`: public copy, installation instructions, release links, and the built website's visual rules. `apps/landing/src/components/` contains the authentic preview wrappers, mode illustration, and hero renderer.
- `apps/landing/vite.config.ts` and `apps/landing/README.md`: relative-base build, preserved product assets, renderer seam, and development workflow. The generated public entry is `docs/index.html`, with generated assets and the Manrope license under `docs/assets/landing/`.
- `docs/assets/icon.png`: website icon; the page also contains an inline logo.
- `docs/assets/previews/`: static examples exported from the extension. `scripts/export-previews.mjs` produces them and verifies matching geometry and styles; preserve their fidelity to the unchanged extension.
- `README.md`, `docs/architecture.md`, and `docs/validation.md`: behavior, limitations, and validation evidence. Check executed versus pending validation before making claims. `docs/privacy.html` is a publisher draft with unresolved details; do not treat placeholders as established facts.
- No testimonials, customer counts, performance promises, or store availability were supplied for this init. Do not invent them.

## Product Principles

1. Improve the public website while preserving the extension in full.
2. Explain host consent, interaction modes, and limitations in understandable language.
3. Keep previews faithful to the shipped interface and distinguish example data from a live session.
4. Keep downloads and installation instructions aligned with the actual release process.

## Accessibility & Inclusion

The existing website provides semantic headings, a skip link, labeled navigation and preview links, visible keyboard focus, responsive layouts, and reduced-motion handling. Preserve these capabilities in future website work. No additional audience-specific accessibility requirement or verified conformance claim has been established.
