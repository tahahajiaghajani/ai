import { describe, expect, it, vi } from "vitest";
import sitemap from "@/app/sitemap";
import manifest from "@/app/manifest";
import { GET as enManifest } from "@/app/(en)/en/manifest.webmanifest/route";
import { copy } from "@/lib/i18n";
import { siteMetadata, webManifest } from "@/lib/seo";
import { STARTER_POSTS } from "@/lib/blog-starter";

vi.mock("next/cache", () => ({ unstable_cache: (fn: () => unknown) => fn, revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

describe("sitemap", async () => {
  const all = await sitemap();
  // page pairs carry hreflang; blog articles are written per language and stand alone
  const entries = all.filter((e) => e.alternates);
  const urls = new Set(all.map((e) => e.url));

  it("lists the blog, the track record and every starter article", () => {
    expect(urls.has("http://localhost:3000/blog")).toBe(true);
    expect(urls.has("http://localhost:3000/en/records")).toBe(true);
    expect(all.filter((e) => /\/blog\/./.test(e.url))).toHaveLength(STARTER_POSTS.length);
  });

  it("gives every language version the full hreflang set, x-default included", () => {
    expect(entries).toHaveLength(8);
    for (const e of entries) {
      const languages = e.alternates?.languages ?? {};
      expect(Object.keys(languages).sort()).toEqual(["en", "fa", "x-default"]);
      // the entry is one of its own alternates, and every alternate is listed as an entry
      expect(Object.values(languages)).toContain(e.url);
      for (const u of Object.values(languages)) expect(urls.has(u!)).toBe(true);
      expect(languages["x-default"]).toBe(languages.fa);
    }
  });

  it("lists the English pages with their own alternates", () => {
    const en = entries.find((e) => e.url.endsWith("/en/support"));
    expect(en?.alternates?.languages?.fa).toMatch(/\/support$/);
    expect(en?.alternates?.languages?.en).toBe(en?.url);
  });
});

describe("web manifest", () => {
  it("keeps the Persian manifest at the root", () => {
    expect(manifest()).toMatchObject({ start_url: "/", lang: "fa", dir: "rtl", description: copy("fa").footer.tagline });
    expect(manifest().scope).toBeUndefined();
    expect(siteMetadata("fa").manifest).toBe("/manifest.webmanifest");
  });

  it("links an English manifest from /en that opens /en", async () => {
    expect(siteMetadata("en").manifest).toBe("/en/manifest.webmanifest");
    const res = enManifest();
    expect(res.headers.get("content-type")).toBe("application/manifest+json");
    const body = await res.json();
    expect(body).toEqual(webManifest("en"));
    expect(body).toMatchObject({ name: "Pars Project Management", start_url: "/en", scope: "/en", lang: "en", dir: "ltr", description: copy("en").footer.tagline });
    expect(body.icons).toEqual(manifest().icons);
  });
});
