import "server-only";
import { db } from "@/lib/supabase/admin";
import { generate, generateJson } from "@/lib/ai/generate";
import { getAgentPrompt, OPTIMIZER_SCHEMA, SUMMARY_SCHEMA, withAbout } from "@/lib/ai/prompts";
import { getConnection } from "@/lib/connections";
import { getUserConfig, stageModel } from "@/lib/settings";
import { FatalError } from "@/lib/errors";
import { commitFiles, getBlobBytes, getFileText, userRepo } from "@/lib/github/client";
import { getProject, projectFiles, refreshStats, writeIndexFile } from "@/lib/projects/store";
import { isTextPath, metaPath } from "@/lib/projects/paths";
import { getAgents, SYSTEM_AGENT_LABELS, savePromptVersion } from "@/lib/workflow/registry";
import { notify } from "@/lib/events";
import { stripCodeFence } from "@/lib/agents/parse";
import { truncate } from "@/lib/utils";
import type { JobRun, StepResult } from "@/lib/queue/run";

async function connectionFor(run: JobRun) {
  const cfg = await getUserConfig(run.job.owner_id!);
  const id = run.job.connection_id ?? stageModel(cfg, "knowledge").connectionId;
  if (!id) throw new FatalError("برای دانش پروژه هیچ اتصال هوش مصنوعی انتخاب نشده است");
  return { conn: await getConnection(id, run.job.owner_id!), model: stageModel(cfg, "knowledge").model, about: cfg.about };
}

/**
 * Keeps a project's single knowledge file up to date after work on it: the model merges what the
 * last run taught into KNOWLEDGE.md (one file, separate from the project's own files).
 */
export async function knowledgeHandler(run: JobRun): Promise<StepResult> {
  const project = await getProject(run.job.project_id!);
  const repo = await userRepo(project.owner_id);
  const { conn, model, about } = await connectionFor(run);
  const path = metaPath(project.slug, "KNOWLEDGE.md");
  const current = (await getFileText(repo, path)) ?? `# دانش پروژه‌ی ${project.name}\n`;
  const p = run.job.payload as { stage?: string; prompt?: string; reply?: string; changed?: string[] };
  const res = await generate({
    agent: "knowledge",
    conn,
    model,
    system: withAbout(await getAgentPrompt(project.owner_id, "knowledge"), about),
    user: [
      {
        type: "text",
        text: `# پروژه: ${project.name}\n${project.description}\n\n## KNOWLEDGE.md فعلی\n${current}\n\n## آخرین کار (${p.stage === "main" ? "کار اصلی" : "پیش‌کار"})\n### درخواست\n${p.prompt ?? "—"}\n\n### نتیجه\n${p.reply ?? "—"}\n\n### فایل‌های تغییرکرده\n${(p.changed ?? []).map((c) => `- ${c}`).join("\n") || "—"}`,
      },
    ],
    effort: "LOW",
    deadline: run.deadline,
    partialKey: "knowledge",
    ctx: run.genContext("knowledge", conn.id),
  });
  run.commitUsage();
  const next = stripCodeFence(res.text);
  if (next.trim().length < 40) return { type: "done", result: { skipped: true } };
  await commitFiles(repo, [{ path, content: next }], `[TaskFlow] دانش پروژه‌ی ${project.name}`);
  await db().from("projects").update({ knowledge_at: new Date().toISOString() }).eq("id", project.id);
  await run.log({ source: "knowledge", kind: "result", title: `دانش پروژه‌ی «${project.name}» به‌روز شد`, detail: `مدل ${res.model}` });
  return { type: "done", result: { model: res.model } };
}

/**
 * One-line summaries of a project's files (the file map the models search). Runs in batches across
 * ticks; files that already have a summary for their current content are skipped.
 */
export async function indexHandler(run: JobRun): Promise<StepResult> {
  const project = await getProject(run.job.project_id!);
  const repo = await userRepo(project.owner_id);
  const { conn, model, about } = await connectionFor(run);
  const todo = (await projectFiles(project.id)).filter((f) => !f.summary);
  if (!todo.length) {
    await writeIndexFile(project, repo);
    await refreshStats(project.id, { status: "ready", status_detail: null, indexed_at: new Date().toISOString() });
    await run.log({ source: "project", kind: "result", title: `نقشه‌ی فایل‌های «${project.name}» کامل شد` });
    return { type: "done" };
  }
  await db().from("projects").update({ status: "indexing", status_detail: `${todo.length} فایل باقی مانده` }).eq("id", project.id);
  // one request covers many small files (free tiers count requests, not tokens)
  const batch: { path: string; text: string }[] = [];
  let budget = 90_000;
  for (const f of todo.slice(0, 60)) {
    if (budget <= 0) break;
    let text = `[${f.kind}, ${f.size} بایت]`;
    if (isTextPath(f.path) && f.sha && f.size < 300_000) text = (await getBlobBytes(repo, f.sha).catch(() => null))?.toString("utf-8") ?? text;
    const piece = truncate(text, Math.min(budget, 8_000));
    budget -= piece.length;
    batch.push({ path: f.path, text: piece });
  }
  const { data, model: used } = await generateJson<{ files?: { path: string; summary: string }[] }>({
    agent: "summarize",
    conn,
    model,
    system: withAbout(await getAgentPrompt(project.owner_id, "summarize"), about),
    user: [{ type: "text", text: `# پروژه: ${project.name}\n${project.description}\n\n${batch.map((b) => `--- فایل ${b.path} ---\n${b.text}`).join("\n\n")}` }],
    jsonSchema: SUMMARY_SCHEMA,
    effort: "LOW",
    deadline: run.deadline,
    partialKey: `index:${batch[0]?.path}`,
    ctx: run.genContext("index", conn.id),
  });
  run.commitUsage();
  const got = new Map((data.files ?? []).map((f) => [f.path, f.summary]));
  for (const b of batch) {
    const summary = (got.get(b.path) ?? "").trim().slice(0, 300) || "—";
    await db().from("project_files").update({ summary }).eq("project_id", project.id).eq("path", b.path);
  }
  await run.log({ source: "project", kind: "log", title: `خلاصه‌ی ${batch.length} فایل ساخته شد (${todo.length - batch.length} فایل باقی مانده)`, detail: `مدل ${used}` });
  return { type: "continue" };
}

