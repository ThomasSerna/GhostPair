# GhostPair validation

## Environment and commands

Automated browser checks use Windows, Node.js 24, and Playwright with temporary profiles under `tests/browser/.artifacts`. They do not use installed personal profiles. Runs are headless unless explicitly documented otherwise; no argument suppresses native capture or debugging warnings.

```powershell
npm ci
npm run build
npm run typecheck
npm test
node tests/browser/tab-capture-probe.mjs
node tests/browser/dom-probe.mjs
node tests/browser/environment-check.mjs
npm run test:browser
npm run test:frames
npm run test:questionnaires
node tests/browser/benchmark.mjs
node scripts/inspect-ui.mjs
npm run package
```

Run a single pairing with `node tests/browser/smoke.mjs chrome:edge`. Override executable locations with `GHOSTPAIR_CHROME` and `GHOSTPAIR_EDGE`. Set `GHOSTPAIR_HEADED=1` for visible windows and optionally `GHOSTPAIR_INSPECT=1` to hold the synthetic session for one minute for inspection.

The harness loads an unpacked extension using `Extensions.loadUnpacked`, enabled only for the isolated browser process with `--enable-unsafe-extension-debugging`. Inspection runs omit Playwright's opt-in `--enable-automation` argument to inspect the ordinary toolbar; they do not suppress native capture or extension debugging indicators. The capture probe invokes `Extensions.triggerAction` against a browser **tab target** to exercise local extension authorization; it first verifies rejection without invocation. These test APIs are separate from the extension runtime. See [the CDP extension testing API](https://chromedevtools.github.io/devtools-protocol/tot/Extensions/) and [Playwright extension testing](https://playwright.dev/docs/chrome-extensions).

## Visual simulation update: September 17, 2026

Version **0.4.0**, peer protocol **4**. **117 unit tests in 13 files passed**, as did all workspace TypeScript checks and production compilation. Packaging produces Chrome and Edge 0.4.0 ZIPs with the existing permission and bundle checks. Both participants must update; addresses, identities and connection settings remain valid.

`npm run test:visual` runs the production isolated controller on disposable Chrome and Edge fixtures. It verifies that visual clicks, checkbox/radio selections, Unicode editing, selection replacement, multiline text, basic contenteditable and password masking leave original form markup, values, focus, selection and page interaction events unchanged. A trusted-only button remains unactivated. Checks also cover geometry rebinding, clipping/scroll alignment, removed targets, long-text scrolling restricted to the overlay, optional notice duration/throttling, cleanup and rejection of input or installations from an older mode/generation.

The native WebRTC smoke suite passed for **Chrome→Chrome, Edge→Edge and Chrome→Edge**. It checks preview controls and text in received video pixels, confirms unchanged original fields and event counters, and exercises both root documents and cross-origin iframes. Manual clearing preserves the video presentation; temporary previews expire across frames. The existing form, navigation, clipboard-disabled, capture, interruption, reconnect and signaling-loss regressions explicitly select Live control.

The embedded-frame suite passed on both browsers, including virtual focus through nested frames, unchanged real focus/values and previews preserved through browser zoom. Existing frame permissions, replacement, reordering, scaling, cancellation and cleanup cases also passed. The separate Live-control probes passed their DOM checks and **40 questionnaire comparisons**.

The UI inspection produced six screenshots without page errors and exercised the new menu: Visual only is selected initially, notices are initially off, and temporary duration plus notice preferences can be changed. Screenshots of the host and received video were inspected. Reports and images are under `tests/browser/.artifacts`, including `visual-results.json`, `frame-control-results.json`, the smoke report and `visual-*-host.png` / `visual-*-viewer.png`.

An initial Edge integration run exited during startup, before any product assertion. Inspection showed that Edge's compatibility layer successfully exits the bootstrap process and relaunches the browser with the same disposable profile. The harness now waits for that profile's debugging endpoint after a successful bootstrap exit, retains nonzero-exit errors and allows additional bounded cleanup retries. Reruns passed; personal browser profiles are never attached to or changed.

These are controlled fixture results, not a guarantee of visual fidelity for arbitrary custom widgets or advanced editors. Visual only does not bypass trusted-input checks or invent application outcomes. Existing manual permission, native-indicator and multi-computer publication checks remain applicable.

## Questionnaire control update: September 12, 2026

