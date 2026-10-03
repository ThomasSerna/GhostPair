import { useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { Icon } from "./Icons";
import "./product-preview.css";

const previews = {
  shared: {
    label: "Shared view",
    file: "remote-viewer.html",
    width: 1365,
    height: 900,
    title: "One page. Two perspectives.",
    description:
      "The approved tab appears in your guest’s browser. See the same page, then work through the details together.",
    note: "The connected guest viewer",
    frameTitle: "GhostPair connected viewer example",
  },
  host: {
    label: "Host a session",
    file: "share-tab.html",
    width: 398,
    height: 694,
    title: "Start from your browser.",
    description:
      "Choose a session password and authorize sharing. Share your GhostPair address and password with your guest.",
    note: "The host’s browser toolbar popup",
    frameTitle: "GhostPair sharing example",
  },
  guest: {
    label: "Join a session",
    file: "connect-host.html",
    width: 512,
    height: 660,
    title: "A space for two.",
    description:
      "Select Connect to a host in your extension. Enter the address and session password your host shared with you.",
    note: "The full-page connection screen",
    frameTitle: "GhostPair host connection example",
  },
} as const;
type PreviewName = keyof typeof previews;

function PreviewFrame({ name }: { name: PreviewName }) {
  const stage = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const preview = previews[name];
  useLayoutEffect(() => {
    if (!stage.current || !frame.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (frame.current)
        frame.current.style.transform = `scale(${entry.contentRect.width / preview.width})`;
    });
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, [preview.width]);
  return (
    <div
      className={`preview-stage preview-stage-${name}`}
      ref={stage}
      style={{ aspectRatio: `${preview.width} / ${preview.height}` }}
      aria-hidden="true"
    >
      <iframe
        ref={frame}
        src={`assets/previews/${preview.file}`}
        width={preview.width}
        height={preview.height}
        title={preview.frameTitle}
        sandbox="allow-same-origin"
        tabIndex={-1}
        loading="lazy"
      />
    </div>
  );
}

export default function ProductPreview() {
  const [selected, setSelected] = useState<PreviewName>("shared");
  const [visited, setVisited] = useState<PreviewName[]>(["shared"]);
  const switchControl = useRef<HTMLFieldSetElement>(null);
  const activeIndicator = useRef<HTMLSpanElement>(null);
  const moveIndicator = useRef<((animate: boolean) => void) | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const initial = useRef(true);
  const preview = previews[selected];
  useLayoutEffect(() => {
    const control = switchControl.current;
    const indicator = activeIndicator.current;
    if (!control || !indicator) return;

    const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
    let positioned = false;
    function positionIndicator(animate: boolean) {
      const label = control!.querySelector<HTMLLabelElement>(
        "input:checked + label",
      );
      if (!label) return;
      const bounds = control!.getBoundingClientRect();
      const target = label.getBoundingClientRect();
      const current = indicator!.getBoundingClientRect();
      const x = target.left - bounds.left;
      const y = target.top - bounds.top;
      gsap.killTweensOf(indicator);
      gsap.set(indicator, { width: target.width, height: target.height });

      if (positioned && animate && !motionPreference.matches) {
        // FLIP keeps unequal segments and interrupted slides continuous without
        // changing layout on every animation frame.
        gsap.fromTo(
          indicator,
          {
            x: current.left - bounds.left,
            y: current.top - bounds.top,
            scaleX: current.width / target.width,
            scaleY: current.height / target.height,
          },
          {
            x,
            y,
            scaleX: 1,
            scaleY: 1,
            duration: 0.42,
            ease: "back.out(0.55)",
            overwrite: true,
          },
        );
      } else {
        gsap.set(indicator, { x, y, scaleX: 1, scaleY: 1 });
      }
      positioned = true;
      control!.dataset.indicatorReady = "true";
    }

    moveIndicator.current = positionIndicator;
    positionIndicator(false);
    const observer = new ResizeObserver(() => positionIndicator(false));
    observer.observe(control);
    control.querySelectorAll("label").forEach((label) => observer.observe(label));
    const reduceMotion = () => positionIndicator(false);
    motionPreference.addEventListener("change", reduceMotion);
    return () => {
      observer.disconnect();
      motionPreference.removeEventListener("change", reduceMotion);
      gsap.killTweensOf(indicator);
      moveIndicator.current = null;
    };
  }, []);
  useLayoutEffect(() => {
    moveIndicator.current?.(true);
  }, [selected]);
  useEffect(() => {
    if (initial.current) {
      initial.current = false;
      return;
    }
    if (
      matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !panel.current
    )
      return;
    const context = gsap.context(() => {
      gsap.fromTo(
        panel.current,
        { opacity: 0.65, y: 12, clipPath: "inset(0 0 3% 0)" },
        {
          opacity: 1,
          y: 0,
          clipPath: "inset(0 0 0% 0)",
          duration: 0.55,
          ease: "expo.out",
          clearProps: "transform,opacity,clipPath",
        },
      );
    }, panel);
    return () => context.revert();
  }, [selected]);
  function choose(name: PreviewName) {
    setSelected(name);
    setVisited((current) =>
      current.includes(name) ? current : [...current, name],
    );
  }
  return (
    <div className="product-preview">
      <div className="preview-toolbar">
        <fieldset className="preview-switch" ref={switchControl}>
          <legend className="sr-only">Choose an interface example</legend>
          <span
            className="preview-active-indicator"
            ref={activeIndicator}
            aria-hidden="true"
          />
          {(Object.keys(previews) as PreviewName[]).map((name) => (
            <div className="preview-option" key={name}>
              <input
                className="sr-only"
                type="radio"
                name="preview"
                id={`preview-${name}`}
                checked={selected === name}
                onChange={() => choose(name)}
              />
              <label htmlFor={`preview-${name}`}>{previews[name].label}</label>
            </div>
          ))}
        </fieldset>
        <span className="example-label">
          <span className="status-dot" />
          The real interface. Example data.
        </span>
      </div>
      <div className={`gallery-panel gallery-panel-${selected}`} ref={panel}>
        <div className="gallery-description">
          <Icon name="browser" />
          <h3>{preview.title}</h3>
          <p>{preview.description}</p>
          <span className="gallery-note">
            {selected === "host"
              ? "You approve every shared tab locally."
              : selected === "guest"
                ? "One host. One guest."
                : "Sessions start in Visual only."}
          </span>
          <a
            className="text-link"
            href={`assets/previews/${preview.file}`}
            target="_blank"
            rel="noopener"
          >
            Open full-size example <Icon name="external" />
          </a>
        </div>
        <div className="gallery-stage">
          {(Object.keys(previews) as PreviewName[]).map((name) => (
            <figure
              className={`preview-figure preview-figure-${name}`}
              id={`${name}-preview`}
              key={name}
              hidden={name !== selected}
            >
              {visited.includes(name) && (
                <a
                  className="preview-link"
                  href={`assets/previews/${previews[name].file}`}
                  target="_blank"
                  rel="noopener"
                  aria-label={`Open the ${previews[name].label.toLowerCase()} example at full size`}
                >
                  <PreviewFrame name={name} />
                </a>
              )}
              <figcaption>{previews[name].note}</figcaption>
            </figure>
          ))}
        </div>
      </div>
    </div>
  );
}
