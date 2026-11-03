// Module widgets on the dashboard. Each enabled module may add cards here; they are laid out two to a row in
// `order`, and a widget with `span: 2` takes a whole row. Widgets build on ./kit (Card, Stat, Amt, Sk…) so every
// card on «پیشخوان» reads as one system.
import type { ReactNode } from "react";

export interface DashboardWidget {
  key: string;
  module?: "goods" | "gold" | "fx";
  order: number;
  /** 2: a full row on wide screens */
  span?: 1 | 2;
  render: () => ReactNode;
}

const widgets: DashboardWidget[] = [];

export function registerWidget(w: DashboardWidget) {
  if (!widgets.some((x) => x.key === w.key)) widgets.push(w);
  widgets.sort((a, b) => a.order - b.order);
}

export function getWidgets() {
  return widgets;
}
