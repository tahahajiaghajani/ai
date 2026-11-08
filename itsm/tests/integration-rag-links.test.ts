// Every link the AI layer hands the UI opens a real screen: the citation path of each registered RAG source (the
// knowledge module's articles at `kb/a/:id` and short answers at `kb/snippets/:id`, CIs at `cis/:id`, services, smart
// documents with page and highlight…) and of every table the index covers by default (`r/:table/:id`), and the
// in-app path of every record type the assistant's tools reference, match a route of the UI's route table — a cited
// article used to open «صفحه پیدا نشد» (`knowledge/a/<id>`).
import { describe, expect, it } from "vitest";
import "@server/routes/modules";
import { ragTables } from "@server/modules/ai/rag";
import { citationPath, ragSource } from "@server/modules/ai/rag/registry";
import { pathOf, recordPathTypes } from "@server/modules/ai/tools/common";
import { ROUTES } from "../src/ui/modules/registry";

const ID = "01a1ba1a-6c55-7032-8ff5-c64d41aa398d";

/** Does an in-app path (no org prefix, maybe with a query or hash) match a route pattern of the UI? */
function routeOf(path: string): string | null {
  const bare = path.split(/[?#]/)[0].replace(/^\/+|\/+$/g, "");
  const parts = bare.split("/");
  for (const r of ROUTES) {
    const pat = r.path.replace(/^\/+|\/+$/g, "").split("/");
    if (pat.length !== parts.length) continue;
    if (pat.every((p, i) => p.startsWith(":") || p === parts[i])) return r.path;
  }
  return null;
}

describe("AI links resolve to UI routes", () => {
  it("the route matcher is not vacuous", () => {
    expect(routeOf(`kb/a/${ID}`)).toBe("kb/a/:id");
    expect(routeOf(`knowledge/a/${ID}`)).toBeNull();
    expect(routeOf(`cmdb/cis/${ID}`)).toBeNull();
  });

  it("every RAG source's citation link opens a screen", () => {
    const tables = ragTables();
    // the modules that declare their own sources are installed
    for (const t of ["kb_article", "kb_snippet", "ci", "service"]) expect(ragSource(t), t).toBeTruthy();
    const broken: string[] = [];
    for (const def of tables) {
      for (const extra of [{}, { page: 3, chunk: ID }]) {
        const p = citationPath(def.key, ID, extra);
        if (!routeOf(p)) broken.push(`${def.key} → ${p}`);
      }
    }
    expect(broken).toEqual([]);
    expect(citationPath("kb_article", ID)).toBe(`kb/a/${ID}`);
    expect(citationPath("kb_snippet", ID)).toBe(`kb/snippets/${ID}`);
    expect(citationPath("ci", ID)).toBe(`cis/${ID}`);
  });

  it("every record type the assistant's tools reference opens a screen", () => {
    const broken = recordPathTypes()
      .map((t) => [t, pathOf(t, ID)] as const)
      .filter(([, p]) => !p || !routeOf(p))
      .map(([t, p]) => `${t} → ${p}`);
    expect(broken).toEqual([]);
  });
});
