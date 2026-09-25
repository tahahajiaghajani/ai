import "server-only";
import { db } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { getSettings } from "@/lib/settings";
import { iterationFolder, rootFolder } from "@/lib/github/workspace";
import { PRIORITY_META, RELATION_META } from "@/lib/status";
import { formatJalali } from "@/lib/jalali";
import type { Job, Task, TaskFile, Upgrade, Profile } from "@/lib/types";

export interface RunnerSpec {
  job_id: string;
  kind: "main" | "upgrade" | "graphify";
  app_url: string;
  prompt?: string;
  task_code?: string;
  task_path?: string;
  iteration_path?: string;
  resume_session_id?: string | null;
  model?: string;
  max_turns?: number;
  branch?: string;
  base_branch?: string;
  commit_message: string;
  remote_inputs?: { url: string; path: string }[];
  graphify?: { mode: string; model: string; path: string };
}

async function loadTaskFamily(taskId: string) {
  const { data: task } = await db().from("tasks").select("*").eq("id", taskId).single<Task>();
  if (!task) throw new Error("تسک یافت نشد");
  const root =
    task.root_id && task.root_id !== task.id ? (await db().from("tasks").select("*").eq("id", task.root_id).single<Task>()).data ?? task : task;
  const { data: requester } = await db().from("profiles").select("*").eq("id", task.requester_id).maybeSingle<Profile>();
  return { task, root, requester };
}

export function mainPrompt(opts: {
  adminPrompt: string;
  task: Task;
  root: Task;
  requester: Profile | null;
  rootPath: string;
  iterPath: string;
  followup: boolean;
  resumed: boolean;
}): string {
  const { task, root, rootPath, iterPath, requester } = opts;
  const isRelated = !!task.parent_id;
  const lines: string[] = [];
  lines.push(opts.adminPrompt.trim(), "", "---", "");
  if (opts.followup) {
    lines.push(`> این یک **دستور تکمیلی** برای همین پروژه (${root.code}) است. کار قبلی را حفظ کن و فقط تغییرات خواسته‌شده را اعمال کن.`, "");
  } else if (isRelated) {
    lines.push(
      `> این «${RELATION_META[task.relation_type ?? "other"]}» تسک اصلی **${root.code} — ${root.title}** است؛ پروژه‌ی جدید نیست. در ادامه‌ی همان پروژه و روی همان خروجی‌های \`${rootPath}/final/\` کار کن.`,
      "",
    );
  }
  lines.push(
    `## مشخصات تسک ${task.code}`,
    `- عنوان: ${task.title}`,
    `- اولویت: ${PRIORITY_META[task.priority].label}`,
    task.kind === "event" ? `- زمان رویداد: ${formatJalali(task.event_at, { withTime: true })}` : `- بازه: ${formatJalali(task.start_date)} تا ${formatJalali(task.end_date)}`,
    `- تسک‌دهنده: ${requester?.full_name ?? "—"}${requester?.org_unit ? ` (${requester.org_unit})` : ""}`,
    "",
    "### شرح",
    task.description || "—",
    "",
    "## مسیرها (نسبت به ریشه‌ی مخزن)",
    `- پوشه‌ی تسک: \`${rootPath}\` — اول \`${rootPath}/README.md\` و \`${rootPath}/manifest.json\` (دیتا مپینگ) را بخوان.`,
    `- خروجی‌های پیش‌کار این مرحله: \`${iterPath}/prework/\` (مهم‌ترین: \`05-report.md\`، \`02-wbs.md\`، \`03-methods.md\`، \`04-execution/\`)`,
    `- فایل‌های پیوست: \`${iterPath}/inputs/\``,
    `- دانش بازیابی‌شده از پایگاه دانش: \`${iterPath}/CONTEXT-main.md\``,
    `- گراف فایل‌ها: \`${rootPath}/graphify-out/GRAPH_REPORT.md\` (اگر وجود دارد؛ برای یافتن فایل‌ها از آن و \`graphify query "..."\` به جای جستجوی کور استفاده کن تا توکن هدر نرود).`,
    "",
    "## قوانین خروجی",
    `1. خروجی نهایی را در \`${rootPath}/final/\` بساز یا به‌روز کن (زیرپوشه‌ها منطقی و مستند).`,
    `2. \`${rootPath}/final/EXPLANATION.md\`: توضیح کامل کار، نحوه‌ی استفاده/اجرا، تصمیم‌ها و محدودیت‌ها (فارسی).`,
    `3. \`${rootPath}/final/CHANGELOG.md\`: یک ورودی برای این مرحله (${task.code}) اضافه کن.`,
    `4. \`${rootPath}/final/FILES.md\`: جدول دیتا مپینگ دقیق همه‌ی فایل‌های final (مسیر | نقش | توضیح | وابسته به | منبع در پیش‌کار).`,
    "5. در ابتدای کار با TodoWrite برنامه بریز و در طول کار مرتب به‌روزش کن (فهرست کارها به صورت زنده در اپ نمایش داده می‌شود).",
    '6. برای جستجوی دانش و تجربه‌های قبلی: `node .github/scripts/taskflow.mjs kb "پرسش"`.',
    "7. خودت commit یا push نکن؛ runner بعد از پایان کار همه چیز را commit می‌کند.",
    "8. در پیام آخر، خلاصه‌ی کار انجام‌شده و موارد باز را بنویس.",
  );
  if (opts.resumed) lines.push("", "_(این جلسه ادامه‌ی همان جلسه‌ی قبلی Claude روی این پروژه است.)_");
  return lines.join("\n");
}

