// What other modules plug into ordering: an «assist» under the order form — knowledge management's deflection
// (KB-050: articles for what the person is typing, «مشکلم حل شد» ends the order without a request). Pure registry;
// the request module renders nothing when no module registered one.
import type { ReactNode } from "react";

export interface OrderAssistProps {
  /** the item being ordered */
  itemId: string;
  /** the item's type (record producers such as «گزارش مشکل» deflect first) */
  itemType: string;
  /** what the person typed so far: the text answers of the form */
  text: string;
  /** the person's problem is solved: close the form without ordering */
  onSolved: () => void;
}

let assist: ((p: OrderAssistProps) => ReactNode) | null = null;

/** Register the assist under the order form (a later registration replaces the earlier one). */
export function registerOrderAssist(render: (p: OrderAssistProps) => ReactNode): () => void {
  assist = render;
  return () => {
    if (assist === render) assist = null;
  };
}

export const orderAssist = (): ((p: OrderAssistProps) => ReactNode) | null => assist;

/** The text answers of a form, for deflection: short texts first, at most 300 characters. */
export function typedText(answers: Record<string, unknown>): string {
  const parts = Object.values(answers).filter((v): v is string => typeof v === "string" && v.trim().length > 0 && !/^[0-9a-f-]{36}$/i.test(v) && !/^\d{4}-\d{2}-\d{2}/.test(v));
  return parts.sort((a, b) => a.length - b.length).join(" ").replace(/\s+/g, " ").trim().slice(0, 300);
}
