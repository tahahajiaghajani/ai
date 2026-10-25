/**
 * A tiny syntax highlighter for the case-study excerpts (Python, TypeScript/JavaScript, C#, SQL, JSON, GLSL).
 * Monochrome by design: it only marks keywords, strings, comments, numbers and punctuation with classes styled in
 * globals.css (.code .t-*). Output is escaped HTML.
 */
const KEYWORDS: Record<string, string[]> = {
  python: "def class return if elif else for while in not and or is None True False import from as with try except finally raise yield lambda async await pass break continue self".split(" "),
  ts: "const let var function return if else for while of in new class extends implements interface type export import from as async await try catch finally throw switch case default break continue typeof instanceof null undefined true false this void".split(" "),
  cs: "using namespace class public private protected internal static readonly void string int double bool var new return if else foreach for while in null true false try catch finally throw this override async await".split(" "),
  sql: "select from where join left right inner outer on and or not null is as group by order having limit insert into values update set delete create table if exists primary key references default returning with case when then else end function returns language begin declare replace grant revoke alter enable row level security".split(" "),
  glsl: "uniform varying attribute precision highp mediump float vec2 vec3 vec4 sampler2D void return if else for main texture2D smoothstep mix step length fract floor".split(" "),
  json: "true false null".split(" "),
};

function lexicon(lang: string): Set<string> {
  const l = lang.toLowerCase();
  if (l.startsWith("py")) return new Set(KEYWORDS.python);
  if (l === "cs" || l === "csharp" || l === "c#") return new Set(KEYWORDS.cs);
  if (l === "sql" || l === "plpgsql") return new Set(KEYWORDS.sql);
  if (l === "glsl") return new Set(KEYWORDS.glsl);
  if (l === "json") return new Set(KEYWORDS.json);
  return new Set(KEYWORDS.ts);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function highlight(code: string, lang: string): string {
  const kw = lexicon(lang);
  const sqlish = /sql/i.test(lang);
  const py = /^py/i.test(lang);
  const re = py
    ? /("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#.*$|\b\d+(?:\.\d+)?\b|[A-Za-z_][\w]*|[{}()[\].,:;=+\-*/<>!&|%]+)/gm
    : sqlish
      ? /('(?:''|[^'])*'|--.*$|\b\d+(?:\.\d+)?\b|[A-Za-z_][\w]*|[{}()[\].,:;=+\-*/<>!&|%]+)/gm
      : /(`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/.*$|\/\*[\s\S]*?\*\/|\b\d+(?:\.\d+)?\b|[A-Za-z_$][\w$]*|[{}()[\].,:;=+\-*/<>!&|%?]+)/gm;
  let out = "";
  let last = 0;
  for (const m of code.matchAll(re)) {
    const t = m[0];
    const i = m.index ?? 0;
    out += esc(code.slice(last, i));
    last = i + t.length;
    let cls = "";
    if (/^("|'|`)/.test(t)) cls = "t-s";
    else if (/^(#|\/\/|\/\*|--)/.test(t)) cls = "t-c";
    else if (/^\d/.test(t)) cls = "t-n";
    else if (/^[A-Za-z_$]/.test(t)) cls = kw.has(sqlish ? t.toLowerCase() : t) ? "t-k" : "";
    else cls = "t-p";
    // a token may span lines (docstrings, block comments): wrap each line so the caller can split on newlines
    out += cls ? t.split("\n").map((part) => `<span class="${cls}">${esc(part)}</span>`).join("\n") : esc(t);
  }
  out += esc(code.slice(last));
  return out;
}
