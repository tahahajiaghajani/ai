// Module widgets on the dashboard. Each enabled module may add cards here.
import type { ReactNode } from "react";

export interface DashboardWidget {
  key: string;
  module?: "goods" | "gold" | "fx";
  order: number;
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
