---
name: GhostPair Public Website
description: Forest and mint collaboration identity with linked signal geometry.
colors:
  mint: "#b5f0cd"
  mint-hover: "#cef7df"
  canvas: "#101918"
  forest: "#0c1714"
  panel: "#182321"
  panel-light: "#20302a"
  text: "#eef3f1"
  muted: "#a3b3ac"
  line: "#2b3935"
  ink: "#11261b"
  ink-muted: "#30513f"
  ink-hover: "#244333"
  tag-surface: "#223c2e"
  diagram-stroke: "#71937f"
  simulation-click: "#7871e8"
typography:
  display: { fontFamily: "\"Manrope Variable\", \"Segoe UI\", sans-serif", fontSize: "clamp(72px, 7.8vw, 96px)", fontWeight: 500, lineHeight: 1.05, letterSpacing: "-0.04em" }
  headline: { fontFamily: "\"Manrope Variable\", \"Segoe UI\", sans-serif", fontSize: "clamp(38px, 4.4vw, 64px)", fontWeight: 500, lineHeight: 1.13, letterSpacing: "-0.035em" }
  title: { fontFamily: "\"Manrope Variable\", \"Segoe UI\", sans-serif", fontSize: "21px", fontWeight: 500, lineHeight: 1.4, letterSpacing: "-0.02em" }
  body: { fontFamily: "\"Manrope Variable\", \"Segoe UI\", sans-serif", fontSize: "15px", fontWeight: 400, lineHeight: 1.8 }
  hero-body: { fontFamily: "\"Manrope Variable\", \"Segoe UI\", sans-serif", fontSize: "19px", fontWeight: 400, lineHeight: 1.6, letterSpacing: "-0.015em" }
  label: { fontFamily: "\"Manrope Variable\", \"Segoe UI\", sans-serif", fontSize: "13px", fontWeight: 650 }
  detail: { fontFamily: "\"Manrope Variable\", \"Segoe UI\", sans-serif", fontSize: "11px", fontWeight: 400 }
rounded: { tag: "4px", field: "6px", control: "8px", selector: "9px", preview: "12px", panel: "16px", circle: "50%" }
spacing: { compact: "8px", small: "12px", medium: "16px", control: "20px", content: "24px", group: "28px", stage: "40px", heading: "48px", grid: "64px", section-mobile: "74px", section-tablet: "90px", section: "118px" }
components:
  button-primary: { backgroundColor: "{colors.mint}", textColor: "{colors.ink}", typography: "{typography.label}", rounded: "{rounded.control}", padding: "17px 22px", height: "54px" }
  button-primary-hover: { backgroundColor: "{colors.mint-hover}" }
  button-install: { backgroundColor: "{colors.ink}", textColor: "{colors.mint}", typography: "{typography.label}", rounded: "{rounded.control}", padding: "17px 22px", height: "54px" }
  button-install-hover: { backgroundColor: "{colors.ink-hover}" }
  button-header: { textColor: "{colors.text}", rounded: "{rounded.control}", padding: "10px 16px", height: "43px" }
  preview-selector: { backgroundColor: "{colors.panel}", textColor: "{colors.muted}", rounded: "{rounded.selector}", padding: "4px" }
  preview-selector-selected: { backgroundColor: "{colors.mint}", textColor: "{colors.ink}", rounded: "{rounded.field}", padding: "12px 22px", height: "44px" }
  gallery-panel: { backgroundColor: "{colors.panel}", textColor: "{colors.text}", rounded: "{rounded.panel}", padding: "38px" }
  demo-field: { backgroundColor: "{colors.canvas}", textColor: "{colors.text}", rounded: "{rounded.field}", padding: "13px 15px", height: "48px" }
  mode-status: { backgroundColor: "{colors.tag-surface}", textColor: "{colors.mint}", rounded: "{rounded.tag}", padding: "4px 8px" }
---

# Design System: GhostPair Public Website

## Overview

**Creative North Star: "A shared space"**

A shared space connects two points of view. The website keeps GhostPair's forest/mint palette and linked-loop mark, then expresses that identity through broad Manrope lettering, open spacing, fine diagram lines, and two interlinked filament loops.

