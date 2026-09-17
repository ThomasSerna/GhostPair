# GhostPair

Authorized collaboration between two browsers: share tabs, control basic page interactions, manage tabs, and synchronize clipboard text. A Manifest V3 extension for Chrome and Edge on Windows.

The host starts each session from the extension, chooses a password, and authorizes each shared tab locally. The guest enters the host's fixed address and password in the full-page connection screen. Video, control, and clipboard text travel directly over WebRTC. The server authenticates and coordinates the connection; STUN helps establish a direct route. There is no TURN relay or automatic reconnection after restarting the browser.

## Development

Requirements: Node.js 24.13 or later and npm. In PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.

```powershell
npm.cmd ci
Copy-Item .env.example .env
npm.cmd run build
```

1. Open `chrome://extensions` or `edge://extensions`, enable developer mode, and load `dist/extension` as an unpacked extension.
2. Copy the browser's extension ID into `ALLOWED_ORIGINS` in the root `.env`. Use exact `chrome-extension://ID` origins, separated by commas, for all participating installations. This ID is separate from the GhostPair address assigned to each profile.
3. Run `npm.cmd run dev:server`. The server automatically loads the root `.env`; shell or deployment variables take precedence. A missing file is allowed when configuration is injected. Invalid configuration prevents startup with an explanatory error.
4. For local tests, keep `VITE_SIGNALING_URL=http://127.0.0.1:8787`. Both browsers must use the same signaling server. Settings are available from the popup and the guest connection page.
5. On an HTTP/HTTPS page, invoke GhostPair from the browser toolbar, choose a password of 8–256 characters, confirm the sharing scope, and select **Share current tab →**. Approve the requested permissions and share your GhostPair address and password with your guest.
6. In another isolated profile or computer, select **Connect to a host ↗** to open the full-page connection screen. Enter the host's address and password. For internet connections, deploy HTTPS signaling first as described below.

`127.0.0.1` always refers to the computer running that browser, not a server on another computer. HTTP signaling is permitted only on loopback for development.

```powershell
npm.cmd run dev:extension  # Rebuild on edits; reload the extension in the browser.
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:browser
npm.cmd run test:frames
npm.cmd run test:questionnaires
npm.cmd run test:visual
npm.cmd run package
```

Packages are written to `dist/packages/`. Packages built with local endpoints are for development. Configure production endpoints and follow [Publishing](docs/publishing.md) before submitting to stores.

### Environment and saved settings

The signaling server loads the root `.env`; Vite also reads its environment files from that root, including when launched through npm workspaces. Only public `VITE_*` values are exposed to extension code. Never put secrets in a `VITE_*` variable. Vite also supports root `.env.local` and mode-specific files; process environment variables have priority.

`VITE_SIGNALING_URL` and `VITE_STUN_URLS` provide the extension's build defaults. Manually saved settings survive new builds. Select **Use build defaults** to remove those overrides. After changing public environment values, rebuild and reload the extension. Changing signaling servers uses a separate identity for that server.

`DATABASE_PATH` keeps its existing working-directory-relative behavior. The npm signaling workspace resolves `./data/ghostpair.sqlite` under `apps/signaling`; a direct launch from another directory resolves it there. Use an absolute path when the launch directory can change. Loading `.env` does not move an existing database.

## Using a session

Version 0.4.0 uses peer protocol 4 for visual simulation and interaction revisions. Update both participants together; saved addresses, identities and settings are preserved.

- **Authorization:** a session is limited to one host window. Capture and control require local authorization for each tab by invoking the extension on that tab. Up to five authorized tabs can be retained; release a tab before adding another at the limit. Only the active authorized tab is transmitted. The address bar, other windows, and desktop are not captured.
- **New tabs:** guests can manage tabs in the authorized window. A remotely opened tab is marked **Awaiting host approval** until the host invokes the extension on it and authorizes sharing. The integrated **Open tab** dialog accepts a URL or domain name; domains default to HTTPS.
- **Visual simulation (default):** Each session starts in **Visual only**. Both participants see simulated clicks, button presses, checkbox/radio choices and text on a separate presentation layer. Page values, focus and click/keyboard/input handlers are untouched. Links and buttons do not navigate or advance forms in this mode. Scrolling, GhostPair navigation/tab controls and optional clipboard synchronization remain real. The host can select **Live control** from **Interaction mode** during the session.
- **Simulation preferences:** Configure preferences in Settings before hosting or in the host menu during a session. Choose **Until cleared** (default) or **Temporary**, with 0.1–30 seconds of inactivity in steps of 0.1 (initially 3). Choose purple (default), blue, green, orange, pink or a custom color; changing color preserves existing previews. **Clear simulation** removes all previews. **Simulation notices** are off by default; enabled notices last 1.5 seconds and appear at most once every 3 seconds. These preferences save automatically and survive restarts independently of connection settings. Preview text is kept only in memory and is cleared on navigation, tab/mode changes, pause, control withdrawal or session end. Escape releases keyboard capture while preserving previews.
- **Page-aware appearance:** Text previews follow the page's fonts, spacing, individual borders, rounded corners and solid or translucent background colors. Checkbox/radio previews adapt to visible controls and clearly associated option labels/cards, keeping their text visible. Purple or your selected color remains the simulation accent. Theme and layout changes update existing previews. This is approximate styling, not a site-specific DOM clone: complex editors, background images, arbitrary pseudo-elements and closed widgets may differ from the original.
- **Live control:** DOM clicks, focus, Unicode editing, scrolling, and browser navigation are supported, including permitted same-origin and cross-origin embedded frames. Canvas and SVG surfaces receive synthetic pointer, click and wheel events. The guest has a navigation bar and tab selector. Press Escape to release keyboard capture. Input is temporarily disabled while a different tab, main document, zoom level, or viewport is being presented. Loading an embedded page keeps the current video available.
- **Questionnaires:** select checkbox/radio answers and activate buttons, including buttons containing several elements. Space activates focused checkboxes and buttons; arrows move radio selection and single-select options. Enter uses the form's default submit button and preserves validation. Disabled controls and canceled actions remain respected. Native select popups and multiple-selection keyboard behavior are outside this support.
- **Interrupted input:** Escape, loss of focus, hiding the viewer and pointer cancellation release input without generating a completion click. Congestion or send failure ends the session with an error instead of silently discarding an action. Reconnect explicitly after such a failure.
- **Session controls:** activity appears inside the extension interface. The toolbar keeps its normal icon and name, with no activity badge or sharing tooltip. Native browser capture indicators remain enabled. The host can pause, withdraw control, release a tab, or end the session. The default stop shortcut is `Ctrl+Shift+9`, configurable in extension shortcuts.
- **Guest connection page:** disconnecting, host termination, and connection errors return to the form in the same page. The host address is retained for that page session; the password is cleared after each attempt. Closing or reloading the guest page ends its connection and requires a new connection attempt.
- **Clipboard:** disabled until both participants enable it. It synchronizes new Windows clipboard text, including text copied in other applications, approximately every 500 ms. Existing contents are not sent on activation. The limit is 256 KiB of UTF-8; images and files are excluded. Changes between polls may be missed.
- **Fixed address:** belongs to the installation/profile and configured server. Chrome and Edge can have different addresses. Clearing extension data or uninstalling removes local credentials.

