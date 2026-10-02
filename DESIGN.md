---
name: GhostPair Public Website
description: Forest and mint browser collaboration identity for the GitHub Pages website.
colors:
  mint: "#b5f0cd"
  mint-hover: "#cef7df"
  canvas: "#101918"
  panel: "#182321"
  line: "#2b3935"
  text: "#eef3f1"
  muted: "#a3b3ac"
  ink: "#11261b"
  ink-hover: "#244333"
  install-muted: "#30513f"
  selector-hover: "#24372e"
  tag-surface: "#223c2e"
typography:
  display: { fontFamily: "Inter, 'Segoe UI', sans-serif", fontSize: "clamp(64px, 7.4vw, 96px)", fontWeight: 600, lineHeight: 1.04, letterSpacing: "-.04em" }
  headline: { fontFamily: "Inter, 'Segoe UI', sans-serif", fontSize: "clamp(36px, 4.2vw, 54px)", fontWeight: 600, lineHeight: 1.12, letterSpacing: "-.035em" }
  title: { fontFamily: "Inter, 'Segoe UI', sans-serif", fontSize: "20px", fontWeight: 600, lineHeight: 1.3, letterSpacing: "-.015em" }
  body: { fontFamily: "Inter, 'Segoe UI', sans-serif", fontSize: "16px", fontWeight: 400, lineHeight: 1.7 }
  label: { fontFamily: "Inter, 'Segoe UI', sans-serif", fontSize: "14px", fontWeight: 600, lineHeight: 1.4 }
rounded: { focus: "4px", tag: "5px", selector-label: "8px", control: "9px", preview: "12px", panel: "16px" }
spacing: { compact: "8px", small: "12px", medium: "16px", control: "20px", content: "24px", group: "32px", section-mobile: "44px", grid-tablet: "48px", grid: "72px", section: "80px" }
components:
  button-primary: { backgroundColor: "{colors.mint}", textColor: "{colors.ink}", typography: "{typography.label}", rounded: "{rounded.control}", padding: "16px 22px" }
  button-primary-hover: { backgroundColor: "{colors.mint-hover}", textColor: "{colors.ink}" }
  button-install: { backgroundColor: "{colors.ink}", textColor: "{colors.mint}", typography: "{typography.label}", rounded: "{rounded.control}", padding: "16px 22px" }
  button-install-hover: { backgroundColor: "{colors.ink-hover}", textColor: "{colors.text}" }
  preview-selector: { backgroundColor: "{colors.panel}", textColor: "{colors.muted}", rounded: "{rounded.preview}", padding: "5px" }
  preview-selector-selected: { backgroundColor: "{colors.mint}", textColor: "{colors.ink}", rounded: "{rounded.selector-label}", padding: "10px 18px" }
  mode-tag: { backgroundColor: "{colors.tag-surface}", textColor: "{colors.mint}", rounded: "{rounded.tag}", padding: "5px 9px" }
  preview-panel: { backgroundColor: "{colors.panel}", rounded: "{rounded.panel}", padding: "40px 64px 24px" }
---

# Design System: GhostPair Public Website

## Overview

**Creative North Star: "A shared browser"**

This system applies to the public GitHub Pages website in docs/index.html and docs/assets/site.css. A forest canvas, mint actions, linked-loop identity, and the extension's existing system font stack keep the website recognizable. Larger type and open spacing suit a public introduction.

The website uses flat surfaces and thin rules to organize content. Authentic extension exports remain independent examples, with visible example-data labeling and links to their full-size pages. Their internal interface is preserved rather than promoted into new website rules.

**Key Characteristics:**

- Forest canvas with mint actions and a mint installation field.
- Extension font continuity with a larger website hierarchy.
- Thin boundaries, restrained rounded controls, and open section spacing.
- Native controls, visible keyboard focus, and reduced-motion support.

The existing local favicon, `docs/assets/icon.png`, matches `apps/extension/public/icons/128.png` and originates from repository tooling in `scripts/icons.mjs`. The linked-loop header mark is inline SVG. No new raster assets were added.

## Colors

The palette uses a dark forest base, a single mint accent, and green-tinted neutrals. Frontmatter values are normative.

### Primary

- **Mint:** primary actions, selected preview labels, selected headline words, and the installation background.
- **Mint hover:** the primary download action's hover state.

### Neutral

- **Forest canvas / panel:** page background and contained interface examples.
- **Thin forest line:** section rules and control boundaries.
- **Light text / muted text:** headings and body text versus supporting descriptions and metadata.
- **Deep ink / ink hover:** text on mint and the inverse installation action.
- **Installation muted:** supporting text on the mint field.
- **Selector hover / tag surface:** subtle interaction and mode-label backgrounds.

**The Extension Continuity Rule.** Keep the website's forest and mint palette, existing family stack, and linked-loop identity visibly related to the extension.

