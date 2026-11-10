// Cards other parts of the app add to the home page (after the platform's own): the AI layer's insights. A part
// registers once, at import time; `when` hides a card from those it is not for.
import type { ReactNode } from "react";

export interface HomeWidget {
  key: string;
  order?: number;
  when?: (can: (area: string, level: string) => boolean) => boolean;
  render: () => ReactNode;
}

const WIDGETS: HomeWidget[] = [];

/** Adds a card to the home page; returns an unregister function. */
export function registerHomeWidget(w: HomeWidget): () => void {
  WIDGETS.push(w);
  WIDGETS.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  return () => {
    const i = WIDGETS.indexOf(w);
    if (i >= 0) WIDGETS.splice(i, 1);
  };
}

export const homeWidgets = (): readonly HomeWidget[] => WIDGETS;
