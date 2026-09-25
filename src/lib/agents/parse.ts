/** Make a model-provided path safe and relative. */
export function safeRelPath(p: string): string {
  const clean = p
    .replace(/\\/g, "/")
    .split("/")
    .map((seg) => seg.trim())
    .filter((seg) => seg && seg !== "." && seg !== "..")
    .map((seg) => seg.replace(/[<>:"|?*\u0000-\u001f]/g, "_").slice(0, 80))
    .join("/");
  return clean.slice(0, 200) || "output.txt";
}

/** Helper files live flat in prework/files/: keep just a safe file name with an extension. */
export function helperFileName(p: string, index: number): string {
  const name = safeRelPath(p).split("/").pop() ?? "";
  const cleaned = name.replace(/\s+/g, "-");
  return /\.[A-Za-z0-9]{1,10}$/.test(cleaned) ? cleaned : `${cleaned || `helper-${index + 1}`}.md`;
}

/** Models sometimes wrap a whole file in a ``` block even when told not to. */
export function stripCodeFence(text: string): string {
  const t = text.trim();
  const m = t.match(/^```[\w.+-]*\r?\n([\s\S]*?)\r?\n```$/);
  return `${(m ? m[1] : t).replace(/\s+$/, "")}\n`;
}

/**
 * Files Claude changed that the admin actually wants to see and download: everything under the
 * task folder except bookkeeping (session, graph, manifest, inputs, prompts, pre-work).
 */
export function isDeliverablePath(taskPath: string, path: string): boolean {
  const prefix = `${taskPath.replace(/\/+$/, "")}/`;
  if (!path.startsWith(prefix)) return false;
  const rel = path.slice(prefix.length);
  if (/^(\.claude-session|graphify-out|iterations|knowledge)\//.test(rel)) return false;
  if (/^(manifest\.json|README\.md|HISTORY\.md|\.graphifyignore)$/.test(rel)) return false;
  return true;
}
