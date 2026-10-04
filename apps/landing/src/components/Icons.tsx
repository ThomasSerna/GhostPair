import type { ReactNode, SVGProps } from "react";

type IconName =
  | "arrow"
  | "download"
  | "github"
  | "browser"
  | "check"
  | "shield"
  | "close"
  | "menu"
  | "copy"
  | "plus"
  | "external";
const paths: Record<Exclude<IconName, "github">, ReactNode> = {
  arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
  download: <path d="M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4" />,
  browser: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M3 9h18M7 6.5h.01M10 6.5h.01" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  shield: (
    <>
      <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  close: <path d="m6 6 12 12M6 18 18 6" />,
  menu: <path d="M4 8h16M4 16h16" />,
  copy: <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V3H3v13h5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  external: <path d="M8 5H5v14h14v-3M12 5h7v7M10 14l9-9" />,
};

export function Icon({
  name,
  ...props
}: SVGProps<SVGSVGElement> & { name: IconName }) {
  return (
    <svg
      className={`icon${name === "github" ? " github-icon" : ""}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill={name === "github" ? "currentColor" : "none"}
      stroke={name === "github" ? "none" : "currentColor"}
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {name === "github" ? (
        <path d="M12 .75a11.25 11.25 0 0 0-3.558 21.923c.563.104.769-.244.769-.542 0-.267-.01-1.155-.016-2.095-3.13.68-3.791-1.327-3.791-1.327-.512-1.3-1.249-1.645-1.249-1.645-1.021-.698.077-.684.077-.684 1.13.08 1.724 1.16 1.724 1.16 1.004 1.722 2.634 1.224 3.276.936.102-.728.393-1.225.715-1.507-2.499-.284-5.126-1.25-5.126-5.56 0-1.228.439-2.232 1.159-3.02-.117-.285-.503-1.428.11-2.978 0 0 .944-.302 3.094 1.153a10.787 10.787 0 0 1 5.632 0c2.148-1.455 3.09-1.153 3.09-1.153.615 1.55.23 2.693.113 2.978.722.788 1.158 1.792 1.158 3.02 0 4.322-2.631 5.273-5.138 5.552.404.35.766 1.034.766 2.084 0 1.506-.014 2.721-.014 3.09 0 .3.203.65.774.54A11.252 11.252 0 0 0 12 .75Z" />
      ) : (
        paths[name]
      )}
    </svg>
  );
}

export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`brand-mark ${className}`}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M16 12h-2a7 7 0 0 0 0 14h7a7 7 0 0 0 0-14h-2M24 28h2a7 7 0 0 0 0-14h-7a7 7 0 0 0 0 14h2"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