Version **0.3.0**, peer protocol **3**. **111 unit tests in 13 files passed**, along with TypeScript checking, production compilation and packaging. The production ZIP checks still reject debugger permissions/calls, required test host grants, instrumentation, source maps and environment files. Both participants must update; installation identities and saved settings are preserved.

The questionnaire comparison suite passed **40 cases** across Chrome 152.0.7977.78 and Edge 153.0.4234.32. It compares the production DOM controller with browser input on disposable local pages: checkbox labels, radio selection, nested button targets, canceled pointer/mouse/click events, the first-legend disabled-fieldset exception, Space activation, radio/select arrows, disabled options, canceled keyboard defaults, implicit submission with its default submitter, and native required-field validation. Its trusted-only fixture deliberately accepts browser input and rejects the extension's synthetic click.

The session smoke suite includes the same questionnaire workflow at the top level and in an authorized cross-origin iframe. It exercises guest mouse and keyboard input over WebRTC, Unicode/repeated text, one commit per synthetic composition/paste sequence, a two-step questionnaire, nested-button gestures, and no submission on Escape, focus loss, pointer cancellation, lost capture or switching away from the viewer tab. The composition/paste cases do not access the system clipboard and do not establish real Windows IME compatibility.

The final production build passed the complete smoke suite for **Chrome→Chrome, Edge→Edge and Chrome→Edge**, including these questionnaires and the existing capture, navigation, authorization, reconnect and signaling-loss regressions. The separate embedded-frame suite also passed on both browsers, including nested and replaced documents, canvas/SVG, scrolling, isolated controllers, and capture cleanup.

Guest test browsers use the public `connectOverCDP({ noDefaults: true })` option with a new isolated profile to preserve actual tab focus and visibility; normal Playwright launches force pages to appear focused. The native process is closed at the end. This test-only connection does not add debugger access to the extension or suppress browser warnings. Explicit waits check that the viewer becomes hidden and that the host receives cancellation before continuing.

An initial native guest run was interrupted by Edge automatically signing a fresh profile into the Windows account. That incomplete run is excluded from the results. The harness now disables browser sync and writes [sign-in preferences](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/signin/public/base/signin_pref_names.cc) only in its new temporary profiles before launch, and uses bounded action timeouts. Existing user profiles and system policies are untouched.

Unit tests cover release barriers, canceled queues, late failure after a replacement presentation, control withdrawal/restoration, successful tab creation that changes the presentation, move coalescing, repeated text, rate/queue overflow, failed channel writes, rejected delivery to the host and resetting counters between sessions. Browser suites also verify the static `GhostPair` action title, empty badge and retained native capture.

Reports are written to `tests/browser/.artifacts/questionnaire-results.json`, `native-smoke-results.json`, and `frame-control-results.json`. These are local synthetic-page results, not evidence for an unspecified protected questionnaire. Sites requiring `Event.isTrusted`, native select popups and multiple-selection keyboard behavior remain unsupported. Native Windows toolbar visual inspection, real optional-permission prompts, and multi-computer checks remain on the publication checklist below.

## Embedded control update: September 8, 2026

**93 unit tests in 12 files passed**, along with TypeScript checking, production compilation and packaging. The production ZIP checks still reject debugger permissions/calls and test-only content.

The real-extension frame suite passed on Chrome 152.0.7977.78 and Edge 152.0.4191.66, using independent host/guest profiles, local signaling and WebRTC. It exercises same-origin, cross-origin and nested frames; identical-URL siblings; dynamic insertion; frame replacement and state-preserving reordering; child focus, Unicode text and scrolling; frame borders/padding/scaling; canvas clicks and canceled wheel events; SVG clicks and single checkbox activation. A restricted data frame leaves the video and permitted siblings usable. Control withdrawal, pause and stop release/dispose child controllers. Page JavaScript cannot see the isolated controller or control it through `postMessage`.

The suite checks `chrome.action.getBadgeText()` is empty, the action title remains `GhostPair`, and native capture is active. Results are in `tests/browser/.artifacts/frame-control-results.json`. Unit tests additionally exercise injection denial, stale route verification, pending input cancellation, original-document key release, and late installation cleanup. Tab tests distinguish child loading from top-document navigation and reject pending actions across control withdrawal/restoration.

