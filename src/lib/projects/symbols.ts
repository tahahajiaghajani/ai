/**
 * Lightweight code/document map without a model: the important names in a file (functions,
 * classes, tables, headings) and what it imports. Stored in project_files so files can be found by
 * name in milliseconds and dependencies can be drawn as a graph.
 */

const MAX_SYMBOLS = 40;
const MAX_IMPORTS = 30;

function uniq(list: string[], max: number): string[] {
  return [...new Set(list.map((s) => s.trim()).filter((s) => s && s.length <= 120))].slice(0, max);
}

function all(text: string, re: RegExp, group = 1): string[] {
  return [...text.matchAll(re)].map((m) => m[group] ?? "");
}

export function extractSymbols(path: string, text: string): string[] {
  const ext = (path.split(".").pop() ?? "").toLowerCase();
  const sample = text.length > 400_000 ? text.slice(0, 400_000) : text;
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs", "vue", "svelte"].includes(ext)) {
    return uniq(
      [
        ...all(sample, /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm),
        ...all(sample, /^\s*(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)\s*\(/gm),
        ...all(sample, /^\s*class\s+([A-Za-z_$][\w$]*)/gm),
        ...all(sample, /^\s*(?:const|let)\s+([A-Z][\w$]*)\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/gm),
      ],
      MAX_SYMBOLS,
    );
  }
  if (["cs", "java", "kt", "kts", "scala", "dart", "swift", "vb"].includes(ext)) {
    return uniq(
      [
        ...all(sample, /\b(?:class|interface|enum|struct|record|object|trait)\s+([A-Za-z_]\w*)/g),
        ...all(sample, /^\s*(?:public|private|protected|internal|static|override|async|virtual|abstract|fun|suspend|\s)+[\w<>\[\],.? ]*?\s([A-Za-z_]\w*)\s*\([^;]*\)\s*(?:\{|=>|:|$)/gm),
      ],
      MAX_SYMBOLS,
    );
  }
  if (ext === "py") return uniq([...all(sample, /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/gm), ...all(sample, /^\s*class\s+([A-Za-z_]\w*)/gm)], MAX_SYMBOLS);
  if (ext === "go") return uniq([...all(sample, /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/gm), ...all(sample, /^type\s+([A-Za-z_]\w*)/gm)], MAX_SYMBOLS);
  if (ext === "php" || ext === "rb") return uniq([...all(sample, /\bfunction\s+([A-Za-z_]\w*)/g), ...all(sample, /\b(?:class|module|def)\s+([A-Za-z_][\w:]*)/g)], MAX_SYMBOLS);
  if (ext === "sql") return uniq(all(sample, /\bcreate\s+(?:or\s+replace\s+)?(?:table|view|function|procedure|trigger|index|type)\s+(?:if\s+not\s+exists\s+)?([\w."]+)/gi), MAX_SYMBOLS);
  if (["md", "markdown", "mdx", "txt", "rst"].includes(ext)) return uniq(all(sample, /^#{1,3}\s+(.+)$/gm), MAX_SYMBOLS);
  if (["html", "htm", "cshtml", "razor", "aspx"].includes(ext)) {
    return uniq([...all(sample, /<title>([^<]{1,100})<\/title>/gi), ...all(sample, /\bid=["']([\w-]{2,60})["']/g)], MAX_SYMBOLS);
  }
  if (["css", "scss", "less"].includes(ext)) return uniq(all(sample, /^([.#][\w-]+)\s*[{,]/gm), MAX_SYMBOLS);
  if (["json", "yaml", "yml", "toml"].includes(ext)) return uniq(all(sample, /^\s{0,2}["']?([A-Za-z_][\w-]*)["']?\s*[:=]/gm), MAX_SYMBOLS);
  return [];
}

export function extractImports(path: string, text: string): string[] {
  const ext = (path.split(".").pop() ?? "").toLowerCase();
  const sample = text.length > 200_000 ? text.slice(0, 200_000) : text;
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs", "vue", "svelte"].includes(ext)) {
    return uniq([...all(sample, /\bfrom\s+["']([^"']+)["']/g), ...all(sample, /\brequire\(\s*["']([^"']+)["']\s*\)/g), ...all(sample, /\bimport\(\s*["']([^"']+)["']\s*\)/g)], MAX_IMPORTS);
  }
  if (ext === "cs") return uniq(all(sample, /^\s*using\s+(?:static\s+)?([\w.]+)\s*;/gm), MAX_IMPORTS);
  if (ext === "py") return uniq([...all(sample, /^\s*from\s+([\w.]+)\s+import/gm), ...all(sample, /^\s*import\s+([\w.]+)/gm)], MAX_IMPORTS);
  if (["java", "kt", "scala", "dart"].includes(ext)) return uniq(all(sample, /^\s*import\s+([\w.*]+)/gm), MAX_IMPORTS);
  if (["html", "htm", "cshtml"].includes(ext)) return uniq([...all(sample, /<script[^>]+src=["']([^"']+)["']/gi), ...all(sample, /<link[^>]+href=["']([^"']+\.css)["']/gi)], MAX_IMPORTS);
  if (["css", "scss", "less"].includes(ext)) return uniq(all(sample, /@import\s+(?:url\()?["']([^"']+)["']/g), MAX_IMPORTS);
  return [];
}

/** Resolves a relative import ("./chart", "../lib/api") to a project file path, when it exists. */
export function resolveImport(fromPath: string, spec: string, paths: Set<string>): string | null {
  if (!spec.startsWith(".")) return null;
  const base = fromPath.split("/").slice(0, -1);
  for (const part of spec.split("/")) {
    if (part === "." || !part) continue;
    if (part === "..") base.pop();
    else base.push(part);
  }
  const p = base.join("/");
  const tries = [p, ...[".ts", ".tsx", ".js", ".jsx", ".mjs", ".vue", ".svelte", ".css", ".scss"].map((e) => p + e), ...["index.ts", "index.tsx", "index.js"].map((i) => `${p}/${i}`)];
  return tries.find((t) => paths.has(t)) ?? null;
}
