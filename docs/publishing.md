# Publishing to Chrome Web Store

## Delivery status

Release 0.7.0 adds automatic English/Spanish language selection and a local **Settings → Language** preference. It retains **https://ghostpair-3c9f3903aad3.herokuapp.com** as the official signaling origin. That service's `/health` and `/ready` endpoints returned HTTP 200 on October 24, 2026; this historical check is not a fresh release verification. Saved identities, custom settings, preview behavior, peer protocol 4 and existing permissions are preserved.

The repository generates Chrome and Edge ZIPs; this publication effort targets Chrome Web Store only. GitHub Releases distributes downloadable ZIPs automatically; store submission and approval remain separate. Heroku is the active official endpoint. Complete the account, privacy and real-browser gates below before submitting; a healthy endpoint and a valid ZIP do not establish those external checks. Do not announce a Chrome Web Store listing that does not exist.

The publisher/operator is **Thomas Serna**, **Colombia**, with support and privacy contact **xthoms321@gmail.com**. GhostPair is a free personal project. Its public privacy URL is [GhostPair privacy](https://thomasserna.github.io/GhostPair/privacy.html); the signaling service also serves the same source document at `/privacy`. Verify the deployed copies before submission.

## Automatic GitHub releases

Every branch push and pull request runs installation, type checking, unit tests, production compilation and store-package validation. The **CI required** check fails unless verification succeeds. Production compilation uses the public defaults in `.env.production`; CI packages that exact build once and retains its ZIPs as an Actions artifact for 14 days.

Only a successful push to `main` can publish a release. The version comes from `apps/extension/package.json`; the packager requires matching versions in the root package, signaling package, protocol package and built manifest. A new version creates tag `v<version>` at the tested commit, automatic release notes, and `ghostpair-chrome-<version>.zip` plus `ghostpair-edge-<version>.zip`. The initial automated release is **v0.5.0**. Later commits with that version leave the release and its assets unchanged. Pushes to other branches and pull requests only validate and retain artifacts.

To release the next version, update all workspaces and the root package without creating tags, then update the manifest to the same version. For example:

```powershell
npm.cmd version 0.7.0 --workspaces --include-workspace-root --no-git-tag-version
node --input-type=module -e "import fs from 'node:fs'; const path = 'apps/extension/public/manifest.json'; const manifest = JSON.parse(fs.readFileSync(path, 'utf8')); manifest.version = '0.7.0'; fs.writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n');"
```

Commit the updated package files, `package-lock.json` and manifest together on `main`, then push. CI creates the tag and release after verification; no manual tag, personal access token, or version bump on ordinary commits is needed. This does not change branch protection or require a pull request for direct work on `main`.

Write the version's changes in `docs/releases/<version>.md`. The publisher includes those notes before the installation instructions and GitHub's automatic notes. Versions without a notes file retain the installation instructions and automatic notes. [0.7.0 notes](releases/0.7.0.md) cover English/Spanish detection and saved language preferences; [0.6.6 notes](releases/0.6.6.md) cover SPA navigation, clipboard/viewer fixes and extension cleanup; [0.6.5 notes](releases/0.6.5.md) cover the Heroku default and store preparation; [0.6.4 notes](releases/0.6.4.md) cover first-use sharing after permission approval; [0.6.3 notes](releases/0.6.3.md) cover the audit simplifications; [0.6.2 notes](releases/0.6.2.md) cover connection-code visibility and preview timing; [0.6.1 notes](releases/0.6.1.md) cover the native popup sizing fix and refreshed GitHub Pages previews; [0.6.0 notes](releases/0.6.0.md) document the redesigned sharing and connection flows.

Publication is serialized by version. It creates a draft, uploads both verified ZIPs with checksum checks, then publishes. To recover from an interrupted upload, rerun the original **Publish extension release** job while its Actions artifact remains available; matching completed assets are retained. A draft or existing tag from a different commit fails instead of moving the tag or overwriting assets. Fix that original run or publish a new version. Published releases are never modified by reruns. If artifacts have expired, use a new version and a fresh CI run.

### Install a downloaded ZIP

1. Download the Chrome or Edge ZIP from [Releases](https://github.com/ThomasSerna/GhostPair/releases), not GitHub's source-code archive.
2. Extract it into a permanent folder. Open `chrome://extensions` or `edge://extensions` and enable **Developer mode**.
3. Choose **Load unpacked** and select the extracted folder containing `manifest.json`.
4. For updates, replace files in the same folder and click **Reload**. Keep that folder and avoid uninstalling to retain settings and identity. Update both session participants together.

## Preparation

1. Register a new [Chrome Web Store developer account](https://developer.chrome.com/docs/webstore/register), accept its agreement, and pay the one-time registration fee. The current fee is USD 5, also documented in [Google's publisher-account announcement](https://developer.chrome.com/blog/cws-role-expansion-developer-dashboard). Complete payment directly in Google's dashboard; keep payment and identity documents out of this repository.
2. Enable [Google 2-Step Verification](https://developer.chrome.com/docs/webstore/program-policies/two-step-verification), set the publisher name and verify the contact email in [account setup](https://developer.chrome.com/docs/webstore/set-up-account). Personally confirm the required [Trader or Non-Trader declaration](https://developer.chrome.com/docs/webstore/program-policies/trader-verification-faq); a free personal project is not an automatic legal classification. A Trader verification can require legal identity, address and an SMS-capable phone, with those trader details displayed publicly. A verified-publisher website badge is separate from these requirements.
3. Complete the production verification in [Heroku operations](heroku.md) before submitting for review. `.env.production` and the official preset use `https://ghostpair-3c9f3903aad3.herokuapp.com` with external STUN. Both participants must use the same service. Saved **Custom server** settings survive builds and require an explicit change; choose **GhostPair server** and **Save** to restore the new official preset.
4. Deploy the updated privacy document to GitHub Pages and the signaling service, then verify both live copies. The October 24, 2026 CLI check confirmed Cedar, no log drains and no PGBackups schedules or backups. Configure and test backup recovery, verify the deletion procedure, and update the policy if retention settings change. Do not submit while the live copy still names Render or differs from the actual configuration.
5. Run `npm ci`, `npm run typecheck`, `npm test`, browser checks, PostgreSQL/container checks, and `npm run package:store`. The store command validates effective Vite production configuration, builds fresh assets, checks recorded defaults and produces both ZIPs. It rejects loopback/private-address literals, reserved/placeholder domains, credentialed URLs and non-HTTPS signaling. It checks configuration shape, not public-service health. `npm run package` remains available for development endpoints.
6. Upload the freshly verified `dist/packages/ghostpair-chrome-<version>.zip` to a draft Chrome listing. Fill Store listing, Privacy practices, Distribution and Test instructions using the text below, [store assets](store/README.md), real contact information and privacy URL. Every valid Chrome extension ID is accepted by the server; no server ID allowlist change is needed. Do not claim the ZIP's version or endpoint matches production without inspecting that exact build.
7. Run the real-browser and two-computer checks in [Validation](validation.md), using the official Heroku endpoint. Give reviewers instructions for connecting two installations with synthetic data and fresh short-lived credentials. Never provide a permanent password or an unattended production session.
8. Submit for review only after the preceding requirements are satisfied. Prefer [deferred publication](https://developer.chrome.com/docs/webstore/publish#deferred_publishing_option), then manually publish once approved and the service is healthy. Approved staged submissions expire after 30 days. Store acceptance and timing remain Google's decision; there is no automatic store-publishing workflow in this repository.

Moving from an unpacked installation to Chrome Web Store can change the extension ID and creates separate local storage; existing local settings and connection codes are not automatically transferred. Identities are also keyed by the exact signaling URL, so changing from Render to a Heroku origin creates a new local identity even if server registrations are migrated. Preserve database records, but do not promise old connection codes for a different origin. No identity export/import feature is included in this preparation.

## Proposed listing

**Name:** GhostPair

**Category:** Productivity.

**Languages:** English and Spanish in the extension. Browser language is selected automatically, with an optional local preference in Settings. The public website and prepared listing text remain in English.

**Price:** Free.

**Support:** xthoms321@gmail.com; [GitHub issues](https://github.com/ThomasSerna/GhostPair/issues).

**Website:** [GhostPair](https://thomasserna.github.io/GhostPair/).

**Privacy policy:** [GhostPair privacy](https://thomasserna.github.io/GhostPair/privacy.html).

**Short description:** Share and control tabs with another person through an authorized P2P connection.

**Description:** GhostPair connects two browsers for collaboration. Choose **Share my tab**, set a password, and share your connection code with the other person. The code also appears inside the **Share your tab** setup panel before a session starts. They choose **Join a session** and enter the code and password. Authorize each tab locally to share its video. Sessions start in **Preview changes**: preview typing and choices without changing original form values. The person sharing can edit, copy, cut, paste and move preview text between supported fields. Text and other previews have independent durations under **Advanced options** → **Interaction feedback**: 0.5 seconds by default, configurable from 0.1 to 10 seconds or **Until cleared**. Select **Full control** to enable basic page clicks and typing; scrolling and extension navigation remain real. The other person can navigate and manage tabs in the shared window; new tabs wait for your approval before sharing. Pause, block control, stop sharing a tab, or end the session from the extension. Native browser capture indicators remain visible.

Video and interactions travel directly over WebRTC. Signaling and STUN help establish the connection. There is no TURN relay, so some networks are incompatible. Optional clipboard synchronization shares new Windows clipboard text when both participants enable it. Audio, files, and desktop control are not included. Some complex pages cannot be controlled through DOM interactions.

## Submission gates

- New Chrome publisher account registration/payment, contact verification, 2FA and the publisher's own Trader/Non-Trader declaration completed.
- Active Heroku HTTPS endpoint and PostgreSQL verified, public STUN/network connectivity and backup restoration checked; both live privacy copies updated to the deployed configuration and verified retention.
- A Chrome ZIP rebuilt for that active endpoint, successful CI and the real-browser/network checks in [Validation](validation.md).
- Final listing and accurate Privacy practices declarations, screenshots reviewed for that release, and temporary reviewer instructions.

The prepared listing and screenshots do not remove these gates. No Chrome Web Store submission, Heroku account verification or deployment is performed by the package/release scripts. Edge Add-ons submission is outside this work; existing Edge ZIP generation remains available.

## Reviewer walkthrough

Install the reviewed package in two separate profiles or computers. Choose **Share my tab**, check the small **Your connection code** text inside the **Share your tab** setup panel, then use a fresh temporary password and authorize one ordinary HTTPS tab. On the second installation, choose **Join a session** and enter the displayed **Connection code** and password. Confirm **Preview changes**, local preview text editing, 0.5-second defaults, independent durations configurable up to 10 seconds, persistent button/choice/text previews with **Until cleared**, circle-only radio marking, and unchanged original values. Switch to **Full control** to test a basic synthetic form. Verify pause, control withdrawal, tab authorization and termination. **Share clipboard** is optional and requires both participants; local copy/paste inside preview fields works independently. Use synthetic data and temporary credentials, never an unattended permanent session.

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

**Single purpose:** Let two consenting participants view and interact with locally authorized browser tabs in a direct collaboration session, with optional text clipboard synchronization.

In the dashboard, disclose **Website content** (captured tab video and optional clipboard text), **Web history** (titles and URLs of tabs in the shared window, including tabs awaiting capture approval), **Authentication information** (temporary session passwords and installation ownership credentials), **User activity** (page interaction commands), and **Personally identifiable information** (installation identifiers and IP addresses). Explain the specific scope above rather than claiming general browsing-history collection. Page content and clipboard text can include personal or sensitive information chosen by the participants. P2P transmission and local-only processing are still data handling; do not select a claim that the product processes no data.

Select **No remotely hosted code**: all executable extension logic ships in the package. HTTPS/WSS signaling, STUN and WebRTC exchange data and connection information; they do not fetch executable code. Complete all Limited Use certifications only after checking they match the implementation and operator's actual practice. No data sale, advertising, creditworthiness use or use outside the collaboration features is planned or implemented.

All scripts ship in the package; there is no remotely hosted JavaScript, advertising, or content telemetry. The privacy policy and store declarations must match the operator's actual configuration, including infrastructure log retention and identity storage.

### Operational deletion checklist

Use the support process in the privacy policy to verify control through a temporary host session for the requested code. Never ask for owner tokens, password hashes, session passwords or browser-storage exports by email. Within 30 days after ownership verification, manually delete only that registration from the active database and confirm the result without copying credentials into tickets or logs. There is no new public deletion API. Explain that the browser still has its old identity: before using the service again, the user must end the session and clear GhostPair's extension data or reinstall, losing local settings and receiving a new code. Resetting connection settings alone does not clear the stored identity.

Record only the deleted identifier and date in a private deletion register while relevant older backups exist. Reapply those deletions before serving any restored database. For every manual backup or migration export, record its creation date and deletion deadline: delete it after successful validation and no later than 30 days after creation. Provider backup-count limits do not enforce this time limit. Scheduled copies age out under the provider's configured retention; track this instead of promising immediate removal from all backups. Remove the minimal deletion register entries when all corresponding older backups are gone. These are operator checklists, not automated retention or evidence that cleanup has already occurred.

## Store images

Use the three 1280×800 PNGs described in [store assets](store/README.md). They show the packaged extension's real interface with synthetic data, not the landing-page demo. Review them against the release submitted after Heroku activation and regenerate any that no longer match.

Chrome requires the 128×128 PNG extension icon and at least one screenshot (up to five); screenshots must be 1280×800 or 640×400. The existing package supplies the icon. Optional 440×280 promotional and 1400×560 marquee images are not included in this first-publication preparation. Local screenshots do not establish native Windows permission/capture indicators, real clipboard behavior or connectivity between networks.

Official references: [publishing and deferred publication](https://developer.chrome.com/docs/webstore/publish), [privacy fields and permission justification](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy), [user-data handling, including local processing](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), and [image requirements](https://developer.chrome.com/docs/webstore/images).
