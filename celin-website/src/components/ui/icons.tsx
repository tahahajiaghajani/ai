import type { SVGProps } from "react";

/**
 * Thin-line icon set (24px grid, 1.25 stroke, square caps) shared by the site and the admin panel.
 * Directional icons (arrow, chevron) point "forward" in the reading direction: add `flip` on RTL pages
 * via the `rtl:-scale-x-100` utility where needed.
 */

const PATHS = {
  search: "M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15Zm5.3-2.2L21 21",
  bag: "M5 8h14l-1 13H6L5 8Zm4 0V6.5a3 3 0 0 1 6 0V8",
  user: "M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm-8 9c.6-4 3.9-6.5 8-6.5s7.4 2.5 8 6.5",
  menu: "M3 7h18M3 12h18M3 17h18",
  close: "M6 6l12 12M18 6 6 18",
  chevron: "m9 5 7 7-7 7",
  "chevron-down": "m5 9 7 7 7-7",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  heart: "M12 20s-7.5-4.6-9.2-9.4C1.6 7.1 3.9 4 7.2 4c2 0 3.6 1.2 4.8 3 1.2-1.8 2.8-3 4.8-3 3.3 0 5.6 3.1 4.4 6.6C19.5 15.4 12 20 12 20Z",
  lock: "M6 10.5h12V21H6V10.5Zm2.5 0V7.5a3.5 3.5 0 0 1 7 0v3",
  unlock: "M6 10.5h12V21H6V10.5Zm2.5 0V7.5a3.5 3.5 0 0 1 6.9-.8",
  check: "m5 12.5 4.5 4.5L19 7.5",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  trash: "M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5",
  edit: "M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4",
  image: "M3.5 5.5h17v13h-17v-13Zm0 10 5-5 4 4 2.5-2.5 5 5M15.5 9.5h.01",
  upload: "M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4",
  copy: "M8 8h11v12H8V8Zm-3 8V4h11",
  share: "M12 4v11m-4.5-6.5L12 4l4.5 4.5M5 13v7h14v-7",
  phone: "M5 4h3.5l1.5 4.5-2 1.5a11 11 0 0 0 6 6l1.5-2 4.5 1.5V19a1.5 1.5 0 0 1-1.6 1.5C10.5 20 4 13.5 3.5 5.6A1.5 1.5 0 0 1 5 4Z",
  whatsapp: "M4 20l1.3-4A8 8 0 1 1 8.4 19L4 20Zm5-11.5c0 3.6 3 6.5 6.5 6.5l1.3-1.6-2-1-1 .8a4.5 4.5 0 0 1-2.5-2.5l.8-1-1-2L9.5 8.5H9",
  telegram: "M21 4 3 11.5l6 2 2 6 3-4 5 3.5L21 4ZM9 13.5l9-6.5",
  instagram: "M4 4h16v16H4V4Zm8 12.2a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4ZM17 7h.01",
  mail: "M3.5 6h17v12h-17V6Zm0 .5L12 13l8.5-6.5",
  sms: "M4 5h16v11H9l-5 4V5Zm4 5.5h.01M12 10.5h.01M16 10.5h.01",
  external: "M14 4h6v6m0-6-9 9M10 6H4v14h14v-6",
  eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Zm9.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  "eye-off": "M4 4l16 16M10 6c.6-.3 1.3-.5 2-.5 6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4M6.6 7.6C4 9.3 2.5 12 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2",
  filter: "M4 6h16M7 12h10M10 18h4",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.5-3 1.5-1-1.5-3-1.8.4a7 7 0 0 0-1.4-.8L15.8 5h-3.6l-.5 1.8a7 7 0 0 0-1.4.8L8.5 7 7 10l1.5 1v2L7 14l1.5 3 1.8-.4c.4.3.9.6 1.4.8l.5 1.6h3.6l.5-1.6c.5-.2 1-.5 1.4-.8l1.8.4 1.5-3-1.5-1v-2Z",
  box: "M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9Zm0 0L12 12m0 0 8.5-4.5M12 12v9",
  users: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9c.5-3.4 3-5.5 6-5.5s5.5 2.1 6 5.5M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.8c1.7.8 2.8 2.6 3 5.2",
  diamond: "M6.5 4h11L21 9l-9 11L3 9l3.5-5Zm-3.5 5h18M9.5 4 12 9l2.5-5M12 9v11",
  tag: "M3.5 3.5h8l9 9-8 8-9-9v-8Zm4.5 4.5h.01",
  dashboard: "M4 4h7v7H4V4Zm9 0h7v4h-7V4Zm0 6h7v10h-7V10ZM4 13h7v7H4v-7Z",
  link: "M10 14a4 4 0 0 0 6 .5l3-3a4 4 0 0 0-5.7-5.7L12 7M14 10a4 4 0 0 0-6-.5l-3 3a4 4 0 0 0 5.7 5.7L12 17",
  logout: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10",
  refresh: "M4.5 12a7.5 7.5 0 0 1 13-5.1L20 9.5M20 4.5v5h-5M19.5 12a7.5 7.5 0 0 1-13 5.1L4 14.5M4 19.5v-5h5",
  drag: "M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-10v6m0-9.5h.01",
  warning: "M12 4 2.5 20h19L12 4Zm0 6v4.5m0 3h.01",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9Z",
  truck: "M2.5 6.5h11v9h-11v-9Zm11 3h4l3 3v3h-7v-6ZM6.5 18.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm11 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
  gift: "M4 10h16v10H4V10Zm-1-3.5h18V10H3V6.5ZM12 6.5V20M12 6.5C10.5 3 7 3.5 7.5 5.5c.3 1 2 1 4.5 1Zm0 0c1.5-3.5 5-3 4.5-1-.3 1-2 1-4.5 1Z",
  sparkle: "M12 3l1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3Z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v4.5l3 2",
  print: "M7 9V3.5h10V9M7 17H4v-7.5h16V17h-3M7 14h10v6.5H7V14Z",
  map: "M12 21s-6.5-6-6.5-11A6.5 6.5 0 0 1 18.5 10c0 5-6.5 11-6.5 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "size-5", strokeWidth = 1.25, ...rest }: { name: IconName; className?: string; strokeWidth?: number } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="square" strokeLinejoin="miter" aria-hidden className={className} {...rest}>
      <path d={PATHS[name]} />
    </svg>
  );
}
