import "server-only";
import { db } from "@/lib/supabase/admin";
import { generateJson } from "@/lib/ai/gemini";
import { addKnowledge, KNOWLEDGE_KINDS } from "@/lib/ai/knowledge";
import { getAgentPrompt, KNOWLEDGE_SCHEMA, OPTIMIZER_SCHEMA } from "@/lib/ai/prompts";
import { getAgents, SYSTEM_AGENT_LABELS } from "@/lib/workflow/registry";
import { getSettings } from "@/lib/settings";
import { commitFiles, getFileText, repoRef, type CommitFile } from "@/lib/github/client";
import { notifyAdmins } from "@/lib/events";
import { slugify, truncate } from "@/lib/utils";
import type { JobRun, StepResult } from "@/lib/queue/run";
import type { Task } from "@/lib/types";

/** Which ai_messages rows hold a given agent's output. */
/** Feedback agent → the ai_messages agent holding its outputs (workflow steps save under their own id). */
const MESSAGE_AGENT: Record<string, string> = { plan: "brief" };

const TEXT_FILE = /\.(md|txt|sql|ts|tsx|js|jsx|py|json|yml|yaml|cs|java|go|sh|html|css)$/i;

/** Extract reusable knowledge from Claude's final outputs (after main work). */
export async function knowledgeHandler(run: JobRun): Promise<StepResult> {
  const settings = await getSettings();
  const { data: task } = await db().from("tasks").select("*").eq("id", run.job.task_id).single<Task>();
  if (!task) return { type: "fail", error: "تسک یافت نشد" };
  const path = String(run.job.payload.path ?? task.github_path ?? "");
  const ref = await repoRef("workspace");

  // Claude's closing message explains the work; the deliverables it produced are the task outputs.
  const { data: replies } = await db().from("ai_messages").select("content").eq("task_id", task.id).eq("agent", "reply").order("id", { ascending: false }).limit(1);
  const explanation = replies?.[0]?.content ?? "";
  const { data: outputs } = await db().from("task_files").select("github_path, size").eq("task_id", task.id).eq("context", "output").not("github_path", "like", "%/prework/%");
  const tree = ((outputs ?? []) as { github_path: string | null; size: number | null }[]).filter((o) => o.github_path).map((o) => ({ path: o.github_path!, size: o.size ?? 0 }));
  const filesMd = tree.map((t) => `- ${t.path.replace(`${path}/`, "")}`).join("\n");
  const samples: string[] = [];
  let budget = 30_000;
  for (const f of tree.filter((t) => TEXT_FILE.test(t.path) && (t.size ?? 0) < 60_000).slice(0, 10)) {
    if (budget <= 0) continue;
    const text = await getFileText(ref, f.path);
    if (!text) continue;
    const piece = `### ${f.path.replace(`${path}/`, "")}\n${truncate(text, 3000)}`;
    budget -= piece.length;
    samples.push(piece);
  }
  if (!explanation && !samples.length) {
    await run.log({ source: "knowledge", kind: "warning", title: "خروجی نهایی برای استخراج دانش یافت نشد" });
    return { type: "done", result: { items: 0 } };
  }

  await run.log({ source: "knowledge", kind: "log", title: "استخراج دانش از خروجی نهایی Claude" });
  const { data } = await generateJson<{ items: { kind: string; title: string; content: string; tags?: string[]; score?: number }[] }>({
    agent: "knowledge",
    models: settings.models.knowledge,
    system: await getAgentPrompt("knowledge"),
    userParts: [
      {
        text: `# تسک ${task.code}: ${task.title}\n${task.description}\n\n## پیام پایانی Claude\n${truncate(explanation, 15000)}\n\n## فایل‌های خروجی\n${truncate(filesMd, 5000)}\n\n## نمونه‌ی فایل‌های خروجی\n${samples.join("\n\n")}`,
      },
    ],
    jsonSchema: KNOWLEDGE_SCHEMA,
    thinking: "LOW",
    deadline: run.deadline,
    partialKey: "knowledge-main",
    ctx: run.genContext("knowledge"),
  });
  run.commitUsage();
  const items = (data.items ?? []).filter((i) => (i.score ?? 0) >= settings.knowledge.minScore && i.content?.trim());
  const stored = await addKnowledge(
    items.map((i) => ({
      ...i,
      task_id: task.id,
      task_code: task.code,
      requester_id: i.kind === "requester_profile" ? task.requester_id : null,
      source: "main",
    })),
  );
  const files: CommitFile[] = items.map((k) => ({
    path: `knowledge/${k.kind}/${task.code}_final_${slugify(k.title, 40)}.md`,
    content: `# ${k.title}\n\n- نوع: ${KNOWLEDGE_KINDS[k.kind] ?? k.kind}\n- منبع: خروجی نهایی تسک ${task.code} «${task.title}»\n- برچسب‌ها: ${(k.tags ?? []).join("، ")}\n\n${k.content}\n`,
  }));
  if (files.length) await commitFiles(ref, files, `[TaskFlow] دانش استخراج‌شده از ${task.code}`);
  await run.log({ source: "knowledge", kind: "result", title: `${items.length} مورد دانش از کار اصلی ذخیره شد`, detail: `${stored} قطعه‌ی برداری` });
  return { type: "done", result: { items: items.length } };
}