This system is built in apps/landing/src/ and compiled to docs/index.html and docs/assets/landing/ for GitHub Pages. Interface surfaces stay flat and readable while the hero carries sculptural depth. Authentic extension exports retain their own interface and typography; the website frames them with clear example labels.

**Key Characteristics:**

- Forest canvas, pale mint actions, and an inverse mint installation field.
- Self-hosted Manrope Variable with a large, compact heading hierarchy.
- Flat interface fields, thin rules, and restrained control corners.
- Interlinked filament geometry preserved as a prerendered video loop.
- Native controls, visible focus, automatic playback, and reduced-motion support.

## Colors

The palette uses one pale mint accent with deep forest grounds and green-tinted neutrals. Frontmatter values are normative.

### Primary

- **Mint / mint hover:** download actions, selected controls, diagram signals, focus outlines, and the installation field.
- **Deep ink / ink hover:** text on mint and the inverse installation action.

### Neutral

- **Canvas / forest:** the page ground and the deeper product-example section.
- **Panel / panel light:** contained examples, the mode illustration, and control hover surfaces.
- **Light text / muted text:** headings and body content versus supporting descriptions and metadata.
- **Line / diagram stroke:** fine dividers and muted browser/control outlines.
- **Ink muted:** supporting text on the mint installation field.
- **Tag surface:** compact mint status labels.

**The Identity Continuity Rule.** Preserve the forest/mint relationship and linked-loop silhouette across website changes.

## Typography

**Display and Body Font:** self-hosted Manrope Variable, with Segoe UI and sans-serif fallbacks. The Latin variable WOFF2 covers weights 200–800, uses font-display swap, and ships with its OFL license. The extension and exported examples retain their existing font stack.
**Code Font:** Cascadia Code, Consolas, monospace for installation paths.

The website uses a single family with moderate weights and close heading spacing. Broad two-line headings carry the hierarchy; supporting copy remains compact.

### Hierarchy

- **Display:** the hero headline. Mobile uses clamp(58px, 16.5vw, 86px) and a 1.07 line height; the installation display has its own clamp(58px, 6.4vw, 92px).
- **Headline:** section titles. Mobile uses clamp(35px, 9.8vw, 50px) and a 1.16 line height.
- **Title:** steps and supporting headings. Gallery titles use a larger 30px treatment with a 1.23 line height.
- **Body:** section introductions; their observed text widths are 350px, or 430px for the permission introduction. Step and gallery descriptions use 12–13px.
- **Hero body:** the short opening description, reducing to 16px on tablet/mobile and 15px at the narrowest breakpoint.
- **Label:** principal actions. Selector labels use 12px and weight 550; navigation uses 13px and weight 500.
- **Detail:** captions, route labels, and technical metadata. These range from 9–12px by component and viewport.

## Layout

The content container is capped at 1280px with 56px desktop gutters. Gutters reduce to 32px at 1100px, 24px at 800px, 20px at 580px, and 16px at 360px. Standard section padding is 118px, then 90px on tablet and 74px on mobile.

Desktop pairs a 58% hero text region with an overlapping sculpture region. At 580px the text and action precede a full-width, 290px-high scene; the narrowest layout uses 260px. The connection diagram retains its three points while the explanatory steps stack on mobile. Gallery description and preview become a vertical composition at 800px; the two mode panels stack at 580px. Installation steps likewise move from three columns to a vertical list.

The preview wrappers preserve each export's authored aspect ratio. ResizeObserver scales iframe contents from their declared width. Hidden examples load on first selection and remain available for later visits.

## Elevation & Depth

The website has no box shadows. Canvas, forest, and panel color separate sections and contained examples; one-pixel rules organize connections and lists. The hero creates depth through projected geometry, occlusion, directional shading, and longitudinal filaments. Exported product interfaces retain their original rendering.

**The Flat Interface Rule.** Use surface color, thin borders, and spacing for interface depth; reserve modeled shading for the hero sculpture.

## Shapes

Controls use gently rounded corners; contained examples use larger preview and panel radii. Circular dots identify participants and states. The established linked-loop mark appears in the header, connection center, installation field, and footer.

