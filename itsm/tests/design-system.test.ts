// The «کاریز» design system: tokens meet WCAG AA in both themes, the chart palettes stay colour-blind safe, the antd
// palette is generated from the tokens, every token the UI reads exists, the cascade-layer order is pinned before
// any stylesheet, and the brand assets have the formats the installer and the browsers expect.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { checkTokens, parseTokens, paletteSource, parseColor, contrast, resolveVar, PALETTE_FILE } from "../scripts/ds-tokens";
import { APP_NAME, APP_NAME_EN } from "@shared/constants";
import { BRAND_NAME, BRAND_COLORS, MARK, MARK_SMALL, WORDMARK_FA, WORDMARK_EN, appIconSvg, lockupLayout, lockupSvg, markSvg, wordmarkSvg } from "@shared/brand";

const ROOT = join(__dirname, "..");
const UI = join(ROOT, "src/ui");

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if ([".css", ".ts", ".tsx"].includes(extname(p))) out.push(p);
  }
  return out;
}

describe("design tokens", () => {
  const tokens = parseTokens();

  it("every text, state, priority and graphic pair meets WCAG 2.2 AA in light and dark; charts and ramps pass", () => {
    const failed = checkTokens(tokens).filter((f) => !f.ok);
    expect(failed.map((f) => `${f.mode} · ${f.check} · ${f.detail}`)).toEqual([]);
  });

  it("the two dark blocks are identical and complete", () => {
    expect(tokens.darkAttr.length).toBeGreaterThan(60);
    expect(tokens.darkMedia).toEqual(tokens.darkAttr);
  });

  it("keeps every v1 name (aliases) and defines the names modules used before", () => {
    for (const name of ["--ds-dusk-700", "--ds-grad-dusk", "--ds-grad-dusk-tile", "--ds-sea", "--ds-sea-text", "--ds-sea-tint", "--ds-sea-line", "--ds-radius-2", "--ds-surface-2", "--ds-weight-bold", "--ds-font-num", "--ds-grad-brand"])
      expect(() => resolveVar(tokens.light, name), name).not.toThrow();
    expect(resolveVar(tokens.light, "--ds-dusk-700")).toBe(BRAND_COLORS.firuzeh[700]);
  });

  it("the primary carries white text and the accent reads on every light surface", () => {
    const c = (n: string) => parseColor(resolveVar(tokens.light, n))!;
    expect(contrast(c("--ds-on-accent"), c("--ds-accent"))).toBeGreaterThanOrEqual(4.5);
    for (const s of ["--ds-canvas", "--ds-surface", "--ds-raised", "--ds-sunken", "--ds-well"]) expect(contrast(c("--ds-accent-text"), c(s))).toBeGreaterThanOrEqual(4.5);
  });

  it("src/ui/ds/ds-palette.ts is generated from tokens.css (npx tsx scripts/ds-tokens.ts --write)", () => {
    expect(readFileSync(PALETTE_FILE, "utf8")).toBe(paletteSource(tokens));
  });

  it("every --ds-* token the UI reads without a fallback is defined", () => {
    const files = walk(UI);
    const defined = new Set<string>();
    const used = new Map<string, string>();
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/(--ds-[\w-]+)\s*:/g)) defined.add(m[1]);
      for (const m of src.matchAll(/["'](--ds-[\w-]+)["']\s*[:,)]/g)) defined.add(m[1]); // style objects, setProperty
      for (const m of src.matchAll(/var\((--ds-[\w-]+)\s*\)/g)) if (!used.has(m[1])) used.set(m[1], f.slice(ROOT.length + 1));
    }
    const missing = [...used].filter(([n]) => !defined.has(n)).map(([n, f]) => `${n} (${f})`);
    expect(missing).toEqual([]);
  });
});

describe("the cascade-layer order", () => {
  it("is declared inline before any stylesheet in index.html and matches styles.css", () => {
    const html = readFileSync(join(UI, "index.html"), "utf8");
    const m = /<style>\s*(@layer [^;]+;)\s*<\/style>/.exec(html);
    expect(m, "an inline <style>@layer …;</style>").toBeTruthy();
    const firstSheet = Math.min(...[html.indexOf("<link rel=\"stylesheet\""), html.indexOf("<script")].filter((i) => i >= 0));
    expect(m!.index).toBeLessThan(firstSheet);
    const order = m![1];
    expect(order).toBe("@layer properties, theme, base, antd, components, utilities;");
    expect(readFileSync(join(UI, "styles.css"), "utf8")).toContain(order);
  });
});

