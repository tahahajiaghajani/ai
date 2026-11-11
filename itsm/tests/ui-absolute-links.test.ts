// Every in-app link and navigation must be absolute (`/${orgId}/…`). recordPath()/newRecordPath() return paths
// relative to the organisation, and React Router resolves a relative path against the current page: «انتشار تازه»
// on the release roadmap (nav(newRecordPath("release")) from /:org/releases/roadmap) led to
// /:org/releases/roadmap/releases/new — a page that does not exist. This test keeps that class of bug out.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..", "src", "ui");

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(tsx|ts)$/.test(name)) out.push(p);
  }
  return out;
}

/** The names a file binds to React Router's useNavigate() (e.g. `const nav = useNavigate()`). */
function navigateNames(src: string): string[] {
  const names: string[] = [];
  const re = /const\s+([A-Za-z_$][\w$]*)\s*=\s*useNavigate\(\)/g;
  for (let m = re.exec(src); m; m = re.exec(src)) names.push(m[1]);
  return names;
}

describe("in-app links are absolute", () => {
  const all = files(ROOT);

  it("never navigates or links to a bare recordPath()/newRecordPath()", () => {
    const bad: string[] = [];
    const re = /(?:\b(?:nav|navigate)\(|\bto=\{|\bhref=\{)\s*(?:recordPath|newRecordPath)\(/g;
    for (const f of all) {
      const src = readFileSync(f, "utf8");
      for (let m = re.exec(src); m; m = re.exec(src)) {
        const line = src.slice(0, m.index).split("\n").length;
        bad.push(`${relative(ROOT, f)}:${line}`);
      }
    }
    expect(bad, "prefix with `/${orgId}/` (or `/${org}/` from useParams)").toEqual([]);
  });

  it("never calls React Router's navigate with a relative path literal", () => {
    const bad: string[] = [];
    for (const f of all) {
      const src = readFileSync(f, "utf8");
      for (const name of navigateNames(src)) {
        // nav("x…"), nav('x…'), nav(`x…`) — a literal that does not start with "/" (nav(-1) and variables are fine)
        const re = new RegExp(`\\b${name.replace(/\$/g, "\\$")}\\(\\s*["'\`](?!/)(?!\\$\\{)`, "g");
        for (let m = re.exec(src); m; m = re.exec(src)) {
          const line = src.slice(0, m.index).split("\n").length;
          bad.push(`${relative(ROOT, f)}:${line}`);
        }
      }
    }
    expect(bad, "use an absolute path such as `/${orgId}/…`").toEqual([]);
  });
});
