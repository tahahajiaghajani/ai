import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PROJECTS } from "@/content/projects";
import { JOURNEY } from "@/content/journey";
import { ORGS } from "@/content/orgs";
import { ui } from "@/content/ui";
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

describe("organisations and journey", () => {
  it("logos exist", () => {
    for (const o of ORGS) if (o.logo) expect(existsSync(pub(o.logo)), o.logo).toBe(true);
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
