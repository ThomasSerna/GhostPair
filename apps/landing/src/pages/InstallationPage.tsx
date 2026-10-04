import { useState, type ReactNode } from "react";
import { BrandMark, Icon } from "../components/Icons";
import "./installation.css";

const releases = "https://github.com/ThomasSerna/GhostPair/releases/latest";
const officialServer = "https://ghostpair.onrender.com";
const officialStun = "stun:stun.l.google.com:19302";
const exampleCode = "12ab34cd56ef78ab90cd12ef34ab56cd";
const chapters = [
  ["install-extension", "Install the extension"],
  ["connection-settings", "Choose your connection"],
  ["first-session", "Start your first session"],
  ["self-hosting", "Host your own server"],
  ["updates-help", "Updates & troubleshooting"],
];

function Copy({ value, label = "Copy" }: { value: string; label?: string }) {
  const [status, setStatus] = useState("");
  const [fallback, setFallback] = useState(false);
  return <span className="guide-copy">
    <button type="button" className="guide-quiet" onClick={async () => {
      try { await navigator.clipboard.writeText(value); setStatus("Copied"); setFallback(false); }
      catch { setStatus("Select the text below and copy it manually."); setFallback(true); }
    }}>{status === "Copied" ? "Copied" : label}</button>
    <span className="sr-only" role="status">{status}</span>
    {fallback && <label className="guide-copy-fallback">Copy manually<textarea readOnly value={value} onFocus={event => event.currentTarget.select()} /></label>}
  </span>;
}

function Scene({ title, onReset, children }: { title: string; onReset: () => void; children: ReactNode }) {
  return <div className="guide-scene">
    <div className="guide-scene-bar"><span>{title}</span><button className="guide-quiet" type="button" onClick={onReset}>Reset</button></div>
    <div className="guide-scene-content">{children}</div>
    <div className="guide-scene-caption"><span className="status-dot" /> Interactive demo · Example data</div>
  </div>;
}

function Steps({ labels, step }: { labels: string[]; step: number }) {
  return <ol className="guide-progress" aria-label="Progress">{labels.map((label, index) => <li key={label} aria-current={step === index ? "step" : undefined} className={step > index ? "complete" : step === index ? "current" : ""}><span>{step > index ? <Icon name="check" /> : index + 1}</span>{label}</li>)}</ol>;
}