/** Self-improvement: propose better system prompts from admin feedback. */
export async function optimizeHandler(run: JobRun): Promise<StepResult> {
  const settings = await getSettings();
  const registry = await getAgents();
  const labels: Record<string, string> = { ...SYSTEM_AGENT_LABELS, ...Object.fromEntries(registry.map((a) => [a.id, a.name])) };
  const defaults: Record<string, string> = Object.fromEntries(registry.map((a) => [a.id, a.prompt]));
  let agents = (run.state.agents as string[] | undefined) ?? null;
  if (!agents) {
    const { data: fb } = await db().from("feedback").select("agent").not("agent", "is", null).order("created_at", { ascending: false }).limit(300);
    const requested = (run.job.payload.agents as string[] | undefined) ?? [];
    agents = requested.length ? requested : [...new Set((fb ?? []).map((f) => (f.agent === "plan" ? "brief" : (f.agent as string))))].filter((a) => a in labels);
    await run.patchState({ agents, cursor: 0 });
  }
  const cursor = Number(run.state.cursor ?? 0);
  if (cursor >= agents.length) {
    if (!agents.length) await run.log({ source: "system", kind: "warning", title: "بازخوردی برای بهینه‌سازی پرامپت‌ها ثبت نشده است" });
    return { type: "done", result: { agents: agents.length } };
  }
  const agent = agents[cursor];
  const current = await getAgentPrompt(agent, defaults[agent]);
  const { data: feedback } = await db()
    .from("feedback")
    .select("rating, comment, job_id, created_at")
    .eq("agent", agent)
    .order("created_at", { ascending: false })
    .limit(30);
  const negJobs = (feedback ?? []).filter((f) => f.rating < 0 && f.job_id).map((f) => f.job_id as string).slice(0, 3);
  const { data: samples } = negJobs.length
    ? await db().from("ai_messages").select("content").in("job_id", negJobs).eq("agent", MESSAGE_AGENT[agent] ?? agent).limit(3)
    : { data: [] as { content: string }[] };

  const { data } = await generateJson<{ improved_prompt: string; rationale: string; changes?: string[] }>({
    agent: "optimizer",
    models: settings.models.optimizer,
    system: await getAgentPrompt("optimizer"),
    userParts: [
      {
        text: `# ایجنت: ${labels[agent] ?? agent}\n\n## پرامپت فعلی\n${current}\n\n## بازخوردها (۱+ مثبت، ۱- منفی)\n${(feedback ?? [])
          .map((f) => `- [${f.rating > 0 ? "+" : f.rating < 0 ? "-" : "0"}] ${f.comment ?? ""}`)
          .join("\n") || "—"}\n\n## نمونه خروجی‌هایی که بازخورد منفی گرفتند\n${(samples ?? []).map((s) => truncate(s.content, 4000)).join("\n\n---\n\n") || "—"}`,
      },
    ],
    jsonSchema: OPTIMIZER_SCHEMA,
    thinking: "MEDIUM",
    deadline: run.deadline,
    partialKey: `optimize:${agent}`,
    ctx: run.genContext("optimize"),
  });
  run.commitUsage();
  const { data: last } = await db().from("agent_prompts").select("version").eq("agent", agent).order("version", { ascending: false }).limit(1).maybeSingle();
  await db()
    .from("agent_prompts")
    .insert({
      agent,
      version: (last?.version ?? 0) + 1,
      content: data.improved_prompt,
      is_active: false,
      source: "ai",
      rationale: [data.rationale, ...(data.changes ?? []).map((c) => `• ${c}`)].join("\n"),
    });
  await run.log({ source: "system", kind: "result", title: `نسخه‌ی پیشنهادی جدید برای «${labels[agent] ?? agent}» ساخته شد` });
  await run.patchState({ cursor: cursor + 1 });
  if (cursor + 1 >= agents.length) {
    await notifyAdmins({ title: "پیشنهاد بهبود پرامپت‌ها آماده است", body: `${agents.length} ایجنت`, link: "/learning" });
    return { type: "done", result: { agents: agents.length } };
  }
  return { type: "continue" };
}
