import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { BrandMark, Icon } from "./components/Icons";
import "./pages.css";

const HomePage = lazy(() => import("./pages/HomePage"));
const InstallationPage = lazy(() => import("./pages/InstallationPage"));
const ExplorePage = lazy(() => import("./pages/ExplorePage"));
const repository = "https://github.com/ThomasSerna/GhostPair";
type View = "home" | "installation" | "explore";

function SiteHeader({ view }: { view: View }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const home = view === "home" ? "" : "./";
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
  return <header className="site-header wrap">
    <a className="brand" href={`${home}#main`} aria-label="GhostPair home"><BrandMark /><span>GhostPair</span></a>
    <nav id="main-nav" className={menuOpen ? "main-nav is-open" : "main-nav"} aria-label="Main navigation">
      <a href={`${home}#main`} aria-current={view === "home" ? "page" : undefined} onClick={() => setMenuOpen(false)}>Home</a>
      <a href="?view=installation" aria-current={view === "installation" ? "page" : undefined} onClick={() => setMenuOpen(false)}>Installation</a>
      <a href="?view=explore" aria-current={view === "explore" ? "page" : undefined} onClick={() => setMenuOpen(false)}>Explore</a>
    </nav>
    <button className="menu-toggle" ref={menuButton} type="button" aria-expanded={menuOpen} aria-controls="main-nav" aria-label={menuOpen ? "Close navigation" : "Open navigation"} onClick={() => setMenuOpen(!menuOpen)}><Icon name={menuOpen ? "close" : "menu"} /></button>
  </header>;
}

function SiteFooter({ view }: { view: View }) {
  return <footer className="site-footer wrap">
    <a className="brand" href={view === "home" ? "#main" : "./#main"}><BrandMark /><span>GhostPair</span></a>
    <span className="footer-tagline">Connected, together.</span>
    <a className="github-link" href={repository}><Icon name="github" />Built in the open <Icon name="external" /></a>
    <a className="back-top" href="#main">Back to top <Icon name="arrow" /></a>
  </footer>;
}

function InitialAnchor() {
  useEffect(() => {
    let active = true;
    void document.fonts.ready.then(() => {
      if (!active || !location.hash) return;
      try { document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView({ behavior: "instant" }); }
      catch { /* An invalid fragment leaves the screen at its initial position. */ }
    });
    return () => { active = false; };
  }, []);
  return null;
}

export default function App() {
  const requested = new URLSearchParams(location.search).get("view");
  const view: View = requested === "installation" || requested === "explore" ? requested : "home";
  useEffect(() => { document.title = view === "home" ? "GhostPair · Browse together." : `GhostPair · ${view === "installation" ? "Installation" : "Explore"}`; }, [view]);
  return <div className="site">
    <a className="skip-link" href="#main">Skip to content</a>
    <SiteHeader view={view} />
    <Suspense fallback={<main id="main" tabIndex={-1} className="page-loading wrap" aria-busy="true"><p role="status">Opening GhostPair…</p></main>}>
      {view === "installation" ? <InstallationPage /> : view === "explore" ? <ExplorePage /> : <HomePage />}
      <InitialAnchor />
    </Suspense>
    <SiteFooter view={view} />
  </div>;
}
