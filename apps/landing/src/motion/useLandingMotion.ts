import { useLayoutEffect, type RefObject } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

export function useLandingMotion(
  root: RefObject<HTMLElement | null>,
  sceneProgress: RefObject<number>,
  paused: boolean,
) {
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const media = gsap.matchMedia();
    media.add(
      {
        motion: "(prefers-reduced-motion: no-preference)",
        desktop: "(min-width: 900px)",
      },
      (context) => {
        if (!context.conditions?.motion || paused) return;
        const select = gsap.utils.selector(element);
        gsap
          .timeline({ defaults: { ease: "expo.out", duration: 1.5 } })
          .from(select(".hero-line"), {
            y: 42,
            opacity: 0.65,
            stagger: 0.1,
            clearProps: "transform,opacity",
          })
          .from(
            select(".hero-description, .hero-actions, .hero-availability"),
            {
              y: 20,
              opacity: 0.7,
              stagger: 0.08,
              clearProps: "transform,opacity",
            },
            0.2,
          )
          .from(
            select(".hero-art"),
            { scale: 0.93, duration: 2, clearProps: "transform" },
            0,
          );
        if (context.conditions.desktop) {
          gsap.to(select(".hero-art"), {
            y: -70,
            ease: "none",
            scrollTrigger: {
              trigger: select(".hero")[0],
              start: "top top",
              end: "bottom top",
              scrub: 1,
            },
          });
          ScrollTrigger.create({
            trigger: select(".hero")[0],
            start: "top top",
            end: "bottom top",
            onUpdate: (trigger) => {
              sceneProgress.current = trigger.progress;
            },
          });
        }
        const path = element.querySelector<SVGPathElement>(".signal-path");
        if (path) {
          const length = path.getTotalLength();
          gsap.set(path, { strokeDasharray: length, strokeDashoffset: length });
          gsap
            .timeline({
              scrollTrigger: {
                trigger: select(".connection-stage")[0],
                start: "top 80%",
                end: "bottom 35%",
                scrub: 0.7,
              },
            })
            .to(path, { strokeDashoffset: 0, duration: 1.8, ease: "none" }, 0)
            .fromTo(
              select(".connection-node"),
              { y: 18, opacity: 0.5 },
              {
                y: 0,
                opacity: 1,
                duration: 0.65,
                stagger: 0.5,
                ease: "power2.out",
              },
              0,
            )
            .fromTo(
              select(".connection-core .brand-mark"),
              { rotate: -15, scale: 0.9 },
              { rotate: 0, scale: 1, duration: 1.3, ease: "power2.out" },
              0.3,
            );
        }
        select("[data-reveal]").forEach((target: Element) => {
          gsap.from(target, {
            y: 28,
            opacity: 0.72,
            filter: "blur(3px)",
            duration: 1.15,
            ease: "expo.out",
            clearProps: "transform,opacity,filter",
            scrollTrigger: { trigger: target, start: "top 92%", once: true },
          });
        });
        gsap.from(select(".install-title span"), {
          y: 30,
          stagger: 0.12,
          duration: 1.3,
          ease: "expo.out",
          clearProps: "transform",
          scrollTrigger: {
            trigger: select(".install-section")[0],
            start: "top 80%",
            once: true,
          },
        });
      },
      element,
    );
    let active = true;
    void document.fonts.ready.then(() => {
      if (active) ScrollTrigger.refresh();
    });
    return () => {
      active = false;
      media.revert();
      sceneProgress.current = 0;
    };
  }, [root, sceneProgress, paused]);
}
