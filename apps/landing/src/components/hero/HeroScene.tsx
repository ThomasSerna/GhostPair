import { useEffect, useRef, useState, type RefObject } from "react";
import { createSignalRenderer } from "./signal-renderer";

export interface HeroSceneProps {
  /** Normalized GSAP scroll progress; sampled without React rerenders. */
  progressRef?: RefObject<number>;
  /** Alternate input name for consumers that already expose progress. */
  progress?: RefObject<number>;
  paused?: boolean;
}

export default function HeroScene({
  progressRef,
  progress,
  paused = false,
}: HeroSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pausedRef = useRef(paused);
  const scrollRef = useRef(progressRef ?? progress);
  const wakeRef = useRef<(() => void) | null>(null);
  const [useFallback, setUseFallback] = useState(false);
  pausedRef.current = paused;
  scrollRef.current = progressRef ?? progress;

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const renderer = createSignalRenderer(canvas);
    if (!renderer) {
      setUseFallback(true);
      return;
    }

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const coarse = window.matchMedia("(pointer: coarse)");
    let visible = true;
    let frame = 0;
    let elapsed = 0;
    let previous = 0;
    let lastDraw = 0;
    let disposed = false;
    let drawInterval = 1000 / 30;
    let averageDrawTime = 0;
    let sampledFrames = 0;

    const draw = (time: number) => {
      frame = 0;
      if (disposed) return;
      const animate =
        visible && !document.hidden && !reduced.matches && !pausedRef.current;
      if (animate) {
        elapsed += previous ? Math.min(time - previous, 64) : 0;
        previous = time;
        // This slowly moving object needs 30fps. Keeping the canvas below
        // display refresh rate leaves headroom for GSAP's scroll transitions.
        if (time - lastDraw >= drawInterval) {
          renderer.setProgress(scrollRef.current?.current ?? 0);
          const started = performance.now();
          renderer.render(elapsed);
          const cost = performance.now() - started;
          averageDrawTime = sampledFrames ? averageDrawTime * 0.9 + cost * 0.1 : cost;
          sampledFrames += 1;
          // Preserve the geometry on slower devices, but spend fewer frames
          // drawing it so the page's scroll interactions retain headroom.
          if (sampledFrames > 12) drawInterval = 1000 / (averageDrawTime > 12 ? 20 : 30);
          lastDraw = time;
        }
        frame = window.requestAnimationFrame(draw);
      } else {
        previous = 0;
        renderer.setProgress(scrollRef.current?.current ?? 0);
        renderer.render(elapsed);
      }
    };

    const requestDraw = () => {
      if (!frame && !disposed) frame = window.requestAnimationFrame(draw);
    };
    wakeRef.current = requestDraw;
    const resize = () => {
      const bounds = container.getBoundingClientRect();
      const maxDpr = coarse.matches ? 1.5 : 1.75;
      renderer.resize(
        bounds.width,
        bounds.height,
        Math.min(window.devicePixelRatio || 1, maxDpr),
      );
      requestDraw();
    };
    const onPointer = (event: PointerEvent) => {
      if (coarse.matches || reduced.matches) return;
      const bounds = container.getBoundingClientRect();
      renderer.setPointer(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        ((event.clientY - bounds.top) / bounds.height) * 2 - 1,
      );
    };
    const onPointerLeave = () => renderer.setPointer(0, 0);
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry?.isIntersecting ?? false;
        requestDraw();
      },
      { rootMargin: "60px" },
    );
    const resizeObserver = new ResizeObserver(resize);

    observer.observe(container);
    resizeObserver.observe(container);
    reduced.addEventListener("change", requestDraw);
    document.addEventListener("visibilitychange", requestDraw);
    container.addEventListener("pointermove", onPointer, { passive: true });
    container.addEventListener("pointerleave", onPointerLeave);
    resize();

    return () => {
      disposed = true;
      wakeRef.current = null;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      resizeObserver.disconnect();
      reduced.removeEventListener("change", requestDraw);
      document.removeEventListener("visibilitychange", requestDraw);
      container.removeEventListener("pointermove", onPointer);
      container.removeEventListener("pointerleave", onPointerLeave);
      renderer.dispose();
    };
  }, []);

  // Changing paused can resume a stopped loop without recreating its geometry.
  useEffect(() => {
    wakeRef.current?.();
  }, [paused]);

  return (
    <div className="hero-scene" ref={containerRef} aria-hidden="true">
      <canvas
        ref={canvasRef}
        style={{ display: useFallback ? "none" : "block", width: "100%", height: "100%" }}
      />
      {useFallback && <svg viewBox="0 0 620 600" focusable="false" style={{ display: "block", width: "100%", height: "100%" }}>
        <g fill="none" strokeWidth="24" strokeLinecap="round">
          <ellipse cx="238" cy="282" rx="148" ry="106" transform="rotate(-28 238 282)" stroke="#9ddaab" />
          <ellipse cx="385" cy="322" rx="138" ry="103" transform="rotate(28 385 322)" stroke="#568c67" />
          <path d="M118 358 C167 404 266 385 333 321" stroke="#0c1714" strokeWidth="34" />
          <path d="M118 358 C167 404 266 385 333 321" stroke="#9ddaab" />
        </g>
      </svg>}
    </div>
  );
}