describe("the brand drawing", () => {
  it("spells the product's name (else brand.tsx falls back to type and the masters must be redrawn)", () => {
    expect(BRAND_NAME.fa).toBe(APP_NAME);
    expect(BRAND_NAME.en).toBe(APP_NAME_EN);
    expect(WORDMARK_FA.text).toBe(APP_NAME);
    expect(WORDMARK_EN.text).toBe(APP_NAME_EN);
  });

  it("builds well-formed SVG for the mark, wordmarks, lockups and the app icon", () => {
    for (const svg of [markSvg(), markSvg({ px: 16 }), wordmarkSvg("fa"), wordmarkSvg("en"), lockupSvg("horizontal", "fa"), lockupSvg("horizontal", "en"), lockupSvg("stacked", "fa"), appIconSvg({ px: 64 })]) {
      expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="[-\d. ]+"/);
      expect(svg).not.toMatch(/NaN|undefined/);
      expect(svg.trim().endsWith("</svg>")).toBe(true);
    }
    // the horizontal lockups keep the mark at the start of the reading direction
    const fa = lockupLayout("horizontal", "fa").parts;
    const en = lockupLayout("horizontal", "en").parts;
    expect(fa.find((p) => p.kind === "mark")!.x).toBeGreaterThan(fa.find((p) => p.kind === "fa")!.x);
    expect(en.find((p) => p.kind === "mark")!.x).toBeLessThan(en.find((p) => p.kind === "en")!.x);
    expect(MARK_SMALL.stroke).toBeGreaterThan(MARK.stroke);
  });

  it("the committed masters are what brand.ts draws (npx tsx scripts/brand-assets.mts)", () => {
    const logo = join(ROOT, "docs/brand/logo");
    expect(readFileSync(join(logo, "kariz-mark.svg"), "utf8")).toBe(markSvg({ tone: "brand", pad: 1, title: "کاریز" }));
    expect(readFileSync(join(logo, "kariz-lockup-fa.svg"), "utf8")).toBe(lockupSvg("horizontal", "fa", { tone: "brand", pad: 2 }));
    expect(readFileSync(join(logo, "kariz-app-icon.svg"), "utf8")).toBe(appIconSvg({ px: 512 }));
    expect(readFileSync(join(ROOT, "desktop/build/icon.svg"), "utf8")).toBe(appIconSvg({ px: 256 }));
  });
});

describe("brand assets", () => {
  const png = (p: string) => {
    const b = readFileSync(join(ROOT, p));
    expect(b.subarray(1, 4).toString("ascii"), p).toBe("PNG");
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  };
  const bmp = (p: string) => {
    const b = readFileSync(join(ROOT, p));
    expect(b.subarray(0, 2).toString("ascii"), p).toBe("BM");
    return { w: b.readInt32LE(18), h: b.readInt32LE(22), bpp: b.readUInt16LE(28) };
  };

  it("the NSIS sidebar and header are 24-bit bitmaps of the sizes electron-builder expects", () => {
    expect(bmp("desktop/build/installerSidebar.bmp")).toEqual({ w: 164, h: 314, bpp: 24 });
    expect(bmp("desktop/build/installerHeader.bmp")).toEqual({ w: 150, h: 57, bpp: 24 });
  });

  it("the Windows icon holds 16 to 256 px, the PWA and Apple icons have their sizes", () => {
    const ico = readFileSync(join(ROOT, "desktop/build/icon.ico"));
    expect(ico.readUInt16LE(2)).toBe(1);
    const sizes = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico[6 + 16 * i] || 256);
    for (const s of [16, 24, 32, 48, 256]) expect(sizes).toContain(s);
    expect(png("desktop/build/icon.png")).toEqual({ w: 256, h: 256 });
    expect(png("src/ui/static/icons/icon-192.png")).toEqual({ w: 192, h: 192 });
    expect(png("src/ui/static/icons/icon-512.png")).toEqual({ w: 512, h: 512 });
    expect(png("src/ui/static/icons/icon-maskable-512.png")).toEqual({ w: 512, h: 512 });
    expect(png("src/ui/static/apple-touch-icon.png")).toEqual({ w: 180, h: 180 });
    for (const [f, s] of [["tray.png", 16], ["tray@1.5x.png", 24], ["tray@2x.png", 32]] as const) expect(png(`desktop/build/${f}`)).toEqual({ w: s, h: s });
    const fav = readFileSync(join(ROOT, "src/ui/static/favicon.ico"));
    expect(fav.readUInt16LE(4)).toBe(3);
  });
});
