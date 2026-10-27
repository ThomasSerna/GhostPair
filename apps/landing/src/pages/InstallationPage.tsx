import { useTranslation } from "../i18n";
import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "../components/Icons";
import "./installation.css";

const chromeWebStore = "https://chromewebstore.google.com/detail/ghostpair/gmcemjpedmacbgcmfdegpbhfeladinfd";
const officialServer = "https://ghostpair-3c9f3903aad3.herokuapp.com";
const officialStun = "stun:stun.l.google.com:19302";
const chapters = [
  ["install-extension", "Install the extension"],
  ["connection-settings", "Connection settings"],
  ["first-session", "Your first session"],
  ["self-hosting", "Host your own server"],
  ["updates-help", "Updates & troubleshooting"],
];

function Copy({ value, label = "Copy command" }: { value: string; label?: string }) {
  const t = useTranslation();
  const [status, setStatus] = useState("");
  const [fallback, setFallback] = useState(false);
  useEffect(() => { setStatus(""); setFallback(false); }, [value]);
  return <span className="guide-copy">
    <button type="button" className="guide-quiet" aria-label={t(label)} onClick={async () => {
      try { await navigator.clipboard.writeText(value); setStatus("Copied"); setFallback(false); }
      catch { setStatus("Copy unavailable. Select the text below."); setFallback(true); }
    }}>{t(label)}<Icon name="copy" /></button>
    <span className={status ? "guide-copy-status" : "sr-only"} role="status">{t(status)}</span>
    {fallback && <label className="guide-copy-fallback">{t("Copy manually")}<textarea aria-label={t("{label} manually", { label: t(label) })} readOnly value={value} onFocus={event => event.currentTarget.select()} /></label>}
  </span>;
}

function Command({ value }: { value: string }) {
  return <div className="guide-command"><pre><code>{value}</code></pre><Copy value={value} /></div>;
}

