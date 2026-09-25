export interface WbsPhase {
  id: string;
  title: string;
  goal: string;
  deliverable?: string;
}

export interface WbsItem {
  id: string;
  title: string;
  description: string;
  complexity: "simple" | "medium" | "complex";
  type: string;
  deliverable: string;
  estimate_hours?: number;
  depends_on?: string[];
  phase: string;
}

export interface ExecFile {
  path: string;
  desc: string;
  content: string;
  wbs_id?: string;
}

const FILE_RE = /<<<FILE\s+path="([^"]+)"(?:\s+desc="([^"]*)")?\s*>>>\r?\n?([\s\S]*?)<<<END FILE>>>/g;

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

/** Parse <<<FILE ...>>> blocks and the free-text report around them. */
export function parseExecOutput(text: string): { files: ExecFile[]; report: string } {
  const files: ExecFile[] = [];
  for (const m of text.matchAll(FILE_RE)) {
    // Models sometimes prefix paths with the task code (T-0007/…); the folder already carries it.
    const path = safeRelPath(m[1]).replace(/^T-\d+(?:\.\d+)?\//i, "") || "output.txt";
    const wbs = path.match(/^(\d+(?:\.\d+)+)\//)?.[1];
    files.push({ path, desc: (m[2] ?? "").trim(), content: m[3].replace(/\s+$/, "") + "\n", wbs_id: wbs });
  }
  const report = text.replace(FILE_RE, "").replace(/\n{3,}/g, "\n\n").trim();
  return { files, report };
}

/** Split the methods markdown into per-item sections keyed by WBS id. */
export function splitByItemHeadings(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /^###\s*\[([^\]]+)\][^\n]*$/gm;
  const matches = [...text.matchAll(re)];
  matches.forEach((m, i) => {
    const start = m.index ?? 0;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length;
    out[m[1].trim()] = text.slice(start, end).trim();
  });
  return out;
}

const COMPLEXITY_FA: Record<string, string> = { simple: "ساده", medium: "متوسط", complex: "پیچیده" };

export function renderWbsMarkdown(summary: string, phases: WbsPhase[], items: WbsItem[]): string {
  const lines: string[] = ["# ساختار شکست کار (WBS)", ""];
  if (summary) lines.push(summary, "");
  const total = items.reduce((s, i) => s + (Number(i.estimate_hours) || 0), 0);
  lines.push(
    `- تعداد فازها: ${phases.length}`,
    `- تعداد فعالیت‌ها: ${items.length}`,
    `- ساده: ${items.filter((i) => i.complexity === "simple").length} | متوسط: ${items.filter((i) => i.complexity === "medium").length} | پیچیده: ${items.filter((i) => i.complexity === "complex").length}`,
    total ? `- تخمین کل: ${Math.round(total)} ساعت` : "",
    "",
  );
  for (const p of phases) {
    lines.push(`## فاز ${p.id} — ${p.title}`, "", `**هدف:** ${p.goal}`, p.deliverable ? `\n**خروجی:** ${p.deliverable}` : "", "");
    lines.push("| شناسه | فعالیت | پیچیدگی | نوع | خروجی | تخمین (ساعت) | وابستگی |", "|---|---|---|---|---|---|---|");
    for (const it of items.filter((i) => i.phase === p.id)) {
      lines.push(
        `| ${it.id} | **${it.title}**<br>${(it.description ?? "").replace(/\n/g, " ").replace(/\|/g, "/")} | ${COMPLEXITY_FA[it.complexity] ?? it.complexity} | ${it.type} | ${(it.deliverable ?? "").replace(/\|/g, "/")} | ${it.estimate_hours ?? "—"} | ${(it.depends_on ?? []).join("، ") || "—"} |`,
      );
    }
    lines.push("");
  }
  return lines.filter((l, i, arr) => !(l === "" && arr[i - 1] === "")).join("\n");
}

export function itemBrief(it: WbsItem): string {
  return `[${it.id}] ${it.title} — پیچیدگی: ${it.complexity}، نوع: ${it.type}\nشرح: ${it.description}\nخروجی: ${it.deliverable}${it.depends_on?.length ? `\nوابستگی: ${it.depends_on.join(", ")}` : ""}`;
}

/** Items chosen for execution: simple first, then medium, then complex (for preparation). */
export function pickExecutionItems(items: WbsItem[], max: number): WbsItem[] {
  const rank = { simple: 0, medium: 1, complex: 2 } as const;
  return [...items].sort((a, b) => (rank[a.complexity] ?? 3) - (rank[b.complexity] ?? 3)).slice(0, max);
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
