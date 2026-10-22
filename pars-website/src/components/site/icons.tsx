import type { SVGProps } from "react";

/** Line icons drawn for the Pars identity (1.6px strokes, rounded). */
const PATHS: Record<string, string> = {
  epm: "M4 5h16M4 5v14h16M7 9h6M9 13h7M8 17h4",
  migration: "M4 8h11l-3-3M20 16H9l3 3M15 8c3 0 5 2 5 4M9 16c-3 0-5-2-5-4",
  ai: "M12 3l1.9 4.6 4.6 1.9-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9zM19 15l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z",
  custom: "M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16",
  data: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6",
  training: "M2 9l10-5 10 5-10 5zM6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5M22 9v6",
  consulting: "M12 21a9 9 0 100-18 9 9 0 000 18zM15.5 8.5l-2 5-5 2 2-5z",
  agents: "M9 3h6M12 3v3M6 6h12a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2zM9 11v1M15 11v1M9 15h6",
  rag: "M4 4h9a3 3 0 013 3v13H7a3 3 0 01-3-3zM16 20a3 3 0 003-3V7M8 8h5M8 11h5M17.5 14.5L21 18",
  predict: "M3 17l5-5 4 3 7-8M15 7h4v4",
  pattern: "M6 6a2 2 0 100-4 2 2 0 000 4zM18 8a2 2 0 100-4 2 2 0 000 4zM12 14a2 2 0 100-4 2 2 0 000 4zM6 22a2 2 0 100-4 2 2 0 000 4zM18 20a2 2 0 100-4 2 2 0 000 4zM7.5 5l3.2 5.4M16.5 7l-3 4M10.6 13.4L7 18.5M13.5 13.2l3.2 3.6",
  search: "M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4M8 11h6M11 8v6",
  execute: "M13 2L4 14h7l-1 8 9-12h-7z",
  phone: "M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2",
  mail: "M4 6h16v12H4zM4 7l8 6 8-6",
  pin: "M12 21s-7-6.2-7-11a7 7 0 1114 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z",
  clock: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2",
  arrow: "M5 12h14M13 6l6 6-6 6",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5",
  ticket: "M4 7a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 000 6v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2a2 2 0 000-6zM14 5v14",
  play: "M8 5v14l11-7z",
  check: "M5 12l5 5L20 7",
  shield: "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z M9 12l2 2 4-4",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z",
  human: "M12 11a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0",
  close: "M6 6l12 12M18 6L6 18",
  link: "M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1",
  article: "M6 3h9l4 4v14H6zM15 3v4h4M9 11h7M9 14h7M9 17h4",
  menu: "M4 7h16M4 12h16M4 17h10",
  globe: "M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z",
  linkedin: "M4 9h3.5v11H4zM5.7 4a2 2 0 110 4 2 2 0 010-4zM10 9h3.3v1.6c.5-.9 1.7-1.9 3.6-1.9 3.6 0 4.1 2.3 4.1 5.3V20h-3.5v-5.2c0-1.3 0-2.9-1.8-2.9s-2.1 1.4-2.1 2.8V20H10z",
  telegram: "M21 4L3 11l6 2 2 6 3-4 5 4zM9 13l9-7",
  instagram: "M7 3h10a4 4 0 014 4v10a4 4 0 01-4 4H7a4 4 0 01-4-4V7a4 4 0 014-4zM12 16a4 4 0 100-8 4 4 0 000 8zM17.5 6.5h.01",
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "size-5", ...rest }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      <path d={PATHS[name]} />
    </svg>
  );
}
