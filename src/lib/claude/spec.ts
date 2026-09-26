import "server-only";
import { db } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { getSettings, type AppSettings, type ClaudeRunOptions } from "@/lib/settings";
import { resolveModels } from "@/lib/ai/gemini";
import { iterationFolder, rootFolder } from "@/lib/github/workspace";
import { PRIORITY_META, RELATION_META } from "@/lib/status";
import { formatJalali } from "@/lib/jalali";
import { claudeStepPrompt, readEngine } from "@/lib/workflow/engine";
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
  /** Claude Code --effort level ("" = model default) */
  effort?: string;
  /** "on" forces extended thinking, "off" disables it where the model allows, "auto" leaves it adaptive */
  thinking?: "auto" | "on" | "off";
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

export interface MainMaterials {
  /** pre-work work order (latest in this project) */
  brief: string | null;
  helpers: string[];
  /** attachments already in the repo or downloaded by the runner before Claude starts */
  inputs: { path: string; name: string; current: boolean }[];
  hasContext: boolean;
}

/** The admin's request comes first; everything after it is context and ground rules. */
export function mainPrompt(opts: {
  adminPrompt: string;
  task: Task;
  root: Task;
  requester: Profile | null;
  rootPath: string;
  iterPath: string;
  followup: boolean;
  resumed: boolean;
  materials: MainMaterials;
}): string {
  const { task, root, rootPath, iterPath, requester, materials } = opts;
  const isRelated = !!task.parent_id;
  const finalDir = `${rootPath}/final`;
  const lines: string[] = ["# درخواست", "", opts.adminPrompt.trim(), "", "---", ""];
  if (opts.followup) {
    lines.push(`> این یک **دستور تکمیلی** در ادامه‌ی همین کار است. خروجی‌های قبلی در \`${finalDir}/\` هستند؛ فقط همین درخواست را روی آن‌ها اعمال کن.`, "");
  } else if (isRelated) {
    lines.push(
      `> این «${RELATION_META[task.relation_type ?? "other"]}» تسک اصلی **${root.code} — ${root.title}** است؛ پروژه‌ی جدید نیست. روی خروجی‌های موجود در \`${finalDir}/\` ادامه بده.`,
      "",
    );
  }
  lines.push(
    `## تسک ${task.code}: ${task.title}`,
    `- اولویت: ${PRIORITY_META[task.priority].label} | ${task.kind === "event" ? `زمان رویداد: ${formatJalali(task.event_at, { withTime: true })}` : `بازه: ${formatJalali(task.start_date)} تا ${formatJalali(task.end_date)}`}`,
    `- تسک‌دهنده: ${requester?.full_name ?? "—"}${requester?.org_unit ? ` (${requester.org_unit})` : ""}`,
    "",
    task.description || "—",
    "",
    "## مواد کار (مسیرها نسبت به ریشه‌ی مخزن)",
  );
  if (materials.brief) lines.push(`- **دستور کار پیش‌کار — اول این را بخوان:** \`${materials.brief}\``);
  for (const h of materials.helpers) lines.push(`- خروجی دیگر پیش‌کار: \`${h}\``);
  if (materials.inputs.length) {
    lines.push("- **فایل‌های پیوست (نمونه‌ها و داده‌های واقعی؛ مبنای کار):**");
    for (const f of materials.inputs) lines.push(`  - \`${f.path}\`${f.current ? " — پیوست همین درخواست" : ""}`);
  } else {
    lines.push("- فایل پیوستی وجود ندارد.");
  }
  if (opts.followup || isRelated) lines.push(`- خروجی‌های قبلی: \`${finalDir}/\``);
  if (materials.hasContext) lines.push(`- دانش مرتبط از کارهای قبلی (در صورت نیاز): \`${iterPath}/CONTEXT-main.md\``);
  lines.push(
    "",
    "## قوانین",
    "1. هدف فقط انجام «درخواست» بالاست. خروجی باید دقیقاً همان چیزی باشد که خواسته شده (نوع، قالب و تعداد فایل).",
    "2. فایل‌های پیوست مبنای کارند: سازوکار، الگوها، کد و تنظیمات آن‌ها را بخوان و تا جای ممکن استفاده یا تقلید کن. فناوری، زیرساخت یا ساختاری که خواسته نشده اضافه نکن.",
    `3. فایل(های) خروجی را با نام گویا در \`${finalDir}/\` بساز. فایل مستندات، تست، اسکریپت یا فایل جانبی که خواسته نشده نساز.`,
    "4. اگر اطلاعاتی (مثلاً نام یک فیلد) در مواد کار نیست، کار را متوقف نکن: در خروجی با یک علامت واضح و کامنت مشخص کن و در پیام پایانی فهرستش را بده.",
    "5. در ابتدای کار با TodoWrite برنامه بریز و به‌روز نگه دار (در اپ زنده نمایش داده می‌شود).",
    "6. پیام پایانی تو عیناً در اپ به مدیر نشان داده می‌شود: به فارسی و کوتاه بگو چه تحویل دادی (نام فایل‌ها)، چطور استفاده شود و چه چیزهایی باید تکمیل شود.",
    "7. پوشه‌های `iterations/` و فایل‌های پیوست را تغییر نده. commit یا push نکن؛ runner این کار را می‌کند.",
    '8. برای جستجوی دانش و تجربه‌های قبلی در صورت نیاز: `node .github/scripts/taskflow.mjs kb "پرسش"`.',
  );
  if (opts.resumed) lines.push("", "_(این جلسه ادامه‌ی همان جلسه‌ی قبلی Claude روی این پروژه است.)_");
  return lines.join("\n");
}

