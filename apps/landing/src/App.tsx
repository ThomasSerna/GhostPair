import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { BrandMark, Icon } from "./components/Icons";
import ProductPreview from "./components/ProductPreview";
import ModeDemo from "./components/ModeDemo";
import { useLandingMotion } from "./motion/useLandingMotion";

const HeroScene = lazy(() => import("./components/hero/HeroScene"));
const repository = "https://github.com/ThomasSerna/GhostPair";
const releases = `${repository}/releases/latest`;

export default function App() {
  const root = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  useLandingMotion(root);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menuOpen) {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [menuOpen]);

  return (
    <div ref={root} className="site">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header wrap">
        <a className="brand" href="#main" aria-label="GhostPair home">
          <BrandMark />
          <span>GhostPair</span>
        </a>
        <nav
          id="main-nav"
          className={menuOpen ? "main-nav is-open" : "main-nav"}
          aria-label="Main navigation"
        >
          <a href="#how-it-works" onClick={() => setMenuOpen(false)}>
            The connection
          </a>
          <a href="#preview" onClick={() => setMenuOpen(false)}>
            Inside GhostPair
          </a>
          <a href="#install" onClick={() => setMenuOpen(false)}>
            Installation
          </a>
        </nav>
        <div className="header-actions">
          <a
            className="github-link"
            href={repository}
            aria-label="GhostPair repository on GitHub"
          >
            <Icon name="github" />
            <span>GitHub</span>
          </a>
          <a className="header-download" href={releases}>
            Get GhostPair <Icon name="arrow" />
          </a>
          <button
            className="menu-toggle"
            ref={menuButton}
            type="button"
            aria-expanded={menuOpen}
            aria-controls="main-nav"
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <Icon name={menuOpen ? "close" : "menu"} />
          </button>
        </div>
      </header>

      <main id="main" tabIndex={-1}>
        <section className="hero wrap" aria-labelledby="intro-title">
          <div className="hero-main">
            <div className="hero-copy">
              <h1 id="intro-title">
                <span className="hero-line">Browse</span>
                <span className="hero-line mint">together.</span>
              </h1>
              <p className="hero-description">
                Share a tab. Work through
                <br className="desktop-break" /> something together.
              </p>
              <div className="hero-actions">
                <a className="button primary" href={releases}>
                  Download GhostPair <Icon name="download" />
                </a>
                <a
                  className="hero-explore"
                  href="#how-it-works"
                  aria-label="Explore how GhostPair connects two browsers"
                >
                  <Icon name="arrow" />
                </a>
              </div>
              <p className="hero-availability">
                <Icon name="browser" />
                Chrome &amp; Edge on Windows
              </p>
            </div>
            <div className="hero-art" aria-hidden="true">
              <Suspense
                fallback={
                  <div className="scene-fallback">
                    <BrandMark />
                  </div>
                }
              >
                <HeroScene />
              </Suspense>
            </div>
            <div className="art-caption">
              <span className="status-dot" />
              Two browsers. One shared space.
            </div>
          </div>
        </section>

        <section
          id="how-it-works"
          className="connection-section section wrap"
          aria-labelledby="connection-title"
        >
          <div className="section-heading" data-reveal>
            <h2 id="connection-title">
              From your tab
              <br />
              <span className="muted-heading">to theirs.</span>
            </h2>
            <p>
              GhostPair connects two browsers so you can see the same page,
              preview clicks and typing, or use live control.
            </p>
          </div>
          <div className="connection-stage">
            <svg
              className="connection-track"
              viewBox="0 0 1000 2"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path className="signal-baseline" d="M0 1H1000" />
              <path className="signal-path" d="M0 1H1000" />
            </svg>
            <div className="connection-node host-node">
              <div className="browser-symbol">
                <Icon name="browser" />
                <span className="symbol-cursor">
                  <Icon name="arrow" />
                </span>
              </div>
              <div className="node-role">Host</div>
              <span className="node-state">
                <Icon name="check" />
                Sharing approved
              </span>
            </div>
            <div className="connection-node connection-core">
              <div className="core-symbol">
                <BrandMark />
              </div>
              <div className="node-role">GhostPair</div>
              <span className="node-state">A direct connection</span>
            </div>
            <div className="connection-node guest-node">
              <div className="browser-symbol">
                <Icon name="browser" />
                <span className="symbol-cursor guest-cursor">
                  <Icon name="arrow" />
                </span>
              </div>
              <div className="node-role">Guest</div>
              <span className="node-state">
                <Icon name="check" />A shared point of view
              </span>
            </div>
          </div>
          <ol className="connection-steps">
            <li data-reveal>
              <span className="step-number">01</span>
              <h3>Share a tab.</h3>
              <p>
                Choose <strong>Share my tab</strong>, set a password, approve
                sharing, and select <strong>Share this tab</strong>. Send your
                connection code and password to the person joining.
              </p>
            </li>
            <li data-reveal>
              <span className="step-number">02</span>
              <h3>Make the connection.</h3>
              <p>
                The other person selects <strong>Join a session</strong> and
                enters those details. The approved tab appears in their browser.
              </p>
            </li>
            <li data-reveal>
              <span className="step-number">03</span>
              <h3>Find your flow.</h3>
              <p>
                Preview interactions or choose Full control. Approve additional
                tabs individually, and end the session whenever you need.
              </p>
            </li>
          </ol>
        </section>

        <section
          id="preview"
          className="preview-section section"
          aria-labelledby="preview-title"
        >
          <div className="wrap">
            <div className="section-heading" data-reveal>
              <h2 id="preview-title">
                A shared browser.
                <br />
                <span className="muted-heading">A closer look.</span>
              </h2>
              <p>
                From the first invitation to the connected view, here’s what
                browsing together looks like.
              </p>
            </div>
            <ProductPreview />
          </div>
        </section>

        <section
          className="permission-section section wrap"
          aria-labelledby="permission-title"
        >
          <div className="permission-heading" data-reveal>
            <div>
              <h2 id="permission-title">
                Your tab.
                <br />
                <span className="mint">Your permission.</span>
              </h2>
              <p>
                You approve each shared tab and stay in control. Pause sharing,
                withdraw control, or end the session at any time.
              </p>
            </div>
            <div className="permission-seal">
              <Icon name="shield" />
              <span>
                Every tab.
                <br />
                Your approval.
              </span>
            </div>
          </div>
          <ModeDemo />
          <div className="permission-facts">
            <p>
              <span className="status-dot" />
              Up to five approved tabs.
              <br />
              <span>Only the active approved tab is transmitted.</span>
            </p>
            <p>
              <Icon name="browser" />
              One authorized browser window.
              <br />
              <span>You choose what becomes shared.</span>
            </p>
          </div>
        </section>

        <section
          className="connection-notes wrap"
          aria-label="Before you connect"
        >
          <details>
            <summary>
              What to know before connecting{" "}
              <span className="details-plus" aria-hidden="true" />
            </summary>
            <div className="connection-facts">
              <p>
                Video and interactions travel directly over WebRTC. A signaling
                server coordinates pairing. Some networks cannot establish a
                direct connection; there is no TURN relay.
              </p>
              <p>
                Clipboard text sync is optional and requires both participants.
                It can include text copied in other Windows applications.
              </p>
              <p>
                Chrome and Edge on Windows are the documented environment.
                Browser tabs only: no audio, desktop sharing, browser chrome, or
                native dialogs. Full control uses synthetic events and may not
                work with every site.
              </p>
            </div>
          </details>
        </section>

        <section
          id="install"
          className="install-section"
          aria-labelledby="install-title"
        >
          <div className="install-top wrap">
            <div>
              <h2 className="install-title" id="install-title">
                <span>Make room</span>
                <span>for two.</span>
              </h2>
              <p>
                Download &amp; install GhostPair in both browsers.
                <br />A shared space starts with you.
              </p>
              <a className="button install-button" href={releases}>
                Get the latest release <Icon name="download" />
              </a>
              <p className="install-compatibility">
                Chrome &amp; Edge · Windows
              </p>
            </div>
            <BrandMark className="install-mark" />
          </div>
          <ol className="install-steps wrap">
            <li>
              <span className="step-number">01</span>
              <h3>Choose your browser</h3>
              <p>
                Download the Chrome or Edge ZIP from the release’s{" "}
                <strong>Assets</strong>. Choose the extension package, rather
                than the source code archive.
              </p>
            </li>
            <li>
              <span className="step-number">02</span>
              <h3>Extract the ZIP</h3>
              <p>
                Keep the extracted folder in a permanent location on your
                computer.
              </p>
            </li>
            <li>
              <span className="step-number">03</span>
              <h3>Load the extension</h3>
              <p>
                Open <code>chrome://extensions</code> or{" "}
                <code>edge://extensions</code>. Enable{" "}
                <strong>Developer mode</strong>, select{" "}
                <strong>Load unpacked</strong>, and choose the folder containing{" "}
                <code>manifest.json</code>.
              </p>
            </li>
          </ol>
        </section>
      </main>

      <footer className="site-footer wrap">
        <a className="brand" href="#main">
          <BrandMark />
          <span>GhostPair</span>
        </a>
        <span className="footer-tagline">Connected, together.</span>
        <a className="github-link" href={repository}>
          <Icon name="github" />
          Built in the open <Icon name="external" />
        </a>
        <a className="back-top" href="#main">
          Back to top <Icon name="arrow" />
        </a>
      </footer>
    </div>
  );
}
