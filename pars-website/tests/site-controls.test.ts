import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ path: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path }));

import { LangLink, langPath } from "@/components/site/lang-link";
import { MotionToggle } from "@/components/site/motion-toggle";

describe("langPath", () => {
  it.each([
    ["/", "en", "/en"],
    ["/support", "en", "/en/support"],
    ["/support/t/PP-7K3QX9", "en", "/en/support/t/PP-7K3QX9"],
    ["/en", "fa", "/"],
    ["/en/support", "fa", "/support"],
    ["/en/support/t/PP-7K3QX9", "fa", "/support/t/PP-7K3QX9"],
  ] as const)("%s → %s: %s", (path, to, expected) => {
    expect(langPath(path, to)).toBe(expected);
  });
});

describe("LangLink", () => {
  it("prerenders the other language's path (the query is added after mount)", () => {
    nav.path = "/support/t/PP-7K3QX9";
    const html = renderToStaticMarkup(createElement(LangLink, { to: "en", children: "English" }));
    expect(html).toBe('<a href="/en/support/t/PP-7K3QX9" hrefLang="en" lang="en">English</a>');
  });
});

describe("MotionToggle", () => {
  it("keeps one label so it matches aria-pressed", () => {
    const html = renderToStaticMarkup(createElement(MotionToggle, { reduceLabel: "کاهش حرکت", fullLabel: "حرکت کامل" }));
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("کاهش حرکت");
    expect(html).not.toContain("حرکت کامل");
  });
});