function InstallScene() {
  const [browser, setBrowser] = useState("chrome");
  const [step, setStep] = useState(0);
  const [extracted, setExtracted] = useState(false);
  const [developer, setDeveloper] = useState(false);
  const [folder, setFolder] = useState("outer");
  const [message, setMessage] = useState("");
  const reset = () => { setStep(0); setExtracted(false); setDeveloper(false); setFolder("outer"); setMessage(""); };
  return <Scene title="Your browser, one step at a time" onReset={reset}>
    <fieldset className="guide-switch"><legend className="sr-only">Browser to install in</legend>{["chrome", "edge"].map(value => <label key={value}><input type="radio" name="install-browser" checked={browser === value} onChange={() => { setBrowser(value); reset(); }} /><span>{value === "chrome" ? "Chrome" : "Edge"}</span></label>)}</fieldset>
    <Steps labels={["Choose ZIP", "Extract", "Load", "Ready"]} step={step} />
    <div className="guide-browser-window">
      <div className="guide-browser-address"><Icon name="browser" /><code>{step < 2 ? "github.com / GhostPair / Releases" : `${browser}://extensions`}</code></div>
      {step === 0 && <div className="guide-install-stage">
        <h3>Pick your browser’s package.</h3><p>Release assets follow this pattern. Use the version shown in the latest release.</p>
        <div className="guide-release-file"><Icon name="download" /><code>ghostpair-{browser}-&lt;version&gt;.zip</code><span>Extension package</span></div>
        <button type="button" className="guide-primary" onClick={() => { setStep(1); setMessage("Example ZIP selected. In your browser, download it from Releases."); }}>Practice choosing this ZIP <Icon name="arrow" /></button>
        <a className="guide-text-link" href={releases}>Open actual Releases <Icon name="external" /></a>
      </div>}
      {step === 1 && <div className="guide-install-stage">
        <h3>A folder you’ll keep.</h3><p>Extract all files into a permanent folder. The browser loads that folder, so moving or deleting it breaks the installation.</p>
        <div className="guide-extraction"><span className="guide-file-block"><Icon name="download" /><span>ZIP archive</span></span><Icon name="arrow" />{extracted ? <span className="guide-file-block guide-folder-block"><Icon name="browser" /><span>GhostPair folder</span><code>manifest.json</code><code>assets/</code></span> : <span className="guide-file-block guide-folder-empty">The extracted folder will appear here.</span>}</div>
        <button type="button" className="guide-primary" onClick={() => { if (!extracted) { setExtracted(true); setMessage("Example files extracted. The GhostPair folder now contains manifest.json and its assets."); } else { setStep(2); setMessage("Open your browser’s extensions page, then enable Developer mode."); } }}>{extracted ? "Continue to extensions" : "Practice extracting the ZIP"} <Icon name="arrow" /></button>
      </div>}
      {step === 2 && <div className="guide-install-stage">
        <div className="guide-control-row"><h3>Extensions</h3><label className="guide-check"><input type="checkbox" checked={developer} onChange={event => setDeveloper(event.target.checked)} /> Developer mode</label></div>
        <p>Copy this address, paste it into the browser’s address bar and open it manually.</p>
        <div className="guide-inline-code"><code>{browser}://extensions</code><Copy value={`${browser}://extensions`} label="Copy address" /></div>
        <label className="guide-field">Folder to load<select value={folder} onChange={event => setFolder(event.target.value)}><option value="outer">Downloads — contains the ZIP</option><option value="manifest">GhostPair — contains manifest.json</option><option value="assets">GhostPair/assets — contains scripts</option></select></label>
        <button type="button" className="guide-primary" disabled={!developer} onClick={() => {
          if (folder !== "manifest") { setMessage("Choose the extracted GhostPair folder containing manifest.json, not the ZIP or assets folder."); return; }
          setStep(3); setMessage("GhostPair loaded in this example. Repeat these steps in the other participant’s browser.");
        }}>Load unpacked</button>
        {!developer && <p className="guide-helper">Enable Developer mode to reveal Load unpacked.</p>}
      </div>}
      {step === 3 && <div className="guide-install-stage guide-ready"><BrandMark /><h3>GhostPair is ready.</h3><p>Pin it from your browser’s Extensions menu. Both participants install the extension; each keeps their own connection code.</p><a className="guide-primary" href="#connection-settings">Choose your connection <Icon name="arrow" /></a></div>}
    </div>
    <p className="guide-status" role="status">{message || "Choose Chrome or Edge, then try the steps without changing your browser."}</p>
  </Scene>;
}

function validServer(value: string) {
  try { const url = new URL(value); return !url.username && !url.password && !url.search && !url.hash && (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))); }
  catch { return false; }
}