export async function buildRunnerSpec(job: Job): Promise<RunnerSpec> {
  const settings = await getSettings();
  const base = { job_id: job.id, app_url: env.appUrl };

  if (job.kind === "main") {
    const { task, root, requester } = await loadTaskFamily(job.task_id!);
    const rootPath = rootFolder(root);
    const iterPath = iterationFolder({ ...root, github_path: rootPath }, task);
    const resume = settings.claude.resumeSessions && root.claude_session_id ? root.claude_session_id : null;
    const { data: bigFiles } = await db()
      .from("task_files")
      .select("*")
      .eq("task_id", task.id)
      .is("github_path", null)
      .in("context", ["request", "prework", "main"]);
    const remote: { url: string; path: string }[] = [];
    for (const f of (bigFiles ?? []) as TaskFile[]) {
      const { data } = await db().storage.from("task-files").createSignedUrl(f.storage_path, 3 * 3600);
      if (data?.signedUrl) remote.push({ url: data.signedUrl, path: `${iterPath}/inputs/${f.context === "main" ? "main/" : ""}${f.name.replace(/[\\/]/g, "_")}` });
    }
    return {
      ...base,
      kind: "main",
      task_code: task.code,
      task_path: rootPath,
      iteration_path: iterPath,
      prompt: mainPrompt({
        adminPrompt: String(job.payload.prompt ?? settings.claude.defaultPrompt),
        task,
        root,
        requester,
        rootPath,
        iterPath,
        followup: !!job.payload.followup,
        resumed: !!resume,
      }),
      resume_session_id: resume,
      model: settings.claude.model || undefined,
      max_turns: settings.claude.maxTurns,
      commit_message: `[TaskFlow] کار اصلی ${task.code}: ${task.title}`,
      remote_inputs: remote,
    };
  }

  if (job.kind === "upgrade") {
    const { data: up } = await db().from("upgrades").select("*").eq("id", job.upgrade_id).single<Upgrade>();
    if (!up) throw new Error("درخواست ارتقا یافت نشد");
    const { data: files } = await db().from("task_files").select("*").eq("upgrade_id", up.id);
    const remote: { url: string; path: string }[] = [];
    for (const f of (files ?? []) as TaskFile[]) {
      const { data } = await db().storage.from("task-files").createSignedUrl(f.storage_path, 3 * 3600);
      if (data?.signedUrl) remote.push({ url: data.signedUrl, path: `.upgrade-inputs/${up.code}/${f.name.replace(/[\\/]/g, "_")}` });
    }
    return {
      ...base,
      kind: "upgrade",
      task_code: up.code,
      branch: up.branch ?? `upgrade/${up.code.toLowerCase()}`,
      prompt: [
        `# درخواست ارتقای اپلیکیشن TaskFlow AI (${up.code})`,
        "",
        up.prompt,
        "",
        "---",
        "## قوانین",
        "- ابتدا `CLAUDE.md` و `docs/ARCHITECTURE_FA.md` را بخوان تا معماری را بشناسی.",
        "- تغییر را کامل و تمیز پیاده کن؛ همه‌ی متن‌های رابط کاربری فارسی و راست‌چین بمانند.",
        "- اگر دیتابیس تغییر می‌کند، یک فایل migration جدید و ایدمپوتنت در `supabase/migrations/` با timestamp جدیدتر بساز (هرگز migration قبلی را ویرایش نکن).",
        "- اگر متغیر محیطی جدیدی لازم است، آن را در `.env.example` و `docs/INSTALL_FA.md` مستند کن.",
        "- `npm run typecheck` و `npm run build` باید بدون خطا پاس شوند؛ خودت اجرا و رفع خطا کن.",
        remote.length ? `- فایل‌های پیوست این درخواست در \`.upgrade-inputs/${up.code}/\` هستند (آن‌ها را commit نکن).` : "",
        "- commit یا push نکن؛ runner شاخه و Pull Request را می‌سازد.",
        "- در پیام آخر، خلاصه‌ی تغییرات را به فارسی بنویس.",
      ]
        .filter(Boolean)
        .join("\n"),
      model: settings.claude.model || undefined,
      max_turns: settings.claude.maxTurns,
      commit_message: `[TaskFlow ${up.code}] ${up.title ?? up.prompt.slice(0, 60)}`,
      remote_inputs: remote,
    };
  }

  if (job.kind === "graphify") {
    const path = String(job.payload.path ?? "");
    return {
      ...base,
      kind: "graphify",
      task_path: path,
      commit_message: `[TaskFlow] گراف فایل‌ها: ${path.split("/")[1] ?? path}`,
      graphify: { mode: settings.graphify.mode, model: settings.graphify.model, path },
    };
  }

  throw new Error(`نوع کار ${job.kind} برای runner پشتیبانی نمی‌شود`);
}