The hero consists of two orthogonal interlocked loops, each with a shaded tube surface and continuous longitudinal fibers. Bright traveling filaments reinforce connection. The offline source uses 64 segments and 32 strands per loop, reduced to 56 and 24 for the mobile asset. Videos and posters preserve this artwork while the interface remains in the DOM.

## Components

### Actions and navigation

Primary and inverse actions share the frontmatter geometry. Hover lifts them 2px with the common cubic-bezier(0.16, 1, 0.3, 1) easing. Header download and explore links use thin bordered controls; repository and navigation links turn mint on hover. Mobile actions use 50px minimum height and 15px 18px padding.

At 800px navigation becomes a button-controlled vertical menu. The menu exposes its expanded state, closes when a destination is chosen, and returns focus to its button on Escape. Focus uses a 2px mint outline with a 5px offset; the mint installation field uses ink. The skip link appears on focus.

### Product preview

A labeled native radio group selects Shared view, Host a session, or Join a session. Selected labels use mint/ink; hover uses the lighter panel. Keyboard focus outlines the associated label. The selected gallery uses a 0.55s GSAP reveal with a small upward movement and shallow clip; reduced motion disables it.

Each noninteractive iframe sits inside a full-size example link. Captions identify its product context; the toolbar states “The real interface. Example data.” The gallery's rounded panel frames the unchanged export.

### Interaction-mode illustration

A labeled native radio group starts in Visual only. The guest note and checkbox change locally while the host output stays at its prior values; in Live control, subsequent edits update both. A Save plans button previews its click in Visual only and confirms Plans saved in both panels in Live control. Changing modes alone does not apply pending fields. Reset restores Visual only, initial values, and empty confirmations. Status tags label Preview, Live, and Original.

Clicks and taps anywhere in the guest's simulated page show the extension's purple halo: 30px, a 2px #7871e8 border, 12% accent fill, and a linear 500ms scale from 0.6 to 1.3 while fading. Keyboard activation uses the control center. The effects use CSS and disappear after completion; reduced motion shows a static ring for the same duration. The product's interaction accent is retained only in this faithful feedback example.

Inputs use a canvas background, thin line border, field radius, and mint focus border. The two panel headers and read-only host output share the same proportions. The visible “Interactive illustration · Example data” caption establishes the example's status.

### Disclosure

A native details element contains connection facts between thin rules. Its plus mark becomes a horizontal line when open. The three text columns become one on mobile; summary focus follows the common outline.

### Hero and motion

HeroScene is lazy-loaded and owns playback, visibility, responsive asset selection, and reduced-motion handling. Its two local MP4/H.264 assets have a 42s period at 30fps, without audio. Desktop is 1280×1080; mobile is 720×608 and selected at 700px. A matching lossless WebP poster appears immediately and remains visible if loading or playback fails. Initial reduced motion does not download a video. The procedural source lives only in the offline generator.

The sculpture's shape and traveling filaments share a continuous 42s period. Playback stops offscreen and in a hidden document, resuming when visible. Reduced motion uses the static poster. There is no geometry calculation, pointer response, or animation-frame rendering loop in the visitor's hero component.

GSAP introduces the hero with expo.out easing, traces Host → GhostPair → Guest as the visitor scrolls, and reveals sections once. The connection runs from top 80% to bottom 50% with a 0.45s scrub; browser symbols and the guest cursor brighten to mint as it completes. Reduced motion presents the complete connection and turns smooth scrolling off. Desktop hero parallax starts at 900px. The introductory status strip and manual motion pause have been removed; native page scrolling remains available throughout.

## Do's and Don'ts

### Do:

- Do keep the forest/mint palette and linked-loop identity recognizable.
- Do use the website's self-hosted Manrope while preserving the extension exports' existing typography.
- Do keep native radio groups, labeled fields, visible focus, and the skip link.
- Do preserve reduced motion, automatic offscreen suspension, native scrolling, and readable settled content.
- Do keep authentic examples labeled and linked to their full-size exports.
- Do edit the React/Vite source and build relative assets for the GitHub Pages project path.

### Don't:

- Don't restyle the extension or its exported product interfaces as part of website work.
- Don't present the mode illustration or example data as an actual connected session.
- Don't make product content or controls depend on the decorative video.