function SettingsScene() {
  const [mode, setMode] = useState("ghostpair");
  const [url, setUrl] = useState("https://connect.example.com");
  const [stun, setStun] = useState("stun:connect.example.com:3478");
  const [active, setActive] = useState(false);
  const [message, setMessage] = useState("");
  const reset = () => { setMode("ghostpair"); setUrl("https://connect.example.com"); setStun("stun:connect.example.com:3478"); setActive(false); setMessage(""); };
  return <Scene title="Connection settings" onReset={reset}>
    <div className="guide-extension-head"><BrandMark /><strong>GhostPair</strong><span>Settings</span></div>
    <form noValidate onSubmit={event => {
      event.preventDefault(); if (active) return;
      if (mode === "custom") {
        if (!validServer(url.trim())) { setMessage("Use HTTPS, or HTTP on localhost. Remove credentials, query parameters and fragments."); return; }
        const entries = stun.split(/[\n,]/).map(value => value.trim()).filter(Boolean);
        if (entries.length < 1 || entries.length > 5 || entries.some(value => !/^stuns?:[^\s]+$/i.test(value))) { setMessage("Add one to five STUN servers, each starting with stun: or stuns:. Separate them with commas or new lines."); return; }
        setUrl(url.trim().replace(/\/$/, ""));
      }
      setMessage(`Saved in this example: ${mode === "ghostpair" ? officialServer : url.trim().replace(/\/$/, "")}. Both participants must choose the same server.`);
    }}>
      <fieldset className="guide-server-options" disabled={active}><legend>Connection</legend>
        <label><input type="radio" name="guide-server" checked={mode === "ghostpair"} onChange={() => { setMode("ghostpair"); setMessage(""); }} /><span>GhostPair server<small>Recommended · Ready to use</small></span></label>
        <label><input type="radio" name="guide-server" checked={mode === "custom"} onChange={() => { setMode("custom"); setMessage(""); }} /><span>Custom server<small>Use your own connection settings</small></span></label>
      </fieldset>
      {mode === "ghostpair" ? <dl className="guide-preset"><dt>Connection server</dt><dd>{officialServer}</dd><dt>STUN server</dt><dd>{officialStun}</dd></dl> : <fieldset className="guide-custom-fields" disabled={active}><legend className="sr-only">Custom server settings</legend><label className="guide-field">Connection server<input type="url" value={url} autoComplete="off" onChange={event => { setUrl(event.target.value); setMessage(""); }} /></label><label className="guide-field">STUN servers<textarea rows={3} value={stun} onChange={event => { setStun(event.target.value); setMessage(""); }} /></label><p className="guide-helper">One to five addresses, separated by commas or new lines.</p></fieldset>}
      <div className="guide-control-row"><button className="guide-primary" type="submit" disabled={active}>Save</button><button className="guide-quiet" type="button" onClick={() => { setActive(!active); setMessage(active ? "Example session ended. Connection settings are available again." : "End the session before changing connection settings."); }}>{active ? "End example session" : "Try with a session active"}</button></div>
    </form>
    <p className="guide-status" role="status">{message || "These settings are local to this demo. No server connection is made."}</p>
  </Scene>;
}

