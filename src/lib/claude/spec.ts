import "server-only";
import { db } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { getUserConfig, type ClaudeRunOptions, type UserConfig } from "@/lib/settings";
import { externalStepPrompt, readEngine } from "@/lib/workflow/engine";
import { getProject } from "@/lib/projects/store";
import { metaPath } from "@/lib/projects/paths";
import type { Job, Task, TaskFile, Upgrade } from "@/lib/types";

export interface RunnerSpec {
  job_id: string;
  kind: "main" | "upgrade" | "graphify";
  app_url: string;
  prompt?: string;
  task_code?: string;
  /** folder Claude works in (project root, or the task's records folder) */
  task_path?: string;
  /** where the Claude session is kept so related runs continue it */
  session_dir?: string;
  resume_session_id?: string | null;
  model?: string;
  /** Claude Code --effort level ("" = model default) */
  effort?: string;
  /** "on" forces extended thinking, "off" disables it where the model allows, "auto" leaves it adaptive */
  thinking?: "auto" | "on" | "off";
  max_turns?: number;
  branch?: string;
  commit_message: string;
  remote_inputs?: { url: string; path: string }[];
  graphify?: { mode: string; model: string; path: string; out: string };
}

/** Per-send choices override the user's Settings defaults. */
export function claudeRunOptions(cfg: Pick<UserConfig, "claude">, override: unknown): ClaudeRunOptions {
  const o = (override && typeof override === "object" ? override : {}) as Partial<ClaudeRunOptions>;
  return {
    model: typeof o.model === "string" ? o.model.trim() : cfg.claude.model,
    effort: typeof o.effort === "string" ? o.effort : cfg.claude.effort,
    thinking: o.thinking || cfg.claude.thinking,
  };
}

/** The user's request comes first; everything after it is where to work and the ground rules. */
export function mainPrompt(opts: {
  prompt: string;
  step: string;
  project: { name: string; root: string } | null;
  selected: string[];
  finalDir: string;
  brief: string | null;
  helpers: string[];
  inputs: string[];
  resumed: boolean;
}): string {
  const lines: string[] = ["# درخواست", "", opts.prompt.trim() || "—", ""];
  if (opts.step) lines.push(opts.step, "");
  lines.push("---", "", "## محل کار");
  if (opts.project) {
    const root = opts.project.root;
    lines.push(
      `روی پروژه‌ی «${opts.project.name}» در پوشه‌ی \`${root}/\` کار کن.`,
      `- اول این‌ها را بخوان: \`${root}/.taskflow/PROJECT.md\` (توضیحات)، \`${root}/.taskflow/KNOWLEDGE.md\` (دانش پروژه) و \`${root}/.taskflow/INDEX.md\` (نقشه‌ی فایل‌ها)؛ اگر \`${root}/.taskflow/graph/GRAPH_REPORT.md\` هست از آن هم کمک بگیر.`,
      "- فایل‌ها را در جای خودشان ویرایش کن؛ فایل جدید را کنار فایل‌های هم‌نوعش بساز. هیچ فایلی را تکه‌تکه یا کپی جداگانه نساز.",
    );
    if (opts.selected.length) lines.push(`- فایل‌هایی که کاربر به آن‌ها اشاره کرده: ${opts.selected.map((p) => `\`${root}/${p}\``).join("، ")}`);
  } else {
    lines.push(`خروجی(های) خواسته‌شده را به صورت فایل کامل با نام گویا در \`${opts.finalDir}/\` بساز.`);
  }
  lines.push("", "## مواد کار (مسیرها نسبت به ریشه‌ی مخزن)");
  if (opts.brief) lines.push(`- **دستور کار پیش‌کار — اول این را بخوان:** \`${opts.brief}\``);
  for (const h of opts.helpers) lines.push(`- خروجی دیگر پیش‌کار: \`${h}\``);
  if (opts.inputs.length) {
    lines.push("- **فایل‌های پیوست همین درخواست:**");
    for (const p of opts.inputs) lines.push(`  - \`${p}\``);
  }
  if (!opts.brief && !opts.helpers.length && !opts.inputs.length) lines.push("- (موردی نیست)");
  lines.push(
    "",
    "## قوانین",
    "1. هدف فقط انجام «درخواست» بالاست؛ دقیقاً همان چیزی را تحویل بده که خواسته شده.",
    "2. سبک، کتابخانه‌ها و ساختار موجود را حفظ کن؛ فناوری یا فایل جانبی که خواسته نشده اضافه نکن.",
    "3. پوشه‌ی `.taskflow/` و پوشه‌های runs/ را تغییر نده. commit یا push نکن؛ runner این کار را می‌کند.",
    "4. در ابتدای کار با TodoWrite برنامه بریز و به‌روز نگه دار (در اپ زنده نمایش داده می‌شود).",
    "5. پیام پایانی تو عیناً در اپ نشان داده می‌شود: به فارسی و کوتاه بگو چه کردی، کدام فایل‌ها تغییر کرد یا ساخته شد و چه چیزی باید تکمیل شود.",
  );
  if (opts.resumed) lines.push("", "_(این جلسه ادامه‌ی جلسه‌ی قبلی Claude روی همین کار است.)_");
  return lines.join("\n");
}