The existing session smoke suite also passed Chrome→Chrome, Edge→Edge and Chrome→Edge. Visible Chrome→Chrome and Edge→Edge runs passed. **Native-toolbar visual inspection remains unverified:** Computer Use stopped because automatic policy review could not confidently determine the browser window URL. No alternative screenshot mechanism was used to bypass that restriction. The API assertions and package inspection are not substitutes for native-toolbar visual evidence.

Tests use synthetic local pages, not unspecified real failing sites. Sites that require trusted input, inaccessible frames, native pointer capture/dragging, and advanced editors remain compatibility limits.

## Migration evidence: September 7–8, 2026

**82 unit tests in 11 files passed**, along with TypeScript checking, compilation and packaging. The package checks reject debugger permissions/calls, required test host grants, instrumentation, source maps and environment files. Development packages are `ghostpair-chrome-0.2.0.zip` and `ghostpair-edge-0.2.0.zip`.

The new capture primitive probe passed on both installed browsers:

| Check | Chrome 152.0.7977.78 | Edge 152.0.4191.66 |
| --- | --- | --- |
| Reject capture before local extension invocation | Passed | Passed |
| Obtain an authorized stream ID and consume it in offscreen | Passed | Passed |
| Retain two live authorized tab streams simultaneously | Passed | Passed |
| Keep authorized capture across a cross-origin navigation | Passed | Passed |

Results are written to `tests/browser/.artifacts/tab-capture-probe.json`. The separate migrated integration suite also passed:

| Integration scenario | Chrome → Chrome | Edge → Edge | Chrome → Edge |
| --- | --- | --- | --- |
| Eight-character authentication and wrong-password notification dismissal | Passed | Passed | Passed |
| Native video, DOM clicks, Unicode, deletion, textarea editing and nested scroll | Passed | Passed | Passed |
| Zoom, resize, pause and view-only mode | Passed | Passed | Passed |
| Tab dialog validation, Escape and focus restoration | Passed | Passed | Passed |
| Pending approval, two authorized tabs, source switching and release | Passed | Passed | Passed |
| Cross-origin navigation and current-generation input | Passed | Passed | Passed |
| Host stop, guest disconnect, reconnect, viewer reload and singleton ownership | Passed | Passed | Passed |
| Preserved identity/address, P2P after signaling loss and final capture release | Passed | Passed | Passed |

The DOM probe separately exercised native input setters, checkboxes, basic contenteditable editing, inaccessible-frame errors, sender isolation and listener disposal in both browsers. Resize rejects input locally before the service worker responds. This probe stubs runtime messaging and does not validate extension permissions.

The environment check builds disposable extension copies from root and workspace directories, verifies process-variable precedence and confirms that private sentinel values never enter the bundle. It also checks server root-file resolution from both directories. Unit tests cover missing files, invalid configuration, saved settings/reset, password boundaries, notification IDs, five-capture limits, permission revocation, cancellation during acquisition, delayed old media/control negotiation and pending-operation cleanup.

Chrome→Chrome and Edge→Edge also passed with **visible windows** on September 7. However, Computer Use blocked inspection of the native toolbar because it could not confidently determine the window URL. The absence of debugger permission/calls is verified in the package; visual absence of the extension debugging banner and appearance of native consent indicators remain **unverified**. No browser-chrome screenshot was accepted as evidence. Separate UI screenshots use mocked extension APIs and validate page layout only.

The integration manifest grants HTTP/HTTPS host access to avoid headless permission dialogs. Capture still requires native extension invocation. Actual optional-permission approval/denial and native cancellation UI remain manual checks. Results and page screenshots are in `tests/browser/.artifacts`, excluded from Git.

## Synthetic performance comparison

The benchmark rebuilds MVP commit `3ff895e` in a disposable directory using current locked dependencies. Both variants use Chrome loopback, a 1280×720 source containing moving rectangles updated at 30 Hz, three seconds of warmup and a five-second sample. Instrumentation is added only to disposable test copies. See `benchmark-results.json` for raw measurements.

| Measurement | MVP CDP/JPEG | Native tabCapture/WebRTC |
| --- | --- | --- |
| Video payload rate | 3.90 Mb/s | 0.49 Mb/s |
| Rendered frames per second | 11.57 | 21.69 |
| Combined browser CPU time over the sample | 8.36 CPU seconds | 8.45 CPU seconds |

