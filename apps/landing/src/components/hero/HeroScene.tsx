import { useEffect, useRef, useState } from "react";
import desktopVideo from "../../assets/hero/signal-desktop.mp4";
import mobileVideo from "../../assets/hero/signal-mobile.mp4";
import desktopPoster from "../../assets/hero/signal-desktop.webp";
import mobilePoster from "../../assets/hero/signal-mobile.webp";

export default function HeroScene() {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    const video = videoRef.current;
    if (!container || !video) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const compact = window.matchMedia("(max-width: 700px)");
    let visible = false;
    let failed = false;
    let disposed = false;
    let playAttempt = 0;

    const canPlay = () => visible && !document.hidden && !reduced.matches && !failed;
    const syncPlayback = () => {
      const attempt = ++playAttempt;
      if (reduced.matches) {
        video.pause();
        // Reduced motion also avoids downloading the animation on first visit.
        if (video.hasAttribute("src")) {
          video.removeAttribute("src");
          video.load();
        }
        setPlaying(false);
        return;
      }
      if (!canPlay()) {
        video.pause();
        return;
      }
      const source = compact.matches ? mobileVideo : desktopVideo;
      if (video.getAttribute("src") !== source) {
        setPlaying(false);
        video.src = source;
      }
      void video.play().catch(() => {
        // A pending play can be interrupted by scrolling away or changing media.
        if (disposed || attempt !== playAttempt || !canPlay()) return;
        failed = true;
        video.pause();
        setPlaying(false);
      });
    };
    const onPlaying = () => {
      if (canPlay()) setPlaying(true);
      else video.pause();
    };
    const onError = () => {
      failed = true;
      video.pause();
      setPlaying(false);
    };
    const onMediaChange = () => {
      failed = false;
      syncPlayback();
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      syncPlayback();
    });
    observer.observe(container);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("error", onError);
    reduced.addEventListener("change", onMediaChange);
    compact.addEventListener("change", onMediaChange);
    document.addEventListener("visibilitychange", syncPlayback);

    return () => {
      disposed = true;
      ++playAttempt;
      observer.disconnect();
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("error", onError);
      reduced.removeEventListener("change", onMediaChange);
      compact.removeEventListener("change", onMediaChange);
      document.removeEventListener("visibilitychange", syncPlayback);
    };
  }, []);

  return (
    <div className="hero-scene" ref={containerRef} data-playing={playing} aria-hidden="true">
      <picture className="hero-scene-still">
        <source media="(max-width: 700px)" srcSet={mobilePoster} />
        <img className="hero-scene-poster" src={desktopPoster} alt="" width="1280" height="1080" fetchPriority="high" />
      </picture>
      <video ref={videoRef} autoPlay muted loop playsInline preload="auto" disablePictureInPicture tabIndex={-1} />
    </div>
  );
}