async function loadTask(id: string): Promise<{ task: Task; root: Task }> {
  const { data: task } = await db().from("tasks").select("*").eq("id", id).single<Task>();
  if (!task) throw new Error("تسک یافت نشد");
  const root = task.root_id && task.root_id !== task.id ? ((await db().from("tasks").select("*").eq("id", task.root_id).single<Task>()).data ?? task) : task;
  return { task, root };
}

export async function buildRunnerSpec(job: Job): Promise<RunnerSpec> {
  const base = { job_id: job.id, app_url: env.appUrl };

  if (job.kind === "main") {
    const cfg = await getUserConfig(job.owner_id!);
    const { task, root } = await loadTask(job.task_id!);
    const st = await readEngine(job.id);
    if (!st?.ctx.recordsDir) throw new Error("وضعیت کار برای اجرای Claude Code آماده نیست");
    const project = st.ctx.projectId ? await getProject(st.ctx.projectId) : null;
    const step = externalStepPrompt(st);

    // latest pre-work outputs of the task (its work order first)
    const { data: outs } = await db()
      .from("task_files")
      .select("github_path, name, job_id, created_at")
      .in("task_id", [...new Set([task.id, root.id])])
      .eq("context", "output")
      .like("github_path", "%-prework/%")
      .order("created_at", { ascending: false });
    const rows = (outs ?? []) as { github_path: string; name: string; job_id: string | null }[];
    const latest = rows.filter((r) => r.job_id === rows[0]?.job_id);
    const brief = latest.find((r) => r.name.startsWith("دستور کار")) ?? latest.find((r) => r.github_path.endsWith("/BRIEF.md")) ?? null;
    const helpers = latest.filter((r) => r !== brief).map((r) => r.github_path);

    // attachments already in the repo, and big ones the runner downloads before Claude starts
    const inputs = [...st.ctx.inputPaths];
    const remote: { url: string; path: string }[] = [];
    const { data: big } = await db().from("task_files").select("*").in("id", st.ctx.inputs.map((f) => f.id)).is("github_path", null);
    for (const f of (big ?? []) as TaskFile[]) {
      const { data } = await db().storage.from("task-files").createSignedUrl(f.storage_path, 3 * 3600);
      const path = `${st.ctx.runDir}/inputs/${f.name.replace(/[\\/]/g, "_")}`;
      if (data?.signedUrl) {
        remote.push({ url: data.signedUrl, path });
        inputs.push(path);
      }
    }
    const agentOpts = Object.fromEntries(Object.entries(step.agent?.claude ?? {}).filter(([, v]) => !!v));
    const run = claudeRunOptions(cfg, { ...((job.payload.claude as object) ?? {}), ...agentOpts });
    const resume = cfg.claude.resumeSessions && root.claude_session_id ? root.claude_session_id : null;
    return {
      ...base,
      kind: "main",
      task_code: task.code,
      task_path: project ? project.root_path : st.ctx.recordsDir,
      session_dir: `${st.ctx.recordsDir}/.claude-session`,
      prompt: mainPrompt({
        prompt: st.ctx.prompt,
        step: step.text,
        project: project ? { name: project.name, root: project.root_path } : null,
        selected: st.ctx.selected,
        finalDir: `${st.ctx.recordsDir}/final`,
        brief: brief?.github_path ?? null,
        helpers,
        inputs,
        resumed: !!resume,
      }),
      resume_session_id: resume,
      model: run.model || undefined,
      effort: run.effort || undefined,
      thinking: run.thinking,
      max_turns: cfg.claude.maxTurns,
      commit_message: `[TaskFlow] ${task.code} کار اصلی (Claude Code): ${st.ctx.prompt.split("\n")[0].slice(0, 60) || task.title}`,
      remote_inputs: remote,
    };
  }

  if (job.kind === "graphify") {
    const cfg = await getUserConfig(job.owner_id!);
    const project = await getProject(String(job.payload.project_id ?? job.project_id));
    return {
      ...base,
      kind: "graphify",
      task_path: project.root_path,
      commit_message: `[TaskFlow] گراف پروژه‌ی ${project.name}`,
      graphify: { mode: cfg.graphify.mode, model: "gemini-flash-latest", path: project.root_path, out: metaPath(project.slug, "graph") },
    };
  }

  if (job.kind === "upgrade") {
    const { data: up } = await db().from("upgrades").select("*").eq("id", job.upgrade_id).single<Upgrade>();
    if (!up) throw new Error("درخواست ارتقا یافت نشد");
    const cfg = await getUserConfig(job.owner_id!);
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
        `# درخواست ارتقای اپلیکیشن Task Flow (${up.code})`,
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
      model: cfg.claude.model || undefined,
      effort: cfg.claude.effort || undefined,
      thinking: cfg.claude.thinking,
      max_turns: cfg.claude.maxTurns,
      commit_message: `[TaskFlow ${up.code}] ${up.title ?? up.prompt.slice(0, 60)}`,
      remote_inputs: remote,
    };
  }

  throw new Error(`نوع کار ${job.kind} برای runner پشتیبانی نمی‌شود`);
}