/** Per-send choices override the Settings defaults. */
export function claudeRunOptions(settings: AppSettings, override: unknown): ClaudeRunOptions {
  const o = (override && typeof override === "object" ? override : {}) as Partial<ClaudeRunOptions>;
  return {
    model: typeof o.model === "string" ? o.model.trim() : settings.claude.model,
    effort: typeof o.effort === "string" ? o.effort : settings.claude.effort,
    thinking: o.thinking || settings.claude.thinking,
  };
}

/** Latest pre-work work order of the project and the attachments Claude will find in the repo. */
async function mainMaterials(task: Task, root: Task, jobId: string, remote: { path: string; name: string; current: boolean }[]): Promise<MainMaterials> {
  const family = [task.id, ...(root.id !== task.id ? [root.id] : [])];
  const { data: outs } = await db()
    .from("task_files")
    .select("github_path, name, job_id, created_at")
    .in("task_id", family)
    .eq("context", "output")
    .like("github_path", "%/prework/%")
    .order("created_at", { ascending: false });
  const rows = (outs ?? []) as { github_path: string; name: string; job_id: string | null }[];
  // outputs of the latest pre-work run; its work order (brief node, or BRIEF.md) is read first
  const latest = rows.filter((r) => r.job_id === rows[0]?.job_id);
  const briefRow = latest.find((r) => r.name.startsWith("دستور کار")) ?? latest.find((r) => r.github_path.endsWith("/BRIEF.md")) ?? null;
  const helpers = latest.filter((r) => r !== briefRow).map((r) => r.github_path);

  const { data: files } = await db()
    .from("task_files")
    .select("github_path, name, context, job_id, task_id")
    .in("task_id", family)
    .in("context", ["request", "prework", "main"])
    .not("github_path", "is", null)
    .order("created_at");
  const inRepo = ((files ?? []) as { github_path: string; name: string; context: string; job_id: string | null }[]).map((f) => ({
    path: f.github_path,
    name: f.name,
    current: f.context === "main" && f.job_id === jobId,
  }));
  const seen = new Set<string>();
  const inputs = [...inRepo, ...remote].filter((f) => (seen.has(f.path) ? false : (seen.add(f.path), true)));
  return { brief: briefRow?.github_path ?? null, helpers, inputs, hasContext: true };
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
    const remoteInfo: { path: string; name: string; current: boolean }[] = [];
    for (const f of (bigFiles ?? []) as TaskFile[]) {
      if (f.storage_path.startsWith("github:")) continue;
      const { data } = await db().storage.from("task-files").createSignedUrl(f.storage_path, 3 * 3600);
      const path = `${iterPath}/inputs/${f.context === "main" ? "main/" : ""}${f.name.replace(/[\\/]/g, "_")}`;
      if (data?.signedUrl) {
        remote.push({ url: data.signedUrl, path });
        remoteInfo.push({ path, name: f.name, current: f.context === "main" && f.job_id === job.id });
      }
    }
    // the workflow step being run: its instructions/inputs and its own model settings (if any)
    const engine = await readEngine(job.id);
    const step = engine ? await claudeStepPrompt(engine) : { text: "", agent: null };
    const agentOpts = Object.fromEntries(Object.entries(step.agent?.claude ?? {}).filter(([, v]) => !!v));
    const run = claudeRunOptions(settings, { ...((job.payload.claude as object) ?? {}), ...agentOpts });
    const adminPrompt = String(job.payload.prompt ?? settings.claude.defaultPrompt);
    return {
      ...base,
      kind: "main",
      task_code: task.code,
      task_path: rootPath,
      iteration_path: iterPath,
      prompt: mainPrompt({
        adminPrompt: step.text ? `${adminPrompt}\n\n${step.text}` : adminPrompt,
        task,
        root,
        requester,
        rootPath,
        iterPath,
        followup: !!job.payload.followup,
        resumed: !!resume,
        materials: await mainMaterials(task, root, job.id, remoteInfo),
      }),
      resume_session_id: resume,
      model: run.model || undefined,
      effort: run.effort || undefined,
      thinking: run.thinking,
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
      effort: settings.claude.effort || undefined,
      thinking: settings.claude.thinking,
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
      graphify: { mode: settings.graphify.mode, model: (await resolveModels([settings.graphify.model || "auto"]))[0], path },
    };
  }

  throw new Error(`نوع کار ${job.kind} برای runner پشتیبانی نمی‌شود`);
}