## Typography

**Display and Body Font:** `Inter, 'Segoe UI', sans-serif`, matching the extension. No font is downloaded; local availability determines the rendered family.
**Code Font:** `'Cascadia Code', Consolas, monospace` for browser URLs and filenames.

The existing family stack is an explicit continuity constraint. Website hierarchy comes from scale, weight, spacing, and line length.

### Hierarchy

- **Display:** the main headline; at widths up to 700px, its size becomes `clamp(58px, 16vw, 80px)`.
- **Headline:** section headings; on mobile the shared heading size is 38px. The installation heading uses `clamp(42px, 5vw, 64px)` on desktop and 48px on mobile.
- **Title:** steps and interaction-mode headings.
- **Body:** supporting paragraphs; mobile uses 15px for the main muted descriptions.
- **Label:** action links; selector labels use 13px on desktop and 12px on mobile. Small metadata uses 11–13px.

Use the frontmatter for the core ramp. Introductory text is larger (25px, line height 1.45) and narrows to 22px at the tablet breakpoint.

## Layout

The main container is capped at 1200px with 48px desktop side gutters. Gutters become 32px at 1050px and 20px at 700px. Desktop sections use two columns with substantial gaps; at 700px the hero, explanatory sections, installation instructions, and setup examples become one column.

Main section spacing is 80px on desktop and 44px on mobile. Navigation moves to a second header row on mobile, while the preview selector spans the available width. Body descriptions use observed limits of 375–480px instead of filling wide columns.

Preview wrappers keep their exported aspect ratios. The existing ResizeObserver helper scales iframe contents from their declared widths; it does not change the exports.

## Elevation & Depth

The website has no box shadows. Flat panel color, thin borders, and space separate its regions. The mint installation field changes tonal emphasis; embedded previews retain their own internal depth.

**The Flat Surface Rule.** Website depth comes from panel color, borders, and spacing; the embedded extension exports retain their own rendering.

## Shapes

Controls have restrained rounded corners. Action links use the control radius; the native selector has a larger outer radius and smaller selected-label corners. Preview links and setup panels use the preview and panel radii. Mode tags are compact rounded rectangles.

Website icons are inline stroke SVGs (20px by default, 16px beside captions). Navigation icons use 18px on desktop and 16px on mobile. Repository buttons use the filled GitHub mark at 20px in the header and 16px in the footer. The existing linked-loop mark retains its established silhouette.

## Components

### Actions

Primary download links use mint with deep ink text. The installation action reverses those colors. Both share the action typography and spacing in frontmatter; mobile padding is 15px 18px with 13px text. Text links remain mint and gain an underline on hover.

Header and footer repository links share a bordered `.github-button` with the GitHub mark, a 44px minimum height, and the control radius. Hover adds the panel background and mint border.

Keyboard focus is a 2px outline with a 5px offset, changing to deep ink inside the installation field. Preview links use a 6px offset.

### Native preview selector

A labeled fieldset contains three native radios and their visible labels in equal grid columns. A mint `::before` indicator slides beneath the checked label with a 300ms `cubic-bezier(.16, 1, .3, 1)` transform transition. CSS `:has()` positions the indicator and displays the corresponding website panel, with the shared view selected initially. Keyboard focus outlines the active radio's visible label with a 3px offset.

Panel revelation uses a 320ms `cubic-bezier(.16, 1, .3, 1)` mask and brightness animation. Reduced motion disables the reveal and indicator transition and switches smooth scrolling to automatic scrolling.

### Preview containers

Authentic local HTML exports appear in noninteractive scaled iframes inside links to their full-size versions. Captions distinguish example data from a live session. Setup panels have a flat forest background and become vertically stacked on mobile.

### Mode tags

Compact mint-on-forest labels explain the default mode. The optional label uses muted text on the panel background. They describe state and are not controls.

### Navigation and disclosure

Header navigation groups icon-and-text links inside a bordered panel rail with rounded controls and 44px minimum targets. Mint icons lead each label; Install uses the tag surface and mint text for emphasis. Hover adds the selector-hover surface, and keyboard focus remains visible. The rail fills the second header row on mobile. A native `details` disclosure presents connection facts; its SVG chevron rotates when open. The skip link becomes visible on keyboard focus.

## Do's and Don'ts

### Do:

- Do preserve the extension family stack and the linked-loop identity.
- Do use native radio grouping for preview selection and native details for disclosure.
- Do keep example-data labels and full-size links beside authentic previews.
- Do preserve visible focus, a skip link, semantic headings, and reduced-motion behavior.
- Do keep website asset and preview paths relative for GitHub Pages.

### Don't:

- Don't restyle the extension or its exported previews as part of website work.
- Don't turn example interfaces into screenshots with invented product states.
- Don't introduce a second display family while extension continuity remains the approved direction.