function Chapter({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const t = useTranslation();
  return <section id={id} className="guide-chapter" aria-labelledby={id + "-title"}><h2 id={id + "-title"}>{t(title)}</h2>{children}</section>;
}

function SelfHosting() {
  const t = useTranslation();
  return <details id="self-hosting" className="guide-disclosure guide-hosting">
    <summary><span>{t("Host your own server")}<small>{t("Optional · Docker / VPS")}</small></span><Icon name="plus" /></summary>
    <div className="guide-disclosure-content">
      <p>{t("A public domain, a VPS with Docker Engine and the Compose plugin, and a usable direct route between browsers are required. The commands below use ")}<code>pair.example.org</code>{t("; replace it with your domain.")}</p>
      <ol className="guide-technical-steps">
        <li><h3>{t("Point your domain to the VPS")}</h3><p>{t("Create a DNS A record for the VPS public IPv4. If you also publish an AAAA record, serve the domain on that IPv6 address.")}</p><Command value={"git clone https://github.com/ThomasSerna/GhostPair.git\ncd GhostPair"} /></li>
        <li><h3>{t("Prepare the environment")}</h3><p>{t("For a new deployment, copy the template to the repository root. This command preserves an existing file:")}</p><Command value="test -f .env || cp deploy/.env.example .env" /><p>{t("Merge the following values into ")}<code>.env</code>{t(", preserving its other entries:")}</p><Command value={"SIGNAL_DOMAIN=pair.example.org\nVITE_SIGNALING_URL=https://pair.example.org\nVITE_STUN_URLS=stun:pair.example.org:3478"} /><p><code>SIGNAL_DOMAIN</code>{t(" configures Caddy. The ")}<code>VITE_*</code>{t(" values are public build defaults; the installed extension can use ")}<strong>{t("Custom server")}</strong>{t(" without rebuilding. Keep credentials out of public build values.")}</p></li>
        <li><h3>{t("Start the services")}</h3><p>{t("Open TCP 80/443 for Caddy and UDP/TCP 3478 for STUN. Keep signaling port 8787 private.")}</p><Command value="docker compose --env-file .env up -d --build" /><dl className="guide-service-list"><dt>Caddy</dt><dd>{t("HTTPS / WSS and a controlled proxy.")}</dd><dt>{t("Signaling")}</dt><dd>{t("Coordinates pairing; TRUST_PROXY is enabled behind Caddy.")}</dd><dt>SQLite</dt><dd>{t("The base Compose configuration stores identities in the persistent ")}<code>identities</code>{t(" volume.")}</dd><dt>coturn</dt><dd>{t("STUN only. This configuration provides no TURN relay.")}</dd></dl></li>
        <li><h3>{t("Check the real deployment")}</h3><Command value={"curl --fail https://pair.example.org/health\ncurl --fail https://pair.example.org/ready"} /><p><code>/health</code>{t(" checks process liveness; ")}<code>/ready</code>{t(" also checks identity storage. A healthy signaling server does not guarantee a direct WebRTC route. Restricted networks may still fail to connect.")}</p></li>
        <li><h3>{t("Configure both extensions")}</h3><p>{t("End active sessions. In each browser, open Settings, choose ")}<strong>{t("Custom server")}</strong>{t(", enter these values and press ")}<strong>{t("Save")}</strong>:</p><dl className="guide-preset"><dt>{t("Connection server")}</dt><dd><code>https://pair.example.org</code></dd><dt>{t("STUN servers")}</dt><dd><code>stun:pair.example.org:3478</code></dd></dl><p>{t("Both participants must use the same server. Each installation keeps a separate identity per server, so use the host’s current connection code after switching.")}</p></li>
      </ol>
      <div className="guide-maintenance"><h3>{t("Storage and maintenance")}</h3><p>{t("Base ")}<code>compose.yaml</code>{t(" uses SQLite. Production Render uses PostgreSQL. The optional ")}<code>compose.postgres.yaml</code>{t(" override reads a private ")}<code>DATABASE_URL</code>{t(" and defaults to ")}<code>DATABASE_SSL_MODE=verify-full</code>{t("; do not put database credentials in ")}<code>VITE_*</code>.</p><p>{t("Run one signaling instance and back up identity storage. For SQLite, stop signaling before copying the ")}<code>identities</code>{t(" volume or use SQLite’s backup API. Losing identity storage invalidates registered identities. Monitor readiness, memory and disk space; avoid payload logging in the proxy.")}</p></div>
    </div>
  </details>;
}

export default function InstallationPage() {
  const t = useTranslation();
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
    <div className="guide-intro wrap"><h1>{t("Install GhostPair")}</h1><div><p>{t("Install in both browsers, then invite someone to your tab.")}</p><span>{t("Chrome & Edge on Windows")}</span><a className="guide-primary" href={chromeWebStore}>{t("Download GhostPair ")}<Icon name="arrow" /></a></div></div>
    <div className="guide-layout wrap">
      <aside className="guide-index"><nav aria-label={t("Installation chapters")}><span>{t("In this guide")}</span>{chapters.map(([id, label]) => <a key={id} href={"#" + id}>{t(label)}</a>)}<a className="guide-index-explore" href="?view=explore">{t("Try the demo ")}<Icon name="arrow" /></a></nav></aside>
      <div className="guide-chapters">
        <Chapter id="install-extension" title={t("Install from Chrome Web Store")}>
          <ol className="guide-install-steps">
            <li><h3>{t("Open the official listing")}</h3><p>{t("Open ")}<a className="guide-inline-link" href={chromeWebStore}>{t("GhostPair on Chrome Web Store")}</a>{t(" in Chrome or Edge. In Edge, allow extensions from other stores if prompted.")}</p></li>
            <li><h3>{t("Add GhostPair to your browser")}</h3><p>{t("Select ")}<strong>{t("Add to Chrome")}</strong>{t(", review the requested permissions, and confirm ")}<strong>{t("Add extension")}</strong>.</p></li>
            <li><h3>{t("Pin GhostPair and repeat in the other browser")}</h3><p>{t("Pin it from the browser’s Extensions menu. Each participant installs GhostPair in their own browser or profile.")}</p></li>
          </ol>
        </Chapter>
        <Chapter id="connection-settings" title={t("Your connection is ready")}>
          <p>{t("The extension uses the ")}<strong>{t("GhostPair server")}</strong>{t(" by default. You can start a session without deploying a server or rebuilding the extension.")}</p>
          <dl className="guide-preset"><dt>{t("Connection server")}</dt><dd><code>{officialServer}</code></dd><dt>{t("STUN servers")}</dt><dd><code>{officialStun}</code></dd></dl>
          <details id="custom-server-settings" className="guide-disclosure"><summary><span>{t("Change connection settings")}<small>{t("Optional · Custom server")}</small></span><Icon name="plus" /></summary><div className="guide-disclosure-content"><p>{t("End an active session before changing settings. Both participants must use the same connection server.")}</p><ol><li>{t("Open GhostPair Settings.")}</li><li>{t("To restore the default, choose ")}<strong>{t("GhostPair server")}</strong>{t(" and press ")}<strong>{t("Save")}</strong>.</li><li>{t("For your own deployment, choose ")}<strong>{t("Custom server")}</strong>{t(", fill ")}<strong>{t("Connection server")}</strong>{t(" and ")}<strong>{t("STUN servers")}</strong>{t(", then press ")}<strong>{t("Save")}</strong>{t(" in both browsers.")}</li></ol><p>{t("Use HTTPS for a public server, or HTTP on localhost. Remove URL credentials, query parameters and fragments. Enter one to five STUN addresses starting with ")}<code>stun:</code>{t(" or ")}<code>stuns:</code>{t(", separated by commas or new lines.")}</p><a className="guide-text-link" href="#self-hosting">{t("Set up your own server ")}<Icon name="arrow" /></a></div></details>
        </Chapter>
        <Chapter id="first-session" title={t("Start your first session")}>
          <div className="guide-session-pair"><div><h3>{t("Host · Share your tab")}</h3><ol><li>{t("Open a regular HTTP/HTTPS website and invoke GhostPair from the toolbar.")}</li><li>{t("Choose ")}<strong>{t("Share my tab")}</strong>{t(". The setup panel shows ")}<strong>{t("Your connection code")}</strong>.</li><li>{t("Enter a ")}<strong>{t("Session password")}</strong>{t(" of 8–256 characters and confirm the sharing scope.")}</li><li>{t("Select ")}<strong>{t("Share this tab")}</strong>{t(" and approve the requested browser permissions.")}</li><li>{t("Give your guest your ")}<strong>{t("Connection code")}</strong>{t(" and password.")}</li></ol></div><div><h3>{t("Guest · Join a session")}</h3><ol><li>{t("Open GhostPair in your browser and choose ")}<strong>{t("Join a session")}</strong>.</li><li>{t("Enter the host’s ")}<strong>{t("Connection code")}</strong>{t(" and ")}<strong>{t("Session password")}</strong>.</li><li>{t("Select ")}<strong>{t("Join session")}</strong>{t(" to see the active, approved tab.")}</li></ol></div></div>
          <p>{t("Sessions start in ")}<strong>{t("Preview changes")}</strong>{t(": typing and clicks appear as previews. The host can enable ")}<strong>{t("Full control")}</strong>{t(", pause or end the session. Scrolling and GhostPair navigation/tab controls act in either mode; every additional tab needs the host’s local approval.")}</p>
        </Chapter>
        <SelfHosting />
        <Chapter id="updates-help" title={t("Keep both browsers up to date")}>
          <p>{t("Your browser automatically updates GhostPair from Chrome Web Store. After an update, end any active session and reopen GhostPair in both browsers before reconnecting.")}</p>
          <p>{t("Updates preserve saved settings and installation identities. Uninstalling or clearing extension data removes them.")}</p>
          <details id="troubleshooting" className="guide-disclosure"><summary><span>{t("Troubleshooting")}<small>{t("Checks and recovery")}</small></span><Icon name="plus" /></summary><div className="guide-disclosure-content guide-troubleshooting"><h3>{t("The extension does not appear")}</h3><p>{t("Check that GhostPair is installed and enabled on your browser’s Extensions page, then pin it from the Extensions menu. In Edge, allow extensions from other stores if prompted during installation.")}</p><h3>{t("Permission was denied or a tab stays private")}</h3><p>{t("Invoke the extension on a regular website, confirm consent and approve the browser permissions. Internal browser pages, extension stores, local files, incognito and native dialogs are unsupported. Approve each new tab locally.")}</p><h3>{t("The invitation does not match")}</h3><p>{t("Compare both connection servers. Use the host’s current code for that server and re-enter the password; the viewer clears it after each attempt.")}</p><h3>{t("The connection fails")}</h3><p>{t("For a custom deployment, check ")}<code>/health</code>{t(" and ")}<code>/ready</code>{t(". A healthy server may still lack a direct peer route: STUN does not relay traffic and GhostPair has no TURN relay. Try another network and reconnect explicitly.")}</p><h3>{t("A page control needs the host")}</h3><p>{t("Full control uses synthetic input. Protected controls, file pickers and other native dialogs may require local action from the host. Audio, desktop sharing and browser chrome are unsupported.")}</p></div></details>
        </Chapter>
        <div className="guide-outro"><h2>{t("See how it feels.")}</h2><a className="guide-primary" href="?view=explore">{t("Explore GhostPair ")}<Icon name="arrow" /></a></div>
      </div>
    </div>
  </main>;
}