function FirstSessionScene() {
  const [phase, setPhase] = useState("setup");
  const [password, setPassword] = useState("together-demo");
  const [secret, setSecret] = useState("");
  const [consent, setConsent] = useState(false);
  const [tab, setTab] = useState("regular");
  const [code, setCode] = useState("");
  const [guestPassword, setGuestPassword] = useState("");
  const [message, setMessage] = useState("");
  const reset = () => { setPhase("setup"); setPassword("together-demo"); setSecret(""); setConsent(false); setTab("regular"); setCode(""); setGuestPassword(""); setMessage(""); };
  return <Scene title="One host. One guest." onReset={reset}>
    <Steps labels={["Host consents", "Authorize tab", "Guest joins"]} step={phase === "setup" ? 0 : phase === "capture" ? 1 : 2} />
    {phase === "setup" && <form className="guide-session-form" noValidate onSubmit={event => {
      event.preventDefault();
      if (password.length < 8 || password.length > 256) { setMessage("Use a session password between 8 and 256 characters."); return; }
      if (!consent) { setMessage("Confirm what you want to share before continuing."); return; }
      setSecret(password); setPassword(""); setPhase("capture"); setMessage("Host consent confirmed. Now authorize the example tab.");
    }}><div className="guide-role">Host</div><h3>Share your tab</h3><label className="guide-field">Session password<input type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} /></label><p className="guide-helper">The prefilled password is fictional and used only in this exercise.</p><label className="guide-check guide-consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} /><span>I allow the person with my connection code and password to view and interact with this tab, and manage tabs in this window. I’ll approve each additional tab before it’s shared.</span></label><button type="submit" className="guide-primary">Start sharing <Icon name="arrow" /></button></form>}
    {phase === "capture" && <div className="guide-session-form"><div className="guide-role">Host · Permission example</div><h3>Authorize the current tab.</h3><p>The real extension requests browser permissions and captures the current tab. Native capture indicators remain enabled.</p><label className="guide-field">Example active tab<select value={tab} onChange={event => setTab(event.target.value)}><option value="regular">Weekend plans — a regular website</option><option value="internal">chrome://settings — an internal page</option></select></label><div className="guide-capture-tab"><Icon name="browser" /><span>{tab === "regular" ? "Weekend plans" : "Browser settings"}</span><small>{tab === "regular" ? "Available to authorize" : "Unsupported page"}</small></div><div className="guide-control-row"><button type="button" className="guide-primary" onClick={() => { if (tab !== "regular") { setMessage("Internal browser pages cannot be shared. Choose a regular website, then authorize it."); return; } setPhase("join"); setMessage("Example tab authorized. Share the code and session password with your guest."); }}>Allow this example tab</button><button type="button" className="guide-quiet" onClick={() => { setPhase("setup"); setMessage("Permission denied. Nothing is shared; confirm consent and try again."); }}>Deny permission</button></div></div>}
    {phase === "join" && <div className="guide-session-pair"><div className="guide-host-invite"><div className="guide-role">Host · Waiting for guest</div><h3>Your connection code</h3><code>{exampleCode}</code><button className="guide-quiet" type="button" onClick={() => { setCode(exampleCode); setGuestPassword(secret); setMessage("Fictional invitation filled into the guest form. You can change it to try an error."); }}>Fill example invitation <Icon name="arrow" /></button><p>Give your guest this code and the password you chose. The code belongs to this installation and configured server.</p></div><form noValidate onSubmit={event => { event.preventDefault(); const attempt = guestPassword; setGuestPassword(""); if (code.replace(/[\s-]/g, "").toLowerCase() !== exampleCode) { setMessage("The example connection code is incorrect. Fill the invitation and try again."); return; } if (attempt !== secret) { setMessage("The password is incorrect. It was cleared after this attempt; enter it again or fill the example invitation."); return; } setPhase("connected"); setMessage("Connected in this demo. Your session starts in Preview changes."); }}><div className="guide-role">Guest</div><h3>Join a session.</h3><label className="guide-field">Connection code<input value={code} autoComplete="off" onChange={event => setCode(event.target.value)} /></label><label className="guide-field">Session password<input type="password" value={guestPassword} autoComplete="off" onChange={event => setGuestPassword(event.target.value)} /></label><button className="guide-primary" type="submit">Join session</button></form></div>}
    {phase === "connected" && <div className="guide-ready"><BrandMark /><h3>Connected, together.</h3><p>The guest now sees the active, authorized tab. Preview changes keeps their clicks and typing on a presentation layer while navigation and scrolling act on the real tab.</p><a className="guide-primary" href="?view=explore">Try the shared browser <Icon name="arrow" /></a><button className="guide-quiet" type="button" onClick={() => { reset(); setMessage("Example session ended. No tab is shared."); }}>End example session</button></div>}
    {phase !== "setup" && phase !== "connected" && <button className="guide-quiet guide-cancel" type="button" onClick={() => { reset(); setMessage("Example connection canceled. Nothing is shared."); }}>Cancel connection</button>}
    <p className="guide-status" role="status">{message || "Try the invitation from both sides. No permissions or real capture are requested."}</p>
  </Scene>;
}

function Command({ value, label = "Copy command" }: { value: string; label?: string }) {
  return <div className="guide-command"><pre><code>{value}</code></pre><Copy value={value} label={label} /></div>;
}

function SelfHostingScene() {
  const [step, setStep] = useState(0);
  const [domain, setDomain] = useState("connect.example.com");
  const [dns, setDns] = useState(false);
  const [merged, setMerged] = useState(false);
  const [ports, setPorts] = useState(false);
  const [route, setRoute] = useState("direct");
  const [verified, setVerified] = useState(false);
  const [host, setHost] = useState(false);
  const [guest, setGuest] = useState(false);
  const [message, setMessage] = useState("");
  const reset = () => { setStep(0); setDomain("connect.example.com"); setDns(false); setMerged(false); setPorts(false); setRoute("direct"); setVerified(false); setHost(false); setGuest(false); setMessage(""); };
  const hostname = domain.trim().toLowerCase();
  const domainValid = hostname.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname);
  const endpoint = `https://${domainValid ? hostname : "<your-domain>"}`;
  const stun = `stun:${domainValid ? hostname : "<your-domain>"}:3478`;
  const invalidateConnection = () => { setVerified(false); setHost(false); setGuest(false); setMessage(""); };
  return <Scene title="Docker / VPS walkthrough" onReset={reset}>
    <Steps labels={["Domain", ".env", "Start", "Verify", "Connect"]} step={step} />
    {step === 0 && <div className="guide-selfhost-step"><h3>Give signaling an address.</h3><p>Use a VPS with Docker Engine and the Compose plugin installed. Clone the repository and work from its root.</p><Command value="git clone https://github.com/ThomasSerna/GhostPair.git\ncd GhostPair" /><label className="guide-field">Public domain<input value={domain} autoComplete="off" spellCheck={false} onChange={event => { setDomain(event.target.value); setDns(false); setMerged(false); setPorts(false); invalidateConnection(); }} /></label><div className="guide-dns"><span>DNS A record</span><code>{domainValid ? hostname : "your domain"}</code><Icon name="arrow" /><span>Your VPS public IPv4</span></div><p className="guide-helper">Point DNS to your VPS. If you publish an AAAA record, the VPS must also serve that IPv6 address.</p><label className="guide-check"><input type="checkbox" checked={dns} onChange={event => { setDns(event.target.checked); setMerged(false); setPorts(false); invalidateConnection(); }} /> Practice confirming DNS points to this VPS</label><button className="guide-primary" type="button" onClick={() => { if (!domainValid) { setMessage("Enter a public hostname, without https://, a path or a port."); return; } if (!dns) { setMessage("Confirm the example DNS record before continuing."); return; } setStep(1); setMessage("Example DNS confirmed. Prepare the deployment environment."); }}>Continue to configuration <Icon name="arrow" /></button></div>}
    {step === 1 && <div className="guide-selfhost-step"><h3>Prepare .env without losing settings.</h3><p>For a new deployment, copy <code>deploy/.env.example</code> to the root <code>.env</code>. This Linux shell command leaves an existing file intact:</p><Command value="test -f .env || cp deploy/.env.example .env" /><p>Open <code>.env</code> and merge these public values into it; preserve its other entries.</p><Command value={`SIGNAL_DOMAIN=${hostname}\nVITE_SIGNALING_URL=${endpoint}\nVITE_STUN_URLS=${stun}`} label="Copy .env values" /><p className="guide-helper">SIGNAL_DOMAIN configures Caddy. VITE_* entries are public build defaults; the released extensions can use Custom server instead, without rebuilding. Keep credentials out of VITE_*.</p><label className="guide-check"><input type="checkbox" checked={merged} onChange={event => { setMerged(event.target.checked); setPorts(false); invalidateConnection(); }} /> Practice merging these entries without replacing existing values</label><button type="button" className="guide-primary" disabled={!merged} onClick={() => { setStep(2); setMessage("Example environment prepared. Start the Compose services."); }}>Continue to startup <Icon name="arrow" /></button></div>}
    {step === 2 && <div className="guide-selfhost-step"><h3>Four parts, one deployment.</h3><div className="guide-server-map"><span><strong>Caddy</strong><small>HTTPS / WSS · 80 / 443</small></span><Icon name="arrow" /><span><strong>Signaling</strong><small>Internal port 8787</small></span><span><strong>SQLite</strong><small>identities volume</small></span><span><strong>coturn</strong><small>STUN only · 3478</small></span></div><label className="guide-check"><input type="checkbox" checked={ports} onChange={event => { setPorts(event.target.checked); invalidateConnection(); }} /> Practice opening TCP 80/443 and UDP/TCP 3478 in the VPS firewall</label><p className="guide-helper">Keep port 8787 private. Compose sets TRUST_PROXY=true behind its controlled Caddy proxy.</p><Command value="docker compose --env-file .env up -d --build" /><button type="button" className="guide-primary" disabled={!ports} onClick={() => { setStep(3); setMessage("Example services started. This walkthrough did not execute a command."); }}>Practice starting services <Icon name="arrow" /></button></div>}
    {step === 3 && <div className="guide-selfhost-step"><h3>Healthy signaling. A direct route.</h3><Command value={`curl --fail ${endpoint}/health\ncurl --fail ${endpoint}/ready`} /><p><code>/health</code> checks process liveness. <code>/ready</code> also checks identity storage. Run both against your real deployment.</p><label className="guide-field">Example network<select value={route} onChange={event => { setRoute(event.target.value); invalidateConnection(); }}><option value="direct">Both browsers have a usable direct route</option><option value="restricted">Network blocks a direct peer connection</option><option value="storage">Identity storage is unavailable</option></select></label><button type="button" className="guide-secondary" onClick={() => { setVerified(true); setMessage(route === "storage" ? "Example /health: 200 · /ready: 503. Restore writable identity storage before connecting." : route === "restricted" ? "Example /health: 200 · /ready: 200. Pairing works, but video cannot connect: STUN is not a relay. Try another network; GhostPair has no TURN." : "Example /health: 200 · /ready: 200. A direct WebRTC route is available in this scenario."); }}>Run example checks</button>{verified && <div className="guide-health"><span className="guide-health-ok">/health · 200</span><span className={route === "storage" ? "guide-health-error" : "guide-health-ok"}>/ready · {route === "storage" ? "503" : "200"}</span><span>{route === "direct" ? "Direct connection available" : route === "restricted" ? "No direct route · no TURN" : "Storage needs attention"}</span></div>}<button type="button" className="guide-primary" disabled={!verified || route === "storage"} onClick={() => { setStep(4); setMessage("Now configure both released extensions with the same connection server."); }}>Continue to both browsers <Icon name="arrow" /></button></div>}
    {step === 4 && <div className="guide-selfhost-step"><h3>Change both extensions.</h3><p>In Settings, choose <strong>Custom server</strong>, enter these values and press <strong>Save</strong>. End active sessions before changing settings.</p><div className="guide-inline-code"><code>{endpoint}</code><Copy value={endpoint} label="Copy server" /></div><div className="guide-inline-code"><code>{stun}</code><Copy value={stun} label="Copy STUN" /></div><div className="guide-two-people"><label className="guide-check"><input type="checkbox" checked={host} onChange={event => setHost(event.target.checked)} /><span>Host settings saved</span></label><label className="guide-check"><input type="checkbox" checked={guest} onChange={event => setGuest(event.target.checked)} /><span>Guest settings saved</span></label></div><p className="guide-status" role="status">{host && guest ? "Both example browsers are configured. Use the host’s code for this server when joining." : "Each extension keeps a separate identity for each connection server. Codes can change when you switch servers."}</p><a className="guide-primary" href="#first-session">Practice your first session <Icon name="arrow" /></a></div>}
    {step > 0 && <button type="button" className="guide-quiet guide-cancel" onClick={() => { setStep(step - 1); setMessage(""); }}>Previous step</button>}
    <p className="guide-status" role="status">{message || "Generated commands use your domain. Checks and server activity here are simulated."}</p>
  </Scene>;
}

