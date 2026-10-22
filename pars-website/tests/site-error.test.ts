import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import FaError from "@/app/(fa)/(site)/error";
import EnError from "@/app/(en)/en/(site)/error";

type Props = { error: Error & { digest?: string }; retry: () => void };

/** The first element in the tree with an onClick handler (the retry button). */
function clickable(node: ReactNode): ReactElement<{ onClick: () => void }> | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = clickable(n);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement<{ onClick?: () => void; children?: ReactNode }>(node)) return null;
  if (typeof node.props.onClick === "function") return node as ReactElement<{ onClick: () => void }>;
  return clickable(node.props.children);
}

describe.each([
  { lang: "fa", Page: FaError, home: "/", title: "مشکلی پیش آمد", retryLabel: "دوباره امتحان کنید" },
  { lang: "en", Page: EnError, home: "/en", title: "Something went wrong", retryLabel: "Try again" },
] as const)("site error boundary ($lang)", ({ Page, home, title, retryLabel }) => {
  const props: Props = { error: Object.assign(new Error("boom"), { digest: "d1" }), retry: () => {} };

  it("renders localized copy, a retry button and a home link, without the raw error", () => {
    const html = renderToStaticMarkup(createElement(Page, props));
    expect(html).toContain(title);
    expect(html).toContain(retryLabel);
    expect(html).toContain(`href="${home}"`);
    expect(html).not.toContain("boom");
  });

  it("calls retry() from the button", () => {
    const retry = vi.fn();
    const button = clickable(Page({ ...props, retry }));
    expect(button).not.toBeNull();
    button!.props.onClick();
    expect(retry).toHaveBeenCalledOnce();
  });
});
