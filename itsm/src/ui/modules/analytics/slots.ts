// What other parts of the app place on a dashboard page (above its widgets, outside edit and TV modes): the AI
// layer's «پرسش تحلیلی» box and its insight cards. A part registers once, at import time.
import type { ReactNode } from "react";

export interface DashboardSlot {
  key: string;
  order?: number;
  render: (c: { home: boolean; dashboardId: string }) => ReactNode;
}

const SLOTS: DashboardSlot[] = [];

/** Adds a slot to every dashboard page; returns an unregister function. */
export function registerDashboardSlot(s: DashboardSlot): () => void {
  SLOTS.push(s);
  SLOTS.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  return () => {
    const i = SLOTS.indexOf(s);
    if (i >= 0) SLOTS.splice(i, 1);
  };
}

export const dashboardSlots = (): readonly DashboardSlot[] => SLOTS;
