import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "../components/Icons";
import "./installation.css";

const releases = "https://github.com/ThomasSerna/GhostPair/releases/latest";
const officialServer = "https://ghostpair.onrender.com";
const officialStun = "stun:stun.l.google.com:19302";
const chapters = [
  ["install-extension", "Install the extension"],
  ["connection-settings", "Connection settings"],
  ["first-session", "Your first session"],
  ["self-hosting", "Host your own server"],
  ["updates-help", "Updates & troubleshooting"],
];

function Copy({ value, label = "Copy command" }: { value: string; label?: string }) {
  const [status, setStatus] = useState("");
  const [fallback, setFallback] = useState(false);
  useEffect(() => { setStatus(""); setFallback(false); }, [value]);
  return <span className="guide-copy">
    <button type="button" className="guide-quiet" aria-label={label} onClick={async () => {
      try { await navigator.clipboard.writeText(value); setStatus("Copied"); setFallback(false); }
      catch { setStatus("Copy unavailable. Select the text below."); setFallback(true); }
    }}>{label}<Icon name="copy" /></button>
    <span className={status ? "guide-copy-status" : "sr-only"} role="status">{status}</span>
    {fallback && <label className="guide-copy-fallback">Copy manually<textarea aria-label={label + " manually"} readOnly value={value} onFocus={event => event.currentTarget.select()} /></label>}
  </span>;
}

function Command({ value }: { value: string }) {
  return <div className="guide-command"><pre><code>{value}</code></pre><Copy value={value} /></div>;
}

