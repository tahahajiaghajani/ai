import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { commonCopy } from "@/content/copy/common";

/**
 * The top bar of the sixth round: «ورود» and «عضویت» in words (Sign in / Join), and a larger logo — the official
 * artwork scaled whole (its «گالری اعتماد» and «Handmade Jewelry» lines live only inside it) in a header tall
 * enough to keep room above and below it at every width.
 */

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const header = read("src/components/site/header.tsx");
const css = read("src/app/globals.css");

describe("top bar words", () => {
  it("reads «ورود» and «عضویت» (Sign in / Join)", () => {
    expect(commonCopy("fa").nav.signIn).toBe("ورود");
    expect(commonCopy("fa").nav.join).toBe("عضویت");
    expect(commonCopy("en").nav.signIn).toBe("Sign in");
    expect(commonCopy("en").nav.join).toBe("Join");
    expect("membersSignIn" in commonCopy("fa").nav).toBe(false);
    expect(header).not.toContain("membersSignIn");
  });

  it("sets «عضویت» like «ورود»: never letter-spaced, its visible word is its name, and it still opens /pro", () => {
    const join = /<Link href=\{href\(lang, "\/pro"\)\}[^>]*>\s*\{c\.nav\.join\}\s*<\/Link>/.exec(header)?.[0];
    expect(join).toBeTruthy();
    expect(join).not.toMatch(/tracking-|\bltr\b|aria-label/);
    expect(join).toContain("text-[13px] font-semibold");
    // the Pro account keeps its gold PRO chip
    expect(header).toMatch(/href=\{href\(lang, "\/account\/pro"\)\}[\s\S]{0,400}PRO/);
  });
});

describe("the logo in the header", () => {
  const px = (rem: number) => rem * 16;
  const logo = /<Logo lang=\{lang\} className="h-(\d+) lg:h-(\d+)"/.exec(header);
  const heights = [...css.matchAll(/--header-h:\s*(\d+)px/g)].map((m) => Number(m[1]));

  it("is 64px tall below 1024px and 80px from there", () => {
    expect(logo).toBeTruthy();
    expect(px(Number(logo![1]) / 4)).toBe(64);
    expect(px(Number(logo![2]) / 4)).toBe(80);
  });

  it("keeps at least 4px above and below it at every width", () => {
    // phones, from 768px, from 1024px (the logo's lg step)
    expect(heights).toEqual([72, 80, 88]);
    expect(css).toMatch(/@media \(min-width: 1024px\) \{\s*:root \{\s*--header-h: 88px;/);
    const [phone, tablet, desktop] = heights;
    expect(phone - 64).toBeGreaterThanOrEqual(8);
    expect(tablet - 64).toBeGreaterThanOrEqual(8);
    expect(desktop - 80).toBeGreaterThanOrEqual(8);
  });

  it("is the official artwork, scaled whole and never redrawn", () => {
    for (const f of ["public/brand/celin-logo.svg", "public/brand/celin-logo-reverse.svg"]) expect(read(f)).toContain('viewBox="144 76 794 379"');
    expect(header.match(/width=\{794\} height=\{379\}/g)).toHaveLength(2);
    expect(header).toMatch(/className=\{`h-full w-auto/);
  });
});