const issues = {
  permission: { label: "Permission denied", title: "The host did not authorize capture.", detail: "Nothing is shared when consent or a browser permission is denied.", action: "Open the extension on a regular tab", next: "Confirm consent, then approve the browser permission", outcome: "The active tab is authorized. Approve each additional tab separately." },
  code: { label: "Incorrect code", title: "The invitation does not match.", detail: "A connection code belongs to an installation/profile and its configured server. Both browsers must use the same server.", action: "Compare both connection settings", next: "Use the host’s current code and re-enter the password", outcome: "The example invitation matches. The real viewer clears the password after every attempt." },
  page: { label: "Incompatible tab", title: "This page cannot be shared.", detail: "Internal pages, extension stores, local files, incognito and native dialogs are unsupported.", action: "Switch to a regular website", next: "Invoke the extension on that tab and authorize it", outcome: "The example website can be shared. A guest-opened tab waits for the host’s approval." },
  network: { label: "Connection failed", title: "Signaling and video have different paths.", detail: "A healthy server can pair browsers even when their networks block direct WebRTC. There is no TURN relay or automatic reconnection.", action: "Check the server’s /health and /ready endpoints", next: "Try a network with a direct route and reconnect explicitly", outcome: "The example route is available. End the failed attempt, then join again." },
};