function Chapter({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section id={id} className="guide-chapter" aria-labelledby={id + "-title"}><h2 id={id + "-title"}>{title}</h2>{children}</section>;
}

function SelfHosting() {
  return <details id="self-hosting" className="guide-disclosure guide-hosting">
    <summary><span>Host your own server<small>Optional · Docker / VPS</small></span><Icon name="plus" /></summary>
    <div className="guide-disclosure-content">
      <p>A public domain, a VPS with Docker Engine and the Compose plugin, and a usable direct route between browsers are required. The commands below use <code>pair.example.org</code>; replace it with your domain.</p>
      <ol className="guide-technical-steps">
        <li><h3>Point your domain to the VPS</h3><p>Create a DNS A record for the VPS public IPv4. If you also publish an AAAA record, serve the domain on that IPv6 address.</p><Command value={"git clone https://github.com/ThomasSerna/GhostPair.git\ncd GhostPair"} /></li>
        <li><h3>Prepare the environment</h3><p>For a new deployment, copy the template to the repository root. This command preserves an existing file:</p><Command value="test -f .env || cp deploy/.env.example .env" /><p>Merge the following values into <code>.env</code>, preserving its other entries:</p><Command value={"SIGNAL_DOMAIN=pair.example.org\nVITE_SIGNALING_URL=https://pair.example.org\nVITE_STUN_URLS=stun:pair.example.org:3478"} /><p><code>SIGNAL_DOMAIN</code> configures Caddy. The <code>VITE_*</code> values are public build defaults; released ZIPs can use <strong>Custom server</strong> without rebuilding. Keep credentials out of public build values.</p></li>
        <li><h3>Start the services</h3><p>Open TCP 80/443 for Caddy and UDP/TCP 3478 for STUN. Keep signaling port 8787 private.</p><Command value="docker compose --env-file .env up -d --build" /><dl className="guide-service-list"><dt>Caddy</dt><dd>HTTPS / WSS and a controlled proxy.</dd><dt>Signaling</dt><dd>Coordinates pairing; TRUST_PROXY is enabled behind Caddy.</dd><dt>SQLite</dt><dd>The base Compose configuration stores identities in the persistent <code>identities</code> volume.</dd><dt>coturn</dt><dd>STUN only. This configuration provides no TURN relay.</dd></dl></li>
        <li><h3>Check the real deployment</h3><Command value={"curl --fail https://pair.example.org/health\ncurl --fail https://pair.example.org/ready"} /><p><code>/health</code> checks process liveness; <code>/ready</code> also checks identity storage. A healthy signaling server does not guarantee a direct WebRTC route. Restricted networks may still fail to connect.</p></li>
        <li><h3>Configure both extensions</h3><p>End active sessions. In each browser, open Settings, choose <strong>Custom server</strong>, enter these values and press <strong>Save</strong>:</p><dl className="guide-preset"><dt>Connection server</dt><dd><code>https://pair.example.org</code></dd><dt>STUN servers</dt><dd><code>stun:pair.example.org:3478</code></dd></dl><p>Both participants must use the same server. Each installation keeps a separate identity per server, so use the host’s current connection code after switching.</p></li>
      </ol>
      <div className="guide-maintenance"><h3>Storage and maintenance</h3><p>Base <code>compose.yaml</code> uses SQLite. Production Render uses PostgreSQL. The optional <code>compose.postgres.yaml</code> override reads a private <code>DATABASE_URL</code> and defaults to <code>DATABASE_SSL_MODE=verify-full</code>; do not put database credentials in <code>VITE_*</code>.</p><p>Run one signaling instance and back up identity storage. For SQLite, stop signaling before copying the <code>identities</code> volume or use SQLite’s backup API. Losing identity storage invalidates registered identities. Monitor readiness, memory and disk space; avoid payload logging in the proxy.</p></div>
    </div>
  </details>;
}

export default function InstallationPage() {
  const [browser, setBrowser] = useState("chrome");
  useEffect(() => {
    const reveal = () => {
      let target: HTMLElement | null = null;
      try { target = document.getElementById(decodeURIComponent(location.hash.slice(1))); }
      catch { return; }
      const disclosure = target?.closest("details");
      if (!disclosure) return;
      disclosure.open = true;
      requestAnimationFrame(() => { disclosure.scrollIntoView({ behavior: "instant", block: "start" }); });
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, []);
  return <main id="main" tabIndex={-1} className="installation-page">
    <div className="guide-intro wrap"><h1>Install GhostPair</h1><div><p>Install in both browsers, then invite someone to your tab.</p><span>Chrome &amp; Edge on Windows</span><a className="guide-primary" href={releases}>Download GhostPair <Icon name="arrow" /></a></div></div>
    <div className="guide-layout wrap">
      <aside className="guide-index"><nav aria-label="Installation chapters"><span>In this guide</span>{chapters.map(([id, label]) => <a key={id} href={"#" + id}>{label}</a>)}<a className="guide-index-explore" href="?view=explore">Try the demo <Icon name="arrow" /></a></nav></aside>
      <div className="guide-chapters">
        <Chapter id="install-extension" title="Load it in your browser">
          <fieldset className="guide-switch"><legend className="sr-only">Browser to install in</legend>{["chrome", "edge"].map(value => <label key={value}><input type="radio" name="install-browser" checked={browser === value} onChange={() => setBrowser(value)} /><span>{value === "chrome" ? "Chrome" : "Edge"}</span></label>)}</fieldset>
          <ol className="guide-install-steps">
            <li><h3>Download the extension ZIP</h3><p>Open the <a className="guide-inline-link" href={releases}>latest release</a> and choose the package for your browser. The source code archives are not the extension.</p><div className="guide-release-file"><Icon name="download" /><code>{"ghostpair-" + browser + "-<version>.zip"}</code></div></li>
            <li><h3>Extract to a permanent folder</h3><p>Extract all files and keep the folder in a stable location. Moving or deleting it breaks the installation.</p></li>
            <li><h3>Open the extensions page</h3><p>Copy this address and open it from your browser’s address bar:</p><div className="guide-browser-address"><code>{browser + "://extensions"}</code><Copy key={browser} value={browser + "://extensions"} label="Copy address" /></div></li>
            <li><h3>Enable Developer mode and load the folder</h3><p>Turn on <strong>Developer mode</strong>, select <strong>Load unpacked</strong>, then choose the extracted folder containing <code>manifest.json</code>. Select that folder, rather than the ZIP, its parent or the <code>assets</code> subfolder.</p></li>
            <li><h3>Pin GhostPair and repeat in the other browser</h3><p>Pin it from the browser’s Extensions menu. Each participant installs GhostPair in their own browser or profile.</p></li>
          </ol>
        </Chapter>
        <Chapter id="connection-settings" title="Your connection is ready">
          <p>The release ZIPs use the <strong>GhostPair server</strong> by default. You can start a session without deploying a server or rebuilding the extension.</p>
          <dl className="guide-preset"><dt>Connection server</dt><dd><code>{officialServer}</code></dd><dt>STUN servers</dt><dd><code>{officialStun}</code></dd></dl>
          <details id="custom-server-settings" className="guide-disclosure"><summary><span>Change connection settings<small>Optional · Custom server</small></span><Icon name="plus" /></summary><div className="guide-disclosure-content"><p>End an active session before changing settings. Both participants must use the same connection server.</p><ol><li>Open GhostPair Settings.</li><li>To restore the default, choose <strong>GhostPair server</strong> and press <strong>Save</strong>.</li><li>For your own deployment, choose <strong>Custom server</strong>, fill <strong>Connection server</strong> and <strong>STUN servers</strong>, then press <strong>Save</strong> in both browsers.</li></ol><p>Use HTTPS for a public server, or HTTP on localhost. Remove URL credentials, query parameters and fragments. Enter one to five STUN addresses starting with <code>stun:</code> or <code>stuns:</code>, separated by commas or new lines.</p><a className="guide-text-link" href="#self-hosting">Set up your own server <Icon name="arrow" /></a></div></details>
        </Chapter>
        <Chapter id="first-session" title="Start your first session">
          <div className="guide-session-pair"><div><h3>Host · Share your tab</h3><ol><li>Open a regular HTTP/HTTPS website and invoke GhostPair from the toolbar.</li><li>Choose <strong>Share my tab</strong>. The setup panel shows <strong>Your connection code</strong>.</li><li>Enter a <strong>Session password</strong> of 8–256 characters and confirm the sharing scope.</li><li>Select <strong>Share this tab</strong> and approve the requested browser permissions.</li><li>Give your guest your <strong>Connection code</strong> and password.</li></ol></div><div><h3>Guest · Join a session</h3><ol><li>Open GhostPair in your browser and choose <strong>Join a session</strong>.</li><li>Enter the host’s <strong>Connection code</strong> and <strong>Session password</strong>.</li><li>Select <strong>Join session</strong> to see the active, approved tab.</li></ol></div></div>
          <p>Sessions start in <strong>Preview changes</strong>: typing and clicks appear as previews. The host can enable <strong>Full control</strong>, pause or end the session. Scrolling and GhostPair navigation/tab controls act in either mode; every additional tab needs the host’s local approval.</p>
        </Chapter>
        <SelfHosting />
        <Chapter id="updates-help" title="Keep both browsers up to date">
          <ol><li>End the current session and download the latest ZIP for each browser.</li><li>Extract it and replace the files in the existing loaded folder, keeping its location.</li><li>Open each browser’s extensions page and click <strong>Reload</strong> on GhostPair.</li><li>Reload both participants’ extensions before starting a new session.</li></ol>
          <p>Reloading preserves saved settings and installation identities. Uninstalling or clearing extension data removes them.</p>
          <details id="troubleshooting" className="guide-disclosure"><summary><span>Troubleshooting<small>Checks and recovery</small></span><Icon name="plus" /></summary><div className="guide-disclosure-content guide-troubleshooting"><h3>The extension does not load</h3><p>Extract the ZIP completely and select the folder containing <code>manifest.json</code>. Keep Developer mode enabled and the folder in its original location.</p><h3>Permission was denied or a tab stays private</h3><p>Invoke the extension on a regular website, confirm consent and approve the browser permissions. Internal browser pages, extension stores, local files, incognito and native dialogs are unsupported. Approve each new tab locally.</p><h3>The invitation does not match</h3><p>Compare both connection servers. Use the host’s current code for that server and re-enter the password; the viewer clears it after each attempt.</p><h3>The connection fails</h3><p>For a custom deployment, check <code>/health</code> and <code>/ready</code>. A healthy server may still lack a direct peer route: STUN does not relay traffic and GhostPair has no TURN relay. Try another network and reconnect explicitly.</p><h3>A page control needs the host</h3><p>Full control uses synthetic input. Protected controls, file pickers and other native dialogs may require local action from the host. Audio, desktop sharing and browser chrome are unsupported.</p></div></details>
        </Chapter>
        <div className="guide-outro"><h2>See how it feels.</h2><a className="guide-primary" href="?view=explore">Explore GhostPair <Icon name="arrow" /></a></div>
      </div>
    </div>
  </main>;
}
