# Publishing to Chrome and Edge

## Delivery status

The repository generates separate Chrome Web Store and Edge Add-ons packages. Producing a ZIP does not publish an extension or imply store approval. Complete the real-browser checks in [Validation](validation.md), production deployment, and publisher information before submission.

## Preparation

1. Obtain Google and Microsoft developer accounts, an HTTPS domain, and a monitored support email address.
2. Deploy signaling and STUN. Configure `VITE_SIGNALING_URL` and `VITE_STUN_URLS` in root `.env` before `npm run package`. Existing manually saved settings require **Use build defaults** to adopt a new build's defaults.
3. Complete publisher fields in `docs/privacy.html`. Caddy serves that page at `https://DOMAIN/privacy`.
4. Run `npm ci`, `npm run typecheck`, `npm test`, browser checks, and `npm run package`.
5. Register store listings and allow their final extension IDs in `ALLOWED_ORIGINS`. Test packages with those IDs before final submission.
6. Upload `dist/packages/ghostpair-chrome-0.2.0.zip` and `ghostpair-edge-0.2.0.zip` to the appropriate accounts. Include real screenshots, privacy policy, and contact details.
7. Give reviewers instructions for connecting two installations. Do not provide a permanent password or an unattended production session.

## Proposed listing

**Name:** GhostPair

**Short description:** Share and control tabs with another person through an authorized P2P connection.

**Description:** GhostPair connects two browsers for collaboration. Start a session, choose a password, and share your GhostPair address with a guest. Authorize each tab locally to share its video and enable basic clicks, typing, and scrolling. Your guest can navigate and manage tabs in the shared window; new tabs wait for your approval before sharing. Pause, withdraw control, release a tab, or end the session from the extension. Native browser capture indicators remain visible.

Video and interactions travel directly over WebRTC. Signaling and STUN help establish the connection. There is no TURN relay, so some networks are incompatible. Optional clipboard synchronization shares new Windows clipboard text when both participants enable it. Audio, files, and desktop control are not included. Some complex pages cannot be controlled through DOM interactions.

## Permission rationale

| Permission | Specific use |
| --- | --- |
| `tabCapture` | Capture video from a tab after the host invokes the extension on it. |
| `activeTab` | Associate a local extension invocation with the tab the host intends to share. |
| `scripting` | Install the scoped DOM interaction handler in an authorized shared document. |
| `tabs` | Identify and manage tabs in the consented host window. |
| `storage` | Keep installation identity and settings, without browsing history or session passwords. |
| `offscreen` | Retain host capture streams, WebRTC, and the clipboard adapter while the popup is closed. |
| `clipboardRead`, `clipboardWrite` (optional) | Synchronize new text when both participants enable it. |
| HTTP/HTTPS host access (optional) | Access the signaling service and install DOM controls on authorized pages. Granting web access does not automatically authorize capture of other tabs. |

The production extension does not request `debugger`. Browser test tooling may use a separate debugging connection to drive isolated browsers; that tooling is not packaged with the extension.

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
