import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PROJECTS } from "@/content/projects";
import { JOURNEY } from "@/content/journey";
import { ORGS } from "@/content/orgs";
import { ui } from "@/content/ui";
import { PRODUCTS } from "@/content/products";
import { POSTS, postImages } from "@/content/blog";
import type { Media } from "@/content/types";

const pub = (p: string) => path.join(__dirname, "..", "public", p.replace(/^\//, ""));
const filled = (s: string) => typeof s === "string" && s.trim().length > 0;

function media(m: Media) {
  if (m.kind === "art") return;
  expect(existsSync(pub(m.src)), m.src).toBe(true);
  if (m.kind === "video") expect(existsSync(pub(m.poster)), m.poster).toBe(true);
  expect(filled(m.alt.fa) && filled(m.alt.en)).toBe(true);
}

describe("projects", () => {
  it("have unique slugs", () => {
    expect(new Set(PROJECTS.map((p) => p.slug)).size).toBe(PROJECTS.length);
  });
  for (const p of PROJECTS) {
    describe(p.slug, () => {
      it("is complete in both languages", () => {
        for (const k of ["title", "kicker", "oneLiner", "period", "role", "context", "status", "challenge", "approach"] as const) {
          expect(filled(p[k].fa), `${k}.fa`).toBe(true);
          expect(filled(p[k].en), `${k}.en`).toBe(true);
        }
        expect(p.features.fa.length).toBe(p.features.en.length);
        for (const o of p.outcomes) expect(filled(o.value.fa) && filled(o.value.en) && filled(o.label.fa) && filled(o.label.en)).toBe(true);
      });
      it("points only at media that exist", () => {
        media(p.cover);
        p.gallery.forEach(media);
      });
      it("has a consistent diagram", () => {
        if (!p.architecture) return;
        const ids = new Set(p.architecture.nodes.map((n) => n.id));
        expect(ids.size).toBe(p.architecture.nodes.length);
        for (const e of p.architecture.edges) {
          expect(ids.has(e.from), e.from).toBe(true);
          expect(ids.has(e.to), e.to).toBe(true);
        }
        for (const n of p.architecture.nodes) {
          expect(n.col).toBeLessThan(p.architecture.cols);
          expect(n.row).toBeLessThan(p.architecture.rows);
        }
      });
      it("names known organisations", () => {
        for (const o of p.orgs ?? []) expect(ORGS.some((x) => x.key === o), o).toBe(true);
      });
    });
  }
});

describe("products", () => {
  it("have unique slugs that are not other section ids", () => {
    const slugs = PRODUCTS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const taken = ["about", "products", "expertise", "work", "method", "journey", "blog", "toolbox", "ask", "contact", "main", "site-menu", "work-index"];
    for (const s of slugs) expect(taken.includes(s), s).toBe(false);
  });
  for (const p of PRODUCTS) {
    describe(p.slug, () => {
      it("is complete in both languages", () => {
        for (const k of ["name", "category", "tagline", "summary", "status", "period", "role"] as const) {
          expect(filled(p[k].fa), `${k}.fa`).toBe(true);
          expect(filled(p[k].en), `${k}.en`).toBe(true);
        }
        expect(p.features.fa.length).toBe(p.features.en.length);
        expect(p.features.fa.length).toBeGreaterThan(0);
      });
      it("opens only its web version; every other edition is locked", () => {
        const web = p.editions.filter((e) => e.kind === "web");
        expect(web).toHaveLength(1);
        expect(web[0].href).toMatch(/^https:\/\//);
        for (const e of p.editions) {
          expect(filled(e.note.fa) && filled(e.note.en), e.kind).toBe(true);
          if (e.kind !== "web") expect(e.href, `${e.kind} must stay locked`).toBeUndefined();
        }
        expect(new Set(p.editions.map((e) => e.kind)).size).toBe(p.editions.length);
      });
      it("points only at screenshots that exist", () => {
        p.shots.forEach(media);
      });
    });
  }
  it("Siraf has web and Windows editions; Kariz adds the server edition", () => {
    const kinds = (slug: string) => PRODUCTS.find((p) => p.slug === slug)?.editions.map((e) => e.kind);
    expect(kinds("siraf")).toEqual(["web", "windows"]);
    expect(kinds("kariz")).toEqual(["web", "windows", "server"]);
  });
});

describe("posts", () => {
  it("have unique slugs", () => {
    expect(new Set(POSTS.map((p) => p.slug)).size).toBe(POSTS.length);
  });
  for (const p of POSTS) {
    describe(p.slug, () => {
      it("is complete in both languages", () => {
        for (const k of ["title", "dek", "kicker"] as const) {
          expect(filled(p[k].fa), `${k}.fa`).toBe(true);
          expect(filled(p[k].en), `${k}.en`).toBe(true);
        }
        expect(Number.isNaN(Date.parse(p.date))).toBe(false);
        for (const f of p.facts) expect(filled(f.k.fa) && filled(f.k.en) && filled(f.v.fa) && filled(f.v.en)).toBe(true);
        for (const b of p.blocks) {
          if (b.kind === "text" || b.kind === "quote") expect(filled(b.text.fa) && filled(b.text.en)).toBe(true);
          if (b.kind === "list") expect(b.items.fa.length).toBe(b.items.en.length);
        }
        for (const s of p.sources ?? []) {
          expect(filled(s.label.fa) && filled(s.label.en)).toBe(true);
          expect(s.href).toMatch(/^https:\/\//);
        }
      });
      it("points only at pictures that exist", () => {
        expect(existsSync(pub(p.og)), p.og).toBe(true);
        postImages(p).forEach(media);
        expect(postImages(p)[0]).toBe(p.cover);
      });
      it("relates only to existing case studies", () => {
        for (const r of p.related ?? []) expect(PROJECTS.some((x) => x.slug === r), r).toBe(true);
      });
    });
  }
});

describe("credit", () => {
  // the owner's rule: the site never names these, in content, components, the assistant's knowledge or metadata
  const BANNED = /claude|anthropic|کلود/i;
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : /\.(ts|tsx|css|json|md|txt|svg|webmanifest)$/.test(e.name) ? [path.join(dir, e.name)] : []));
  it("never names Claude, Claude Code or Anthropic anywhere in the site's source or public text", () => {
    const root = path.join(__dirname, "..");
    const hits = [...files(path.join(root, "src")), ...files(path.join(root, "public"))].filter((f) => BANNED.test(readFileSync(f, "utf8")));
    expect(hits.map((f) => path.relative(root, f))).toEqual([]);
  });
});

describe("organisations and journey", () => {
  it("logos exist", () => {
    for (const o of ORGS) if (o.logo) expect(existsSync(pub(o.logo)), o.logo).toBe(true);
  });
  it("every bank has a logo and is backed by a journey row or a case study", () => {
    const banks = ORGS.filter((o) => o.bank);
    expect(banks.length).toBeGreaterThan(0);
    for (const o of banks) {
      expect(Boolean(o.logo) && existsSync(pub(o.logo!)), o.key).toBe(true);
      expect(JOURNEY.some((r) => r.org === o.key) || PROJECTS.some((p) => p.orgs?.includes(o.key)), o.key).toBe(true);
    }
  });
  it("journey is bilingual", () => {
    for (const r of JOURNEY) expect(filled(r.title.fa) && filled(r.title.en) && filled(r.body.fa) && filled(r.body.en)).toBe(true);
  });
  it("ui strings are bilingual", () => {
    const walk = (v: unknown, at: string) => {
      if (v && typeof v === "object" && "fa" in v && "en" in v) {
        const l = v as { fa: unknown; en: unknown };
        expect(Boolean(l.fa) && Boolean(l.en), at).toBe(true);
        return;
      }
      if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${at}.${k}`);
    };
    walk(ui, "ui");
  });
});