These September 8 results show higher frame rate and lower video payload traffic for this animation, without demonstrating lower CPU use. Counts are data-channel video payload for the MVP and inbound video RTP payload for the replacement; network overhead is excluded. CPU time sums host/guest browser processes present at both samples and can exceed elapsed time on a multicore machine. This short local sample is not a controlled hardware study or a claim about arbitrary pages. Memory, interaction latency and long-session behavior were not measured.

## Historical MVP evidence: September 6, 2026

The previous implementation passed 48 unit tests, type checking, compilation, and local Chrome→Chrome, Edge→Edge, and Chrome→Edge integration using Chrome 152.0.7977.78 and Edge 152.0.4191.66. Those results covered the former CDP/JPEG capture and input path. They do **not** validate the replacement tabCapture/WebRTC/DOM implementation.

Historical integration exercised authentication, image delivery, clicks, Unicode input, zoom and resize, pause, control withdrawal, tab operations, and termination. It continued operating over P2P after signaling stopped. The signaling Docker image built and its health endpoint returned `200` with `{"status":"ok"}`; Compose configuration passed locally. No public domain was deployed. Development ZIP contents were inspected at that time.

Historical reports, when retained locally, are under `tests/browser/.artifacts`. Artifacts are excluded from Git. A passed offscreen clipboard-document creation check demonstrates API availability, not real Windows clipboard synchronization.

## Automated acceptance coverage

Integration connects independent browser processes and profiles to the real local signaling server using production extension JavaScript. Data remains synthetic. The test manifest grants host permissions to avoid headless permission dialogs; actual permission prompts and revocation remain manual checks.

Use SQLite in memory and temporary local ports. The local STUN fixture implements Binding only, never TURN. Connections on one machine do not establish NAT traversal or connectivity between computers. No public STUN service is used unless explicitly configured through `GHOSTPAIR_TEST_STUN`.

Required migration scenarios:

- Root and workspace `.env` loading, process-variable priority, missing files, invalid values, saved-setting preservation/reset, and exclusion of server-only values from extension bundles.
- Rejection of 7-character and 257-character passwords; successful authentication with 8 characters and existing longer passwords.
- Full-page guest connection, wrong-password handling, reconnecting after either participant ends the session, no duplicate viewer, and termination on viewer close or reload.
- Dismissal of local and shared notification occurrences, including later identical text; tab dialog validation, Enter/Escape, focus, and creation failure.
- Per-tab authorization, approval for a remotely created tab, five-tab capture limit and release, cross-origin navigation, and switching between authorized tabs.
- Basic Unicode editing, DOM clicks, scroll containers, zoom and resize, pause, and control withdrawal. Reject stale document, tab, and presentation-generation input.
- Delayed old signaling/video messages must not restore an obsolete presentation or enable input. Termination must release streams, connections, clipboard polling, and queued actions.
- Packaged manifest and JavaScript must contain no extension debugger capture implementation or test-only permissions.

The system clipboard is disabled in headless integration. Windows clipboard access is not isolated by browser profile; automated runs must not read or overwrite real clipboard contents. Memory-adapter unit tests cover synchronization logic separately.

## Checks still required before publication

- On two authorized computers, test Chrome↔Chrome, Edge↔Edge, and Chrome↔Edge on LAN and separate networks. Include a network blocking direct connectivity and verify the error after 30 seconds.
- In visible Chrome and Edge windows, inspect native capture indicators, absence of an activity badge, and absence of an extension debugging banner. Exercise optional permission approval, denial, revocation, native cancellation, and fresh local authorization.
- With synthetic text in two controlled Windows clipboards, test bidirectional copying without focus, Unicode, the 256 KiB limit, simultaneous changes, and no polling after disabling or ending.
- Check forms, contenteditable regions, rich text editors, cross-origin iframes, shortcuts, selection, and IME. Record synthetic-event compatibility limits instead of treating all browser interactions as supported.
- Test Windows scaling, minimization, display changes, moving tabs out of the authorized window, and unsupported internal pages.
- Run 30-minute sessions and measure CPU, memory, video bandwidth, frame rate, and interaction latency against the MVP under the same workload. Targets are under 300 ms interaction latency on LAN and text synchronization within 1.5 seconds. These targets are not measured results.
- Repeat signaling interruption between two computers; interrupt the direct link and verify that a fresh connection attempt is required.

Local automation does not replace visible-browser validation, multi-computer testing, performance measurements, or store review.
