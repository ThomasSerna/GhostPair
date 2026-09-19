# Publishing to Chrome and Edge

## Delivery status

Release 0.5.0 retains peer protocol 4 and the existing permission set. Both Chrome and Edge are targeted.

The repository generates separate Chrome Web Store and Edge Add-ons packages. Producing a ZIP does not publish an extension or imply store approval. Complete the real-browser checks in [Validation](validation.md), production deployment, and publisher information before submission.

## Preparation

1. Obtain Google and Microsoft developer accounts, an HTTPS domain, and a monitored support email address.
2. Follow [Portable deployment](deployment.md) for Koyeb/PostgreSQL or another host and choose an external STUN endpoint. Configure `VITE_SIGNALING_URL` and `VITE_STUN_URLS` in root `.env` before `npm run package:store`. Existing manually saved settings require **Use build defaults** to adopt a new build's defaults.
3. Complete publisher fields in `docs/privacy.html`. Node (and the optional Caddy proxy) serves that page at `https://DOMAIN/privacy`.
4. Run `npm ci`, `npm run typecheck`, `npm test`, browser checks, PostgreSQL/container checks, and `npm run package:store`. The store command validates the effective Vite production configuration, builds fresh assets, checks the recorded build defaults and produces both ZIPs. It rejects loopback/private-address literals, reserved/placeholder domains, credentialed URLs and non-HTTPS signaling. It checks configuration shape, not whether a domain actually hosts a working service; the public service must be verified separately. `npm run package` remains available for development endpoints.
5. Register store listings and allow their final extension IDs in `ALLOWED_ORIGINS`. Test packages with those IDs before final submission.
6. Upload `dist/packages/ghostpair-chrome-0.5.0.zip` and `ghostpair-edge-0.5.0.zip` to the appropriate accounts. Include real screenshots, privacy policy, and contact details. Peer protocol 4 is unchanged; saved addresses and settings survive the update.
7. Give reviewers instructions for connecting two installations. Do not provide a permanent password or an unattended production session.

## Proposed listing

**Name:** GhostPair

**Short description:** Share and control tabs with another person through an authorized P2P connection.

**Description:** GhostPair connects two browsers for collaboration. Start a session, choose a password, and share your GhostPair address with a guest. Authorize each tab locally to share its video. Sessions start in Visual only: preview typing and choices without changing original form values. The host can edit, copy, cut, paste and move simulated text between supported fields. Text and other previews have independent persistent or temporary durations. Select Live control to enable basic page clicks and typing; scrolling and extension navigation remain real. Your guest can navigate and manage tabs in the shared window; new tabs wait for your approval before sharing. Pause, withdraw control, release a tab, or end the session from the extension. Native browser capture indicators remain visible.

Video and interactions travel directly over WebRTC. Signaling and STUN help establish the connection. There is no TURN relay, so some networks are incompatible. Optional clipboard synchronization shares new Windows clipboard text when both participants enable it. Audio, files, and desktop control are not included. Some complex pages cannot be controlled through DOM interactions.

## Release prerequisites still to supply

- Final Chrome and Edge listing IDs and exact server allowlist.
- Stable HTTPS service domain and a verified public STUN configuration.
- Publisher/operator name, country, monitored support email and privacy URL.
- Actual identity, log and backup retention periods and a deletion process.
- Final store screenshots and the manual browser/network checks in [Validation](validation.md).

The repository does not invent these facts or create publisher accounts. Current ZIPs built with development defaults must not be submitted. A successful ZIP build is not store submission or approval.

## Reviewer walkthrough

Install the reviewed package in two separate profiles or computers. Start a host session with a fresh temporary password, authorize one ordinary HTTPS tab, and connect the guest using the displayed GhostPair address. Confirm Visual only previews, host text editing, independent durations, circle-only radio marking, and unchanged original values. Switch to Live control to test a basic synthetic form. Verify pause, control withdrawal, tab authorization and termination. Clipboard synchronization is optional and requires both participants; local copy/paste inside simulated fields works independently. Use synthetic data and temporary credentials, never an unattended permanent session.

## Permission rationale

| Permission | Specific use |
| --- | --- |
| `tabCapture` | Capture video from a tab after the host invokes the extension on it. |
| `activeTab` | Associate a local extension invocation with the tab the host intends to share. |
| `scripting` | Install the scoped DOM interaction handler in an authorized shared document. |
| `webNavigation` | Identify embedded documents and their parents, and retire stale control routes when those documents navigate. |
| `tabs` | Identify and manage tabs in the consented host window. |
| `storage` | Keep installation identity and settings, without browsing history or session passwords. |
| `offscreen` | Retain host capture streams, WebRTC, and the clipboard adapter while the popup is closed. |
| `clipboardRead`, `clipboardWrite` (optional) | Synchronize new text when both participants enable it. |
| HTTP/HTTPS host access (optional) | Access the signaling service and install DOM controls on authorized pages. Granting web access does not automatically authorize capture of other tabs. |

The production extension does not request `debugger`. Browser test tooling may use a separate debugging connection to drive isolated browsers; that tooling is not packaged with the extension.

Questionnaire compatibility covers tested DOM activation and keyboard defaults. Do not advertise trusted input, bypass of protected forms, native select menus or invisible browser capture. Sites requiring `Event.isTrusted` remain unsupported.

## Data disclosures

Disclose processing of shared page content, browsing information needed to show tabs, authentication data, and installation identifiers. P2P transmission is still data processing. Describe clipboard synchronization and IP addresses visible to peers and connection infrastructure. Do not claim that the product processes no data.

All scripts ship in the package; there is no remotely hosted JavaScript, advertising, or content telemetry. The privacy policy and store declarations must match the operator's actual configuration, including infrastructure log retention and identity storage.

## Required screenshots

- Host sharing controls and consent, using synthetic data.
- An authorized tab and a tab awaiting host approval.
- The full-page guest connection form and an active remote view.
- Pause, termination, and clipboard controls.

Headless screenshots do not verify native Windows capture indicators. Capture final listing images after manual validation.

Official references: [Chrome Web Store publishing](https://developer.chrome.com/docs/webstore/publish), [data disclosure requirements](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements), and [Edge publishing](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension).