function HelpScene() {
  const [replaced, setReplaced] = useState(false);
  const [hostReload, setHostReload] = useState(false);
  const [guestReload, setGuestReload] = useState(false);
  const [issue, setIssue] = useState<keyof typeof issues>("permission");
  const [repair, setRepair] = useState(0);
  const [message, setMessage] = useState("");
  const problem = issues[issue];
  const reset = () => { setReplaced(false); setHostReload(false); setGuestReload(false); setIssue("permission"); setRepair(0); setMessage(""); };
  return <Scene title="Keep both browsers in step" onReset={reset}>
    <h3>Update the installed folder.</h3><p>End the session, download the latest package for each browser, extract it and replace the files in the folder already loaded. Keep the folder’s location stable.</p>
    <button type="button" className="guide-secondary" disabled={replaced} onClick={() => { setReplaced(true); setMessage("Example files replaced. Reload both installed extensions from their extensions pages."); }}>{replaced ? "Example files replaced" : "Practice replacing the files"}</button>
    <div className="guide-update-pair"><div><span>Host browser</span><button className="guide-quiet" disabled={!replaced || hostReload} type="button" onClick={() => setHostReload(true)}><Icon name={hostReload ? "check" : "browser"} />{hostReload ? "Host reloaded" : "Reload host extension"}</button></div><div><span>Guest browser</span><button className="guide-quiet" disabled={!replaced || guestReload} type="button" onClick={() => setGuestReload(true)}><Icon name={guestReload ? "check" : "browser"} />{guestReload ? "Guest reloaded" : "Reload guest extension"}</button></div></div>
    <p className="guide-status" role="status">{hostReload && guestReload ? "Both example extensions are updated. Reloading preserves saved settings and identities; clearing data or uninstalling removes credentials." : message || "Update both participants together, then begin a new session."}</p>
    <div className="guide-help-exercise"><label className="guide-field">Try a troubleshooting scenario<select value={issue} onChange={event => { setIssue(event.target.value as keyof typeof issues); setRepair(0); }}>{Object.entries(issues).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label><h3>{problem.title}</h3><p>{problem.detail}</p>{repair < 2 ? <button type="button" className="guide-primary" onClick={() => setRepair(repair + 1)}>{repair === 0 ? problem.action : problem.next}<Icon name="arrow" /></button> : <p className="guide-status" role="status"><Icon name="check" />{problem.outcome}</p>}{repair === 1 && <p className="guide-helper" role="status">First check complete. Try the recovery step.</p>}</div>
  </Scene>;
}

function Chapter({ id, number, title, children, scene }: { id: string; number: string; title: string; children: ReactNode; scene: ReactNode }) {
  return <section id={id} className="guide-chapter" aria-labelledby={`${id}-title`}><div className="guide-chapter-copy"><span className="guide-chapter-number">{number}</span><h2 id={`${id}-title`}>{title}</h2>{children}</div>{scene}</section>;
}

export default function InstallationPage() {
  return <main id="main" tabIndex={-1} className="installation-page">
    <div className="guide-intro wrap"><h1>Make room<br /><span className="mint">for two.</span></h1><div><p>From the first download to your own server. Follow the guide, try each step, then bring someone into your browser.</p><span>Chrome &amp; Edge on Windows</span></div></div>
    <div className="guide-layout wrap"><aside className="guide-index"><nav aria-label="Installation chapters"><span>In this guide</span>{chapters.map(([id, label], index) => <a href={`#${id}`} key={id}><span>{index + 1}</span>{label}</a>)}<a className="guide-index-explore" href="?view=explore">Explore the extension <Icon name="arrow" /></a></nav></aside><div className="guide-chapters">
      <Chapter id="install-extension" number="01" title="Install. Unpack. Connect." scene={<InstallScene />}><p>The release ZIP is the extension. Choose the file for your browser, extract it and load the folder containing <code>manifest.json</code>.</p><p>Practice here, then repeat in both participants’ browsers. The exercise does not install anything.</p></Chapter>
      <Chapter id="connection-settings" number="02" title="One server. Two browsers." scene={<SettingsScene />}><p>The <strong>GhostPair server</strong> preset is ready to use. Select it and press Save in both browsers.</p><p>Use <strong>Custom server</strong> if you run your own. Both participants need the same connection server; settings cannot change during an active session.</p><a className="guide-text-link" href="#self-hosting">Set up your own server <Icon name="arrow" /></a></Chapter>
      <Chapter id="first-session" number="03" title="An invitation with permission." scene={<FirstSessionScene />}><p>The host chooses <strong>Share my tab</strong>, sets a session password and confirms consent. The guest chooses <strong>Join a session</strong> and enters the host’s code and password.</p><p>Only the active, approved tab in one browser window is transmitted. A new tab always needs the host’s local approval.</p><p>Sharing starts in <strong>Preview changes</strong>. The host can switch to Full control, pause or end the session at any time.</p></Chapter>
      <Chapter id="self-hosting" number="04" title="Your server. The same experience." scene={<SelfHostingScene />}><p>Run signaling on a VPS with Docker Compose, a public domain and persistent storage. Caddy handles HTTPS/WSS; STUN helps the browsers find a direct connection.</p><p>Use the released ZIPs and select Custom server. You do not need to rebuild the extension.</p><p>Video and interactions travel between the browsers. A healthy signaling server does not guarantee that every network permits that direct connection.</p><div className="guide-maintenance"><h3>Keep identities safe.</h3><p>Run a single signaling instance. Back up the <code>identities</code> volume consistently: stop signaling before copying it, or use SQLite’s backup API. Losing it invalidates registered identities.</p><p>Monitor readiness, memory and disk space. Avoid payload logging in the proxy.</p></div></Chapter>
      <Chapter id="updates-help" number="05" title="Keep your connection ready." scene={<HelpScene />}><p>Update both participants together. Replace the extracted files and reload the extension in each browser.</p><p>Try the common problems here before you encounter them. Each exercise shows a check followed by a recovery step.</p><a className="guide-text-link" href={releases}>See the latest release <Icon name="external" /></a></Chapter>
      <div className="guide-outro"><h2>Now take<br />a closer look.</h2><p>Try the controls from both sides of a session, using example data.</p><a className="guide-primary" href="?view=explore">Explore GhostPair <Icon name="arrow" /></a></div>
    </div></div>
  </main>;
}