## Deployment

Docker Compose includes Node.js signaling, persistent SQLite, Caddy for HTTPS/WSS, and coturn in STUN-only mode. Use a domain pointing to the server and allow TCP 80/443 and UDP/TCP 3478.

For a new deployment, copy `deploy/.env.example` to the root `.env`. If `.env` already exists, merge deployment values instead of overwriting it. Set `SIGNAL_DOMAIN`, exact `ALLOWED_ORIGINS`, and public extension endpoints:

```dotenv
SIGNAL_DOMAIN=connect.example.com
VITE_SIGNALING_URL=https://connect.example.com
VITE_STUN_URLS=stun:connect.example.com:3478
```

```powershell
docker compose --env-file .env up -d --build
npm.cmd run package
```

Do not expose container port 8787 directly. Use `TRUST_PROXY=true` only behind a controlled proxy; Caddy supplies the IP used for rate limiting. Back up the `identities` volume: losing it invalidates registered identities. Stop signaling or use SQLite's backup API for a consistent backup.

`GET /health` reports availability without session content. The server does not log message bodies or passwords. Monitor process health, memory, disk capacity, and connection failures; do not enable payload logging in the proxy.

## Limitations

Capture uses `chrome.tabCapture` and WebRTC video. The package contains no extension debugger permission or calls. Native capture indicators and permission prompts remain enabled. See [Validation](docs/validation.md) for the synthetic performance comparison and the pending inspection of browser indicators.

Live control uses synthetic DOM events, which pages can distinguish from trusted browser input. Basic forms and text work are the intended scope. Embedded frame routing supports nesting, borders, scrolling and positive axis-aligned scaling. Frame rotation, skew, perspective, restricted or opaque surfaces, trusted-input requirements, native pointer capture and cross-frame native drag-and-drop are unsupported. Complex editors and IME composition can still have limitations. A frame that Chrome denies access to remains unavailable without disabling the rest of the page. Audio, DRM playback, desktop control, browser chrome, internal pages, extension stores, local files, incognito, native menus, and file pickers are unsupported. The clipboard adapter uses deprecated `execCommand` for compatibility.

Version 0.4.0 adds no permissions. Reload both unpacked extensions after rebuilding for peer protocol 4. Existing installation identities remain valid. The extension does not use `chrome.debugger`; eliminating its own activity indicators does not hide native browser capture indicators. In Live control, pages that reject synthetic events through `Event.isTrusted` remain unsupported. Visual only can preview interactions on accessible protected pages without executing their actions or bypassing that requirement. The improvements above do not bypass that restriction or establish compatibility with an unspecified real site.

Visual previews approximate native fields, basic contenteditable, buttons and choices; complex editors, arbitrary application state and inaccessible frames are not simulated. Unknown targets receive a click halo only. Overlay nodes are visible presentation additions to the shared document; they do not rewrite original controls.

Revoking required permissions, canceling native capture, or ending a session stops capture, input, and clipboard synchronization. A native cancellation requires a new session and fresh local authorization. Enterprise policies can prevent capture or control. Minimization and display changes require the manual validation listed below.

Without TURN, some networks cannot connect. A missing direct route produces an error after 30 seconds. Participants trust signaling to authenticate pairing; this design does not authenticate a participant independently of a compromised signaling server. Both peers must run the same supported protocol version after migration; existing installation identities remain valid.

See [Validation](docs/validation.md) for executed evidence and pending checks, [Architecture](docs/architecture.md) for implementation details, and [Publishing](docs/publishing.md) for store preparation.
