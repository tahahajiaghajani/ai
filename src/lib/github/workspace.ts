import "server-only";
import { slugify } from "@/lib/utils";
import { formatJalali } from "@/lib/jalali";
import { PRIORITY_META, RELATION_META, STATUS_META } from "@/lib/status";
import type { Task, Profile } from "@/lib/types";

/** Folder of the root task inside the workspace repo, e.g. tasks/T-0007_گزارش-مالی */
export function rootFolder(root: Pick<Task, "code" | "title" | "github_path">): string {
  return root.github_path || `tasks/${root.code}_${slugify(root.title)}`;
}

/** Iteration folder: the root task is iteration 01, each related task adds one. */
export function iterationFolder(root: Pick<Task, "code" | "title" | "github_path">, task: Pick<Task, "seq_in_root" | "title">): string {
  return `${rootFolder(root)}/iterations/${String(task.seq_in_root).padStart(2, "0")}_${slugify(task.title, 36)}`;
}

export type FileRole =
  | "request"
  | "input"
  | "context"
  | "research"
  | "wbs"
  | "methods"
  | "execution"
  | "execution-log"
  | "report"
  | "knowledge"
  | "final"
  | "explanation"
  | "changelog"
  | "graph"
  | "prompt";

export interface ManifestFile {
  path: string;
  role: FileRole | string;
  agent: string;
  iteration: number;
  description?: string;
  depends_on?: string[];
  wbs_id?: string;
  updated_at: string;
}

export interface ManifestIteration {
  seq: number;
  code: string;
  title: string;
  relation: string | null;
  folder: string;
  prework?: { job_id: string; completed_at: string; models: string[]; files: number; commit?: string };
  main?: { job_id: string; completed_at?: string; session_id?: string; commit?: string; status?: string };
}

export interface Manifest {
  schema: "taskflow.manifest/v1";
  task: {
    code: string;
    title: string;
    requester: string;
    priority: string;
    kind: string;
    start_date: string | null;
    end_date: string | null;
    event_at: string | null;
  };
  folders: Record<string, string>;
  iterations: ManifestIteration[];
  files: ManifestFile[];
  updated_at: string;
}

export function emptyManifest(root: Task, requester: Profile | null): Manifest {
  return {
    schema: "taskflow.manifest/v1",
    task: {
      code: root.code,
      title: root.title,
      requester: requester?.full_name ?? requester?.email ?? "",
      priority: root.priority,
      kind: root.kind,
      start_date: root.start_date,
      end_date: root.end_date,
      event_at: root.event_at,
    },
    folders: {
      iterations: "هر تکرار (تسک اصلی = ۰۱، تسک‌های مرتبط = ۰۲، ۰۳ …) شامل درخواست، ورودی‌ها و خروجی ایجنت‌های پیش‌کار",
      "iterations/*/inputs": "فایل‌های پیوست تسک‌دهنده و فایل‌های همراه پرامپت",
      "iterations/*/prework": "خروجی ایجنت‌های Gemini: تحقیق، WBS، روش‌ها، اجرای کارهای ساده، گزارش",
      final: "خروجی نهایی کار اصلی (Claude) + EXPLANATION.md + CHANGELOG.md",
      "graphify-out": "گراف دانش فایل‌ها (graphify) — قبل از خواندن فایل‌ها GRAPH_REPORT.md را بخوانید",
      ".claude-session": "جلسه‌ی Claude برای ادامه‌ی همان پروژه در تسک‌های مرتبط",
    },
    iterations: [],
    files: [],
    updated_at: new Date().toISOString(),
  };
}

export function mergeManifest(base: Manifest, files: ManifestFile[], iteration?: ManifestIteration): Manifest {
  const byPath = new Map(base.files.map((f) => [f.path, f]));
  for (const f of files) byPath.set(f.path, { ...byPath.get(f.path), ...f });
  const iterations = [...base.iterations];
  if (iteration) {
    const idx = iterations.findIndex((i) => i.seq === iteration.seq);
    if (idx >= 0) iterations[idx] = { ...iterations[idx], ...iteration };
    else iterations.push(iteration);
    iterations.sort((a, b) => a.seq - b.seq);
  }
  return {
    ...base,
    iterations,
    files: [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path)),
    updated_at: new Date().toISOString(),
  };
}

export function requestMarkdown(task: Task, requester: Profile | null, root: Task | null): string {
  const lines = [
    `# ${task.title}`,
    "",
    `| فیلد | مقدار |`,
    `|---|---|`,
    `| کد | ${task.code} |`,
    `| نوع | ${task.kind === "event" ? "رویداد" : "تسک"} |`,
    `| اولویت | ${PRIORITY_META[task.priority].label} |`,
    `| تسک‌دهنده | ${requester?.full_name ?? ""} ${requester?.org_unit ? `(${requester.org_unit})` : ""} |`,
    task.kind === "event"
      ? `| زمان رویداد | ${formatJalali(task.event_at, { withTime: true })} |`
      : `| بازه | ${formatJalali(task.start_date)} تا ${formatJalali(task.end_date)} |`,
    `| ثبت | ${formatJalali(task.created_at, { withTime: true })} |`,
  ];
  if (root && task.parent_id) lines.push(`| ارتباط | ${RELATION_META[task.relation_type ?? "other"]} ← ${root.code} |`);
  lines.push("", "## توضیحات", "", task.description || "—", "");
  return lines.join("\n");
}

export function readmeMarkdown(root: Task, manifest: Manifest, tasks: Task[]): string {
  const rows = manifest.files
    .map((f) => `| \`${f.path.replace(/^.*?\/iterations\//, "iterations/")}\` | ${f.role} | ${f.agent} | ${f.iteration} | ${f.description ?? ""} |`)
    .join("\n");
  const its = tasks
    .sort((a, b) => a.seq_in_root - b.seq_in_root)
    .map((t) => `| ${String(t.seq_in_root).padStart(2, "0")} | ${t.code} | ${t.title} | ${t.parent_id ? RELATION_META[t.relation_type ?? "other"] : "تسک اصلی"} | ${STATUS_META[t.status].label} |`)
    .join("\n");
  return `# ${root.code} — ${root.title}

> این پوشه به صورت خودکار توسط **TaskFlow AI** ساخته و به‌روزرسانی می‌شود.
> نقشه‌ی ماشینی (دیتا مپینگ): [\`manifest.json\`](./manifest.json) · گراف فایل‌ها: [\`graphify-out/GRAPH_REPORT.md\`](./graphify-out/GRAPH_REPORT.md)

## تکرارها (تسک اصلی و تسک‌های مرتبط)

| # | کد | عنوان | نوع | وضعیت |
|---|---|---|---|---|
${its}

## ساختار پوشه

${Object.entries(manifest.folders)
  .map(([k, v]) => `- \`${k}\` — ${v}`)
  .join("\n")}

## نقشه‌ی فایل‌ها

| مسیر | نقش | تولیدکننده | تکرار | توضیح |
|---|---|---|---|---|
${rows}

_آخرین به‌روزرسانی: ${formatJalali(manifest.updated_at, { withTime: true })}_
`;
}