/** Self-improvement: propose better system prompts from the user's own feedback. */
export async function optimizeHandler(run: JobRun): Promise<StepResult> {
  const userId = run.job.owner_id!;
  const { conn, model, about } = await connectionFor(run);
  const registry = await getAgents(userId);
  const labels: Record<string, string> = { ...SYSTEM_AGENT_LABELS, ...Object.fromEntries(registry.map((a) => [a.id, a.name])) };
  const defaults: Record<string, string> = Object.fromEntries(registry.map((a) => [a.id, a.prompt]));
  let agents = (run.state.agents as string[] | undefined) ?? null;
  if (!agents) {
    const { data: fb } = await db().from("feedback").select("agent").eq("created_by", userId).not("agent", "is", null).order("created_at", { ascending: false }).limit(300);
    const requested = (run.job.payload.agents as string[] | undefined) ?? [];
    agents = requested.length ? requested : [...new Set((fb ?? []).map((f) => f.agent as string))].filter((a) => a in labels);
    await run.patchState({ agents, cursor: 0 });
  }
  const cursor = Number(run.state.cursor ?? 0);
  if (cursor >= agents.length) {
    if (!agents.length) await run.log({ source: "system", kind: "warning", title: "بازخوردی برای بهینه‌سازی پرامپت‌ها ثبت نشده است" });
    return { type: "done", result: { agents: agents.length } };
  }
  const agent = agents[cursor];
  const current = await getAgentPrompt(userId, agent, defaults[agent]);
  const { data: feedback } = await db().from("feedback").select("rating, comment, job_id").eq("created_by", userId).eq("agent", agent).order("created_at", { ascending: false }).limit(30);
  const negJobs = (feedback ?? []).filter((f) => f.rating < 0 && f.job_id).map((f) => f.job_id as string).slice(0, 3);
  const { data: samples } = negJobs.length ? await db().from("ai_messages").select("content").in("job_id", negJobs).in("agent", ["reply", "brief"]).limit(3) : { data: [] as { content: string }[] };

  const { data } = await generateJson<{ improved_prompt: string; rationale: string; changes?: string[] }>({
    agent: "optimizer",
    conn,
    model,
    system: withAbout(await getAgentPrompt(userId, "optimizer"), about),
    user: [
      {
        type: "text",
        text: `# ایجنت: ${labels[agent] ?? agent}\n\n## پرامپت فعلی\n${current}\n\n## بازخوردها (۱+ مثبت، ۱- منفی)\n${(feedback ?? []).map((f) => `- [${f.rating > 0 ? "+" : f.rating < 0 ? "-" : "0"}] ${f.comment ?? ""}`).join("\n") || "—"}\n\n## نمونه خروجی‌هایی که بازخورد منفی گرفتند\n${(samples ?? []).map((s) => truncate(s.content, 4000)).join("\n\n---\n\n") || "—"}`,
      },
    ],
    jsonSchema: OPTIMIZER_SCHEMA,
    effort: "MEDIUM",
    deadline: run.deadline,
    partialKey: `optimize:${agent}`,
    ctx: run.genContext("optimize", conn.id),
  });
  run.commitUsage();
  await savePromptVersion(userId, agent, data.improved_prompt, false, defaults[agent] ?? "", "ai");
  await db()
    .from("agent_prompts")
    .update({ rationale: [data.rationale, ...(data.changes ?? []).map((c) => `• ${c}`)].join("\n") })
    .eq("user_id", userId)
    .eq("agent", agent)
    .eq("source", "ai")
    .is("rationale", null);
  await run.log({ source: "system", kind: "result", title: `نسخه‌ی پیشنهادی جدید برای «${labels[agent] ?? agent}» ساخته شد` });
  await run.patchState({ cursor: cursor + 1 });
  if (cursor + 1 >= agents.length) {
    await notify(userId, { title: "پیشنهاد بهبود پرامپت‌ها آماده است", body: `${agents.length} ایجنت`, link: "/learning" });
    return { type: "done", result: { agents: agents.length } };
  }
  return { type: "continue" };
}
