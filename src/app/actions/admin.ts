"use server";
import { headers } from "next/headers";
import { assertAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { saveSettings, type AppSettings } from "@/lib/settings";
import { configureScheduler, integrationStatus, setAppSecrets, setWorkspaceSecrets, syncWorkspaceTemplate } from "@/lib/github/bootstrap";
import { addKnowledge } from "@/lib/ai/knowledge";
import { searchKnowledge } from "@/lib/ai/knowledge";
import { enqueueJob, kickWorker } from "@/lib/queue/jobs";
import { mergeUpgrade } from "@/lib/claude/ingest";
import { previewUrlForSha, repoRef, gh } from "@/lib/github/client";
import { DEFAULT_PROMPTS, type AgentKey } from "@/lib/ai/prompts";
import { registerFiles, type UploadedFile } from "@/lib/tasks/service";
import { act } from "./_util";
import type { Upgrade } from "@/lib/types";

async function origin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  return host ? `${h.get("x-forwarded-proto") ?? "https"}://${host}` : undefined;
}

// ------------------------------------------------------------------ setup
export async function integrationStatusAction() {
  return act(async () => {
    await assertAdmin();
    return integrationStatus();
  });
}

export async function bootstrapWorkspaceAction(claudeToken?: string, anthropicKey?: string) {
  return act(async () => {
    await assertAdmin();
    const sync = await syncWorkspaceTemplate();
    const secrets = await setWorkspaceSecrets({ claudeToken, anthropicKey });
    // the self-upgrade runner in the app repo authenticates with the same derived secret
    const appSecrets = await setAppSecrets({ claudeToken, anthropicKey }).catch(() => [] as string[]);
    return { ...sync, secrets, appSecrets };
  });
}

export async function setClaudeTokenAction(input: { claudeToken?: string; anthropicKey?: string; dbUrl?: string }) {
  return act(async () => {
    await assertAdmin();
    const ws = await setWorkspaceSecrets({ claudeToken: input.claudeToken, anthropicKey: input.anthropicKey });
    const app = await setAppSecrets({ claudeToken: input.claudeToken, anthropicKey: input.anthropicKey, dbUrl: input.dbUrl });
    return { workspace: ws, app };
  });
}

export async function configureSchedulerAction(interval: string) {
  return act(async () => {
    await assertAdmin();
    await configureScheduler(interval);
    await kickWorker(await origin());
    return null;
  });
}

export async function saveSettingsAction(patch: Partial<AppSettings>) {
  return act(async () => {
    await assertAdmin();
    return saveSettings(patch);
  });
}

// ------------------------------------------------------------------ prompts / learning
export async function savePromptVersionAction(agent: AgentKey, content: string, activate: boolean) {
  return act(async () => {
    const admin = await assertAdmin();
    if (!content.trim()) throw new Error("متن پرامپت خالی است");
    const { data: last } = await db().from("agent_prompts").select("version").eq("agent", agent).order("version", { ascending: false }).limit(1).maybeSingle();
    if (!last) {
      await db().from("agent_prompts").insert({ agent, version: 1, content: DEFAULT_PROMPTS[agent], is_active: false, source: "default" });
    }
    const version = (last?.version ?? 1) + 1;
    if (activate) await db().from("agent_prompts").update({ is_active: false }).eq("agent", agent);
    await db().from("agent_prompts").insert({ agent, version, content, is_active: activate, source: "human", created_by: admin.id });
    return { version };
  });
}

export async function activatePromptAction(agent: AgentKey, version: number | null) {
  return act(async () => {
    await assertAdmin();
    await db().from("agent_prompts").update({ is_active: false }).eq("agent", agent);
    if (version !== null) await db().from("agent_prompts").update({ is_active: true }).eq("agent", agent).eq("version", version);
    return null;
  });
}

export async function runOptimizerAction(agents: AgentKey[]) {
  return act(async () => {
    const admin = await assertAdmin();
    await enqueueJob({ kind: "optimize", payload: { agents }, priority: 20, created_by: admin.id });
    await kickWorker(await origin());
    return null;
  });
}

// ------------------------------------------------------------------ knowledge
export async function searchKnowledgeAction(query: string, kind?: string) {
  return act(async () => {
    await assertAdmin();
    return searchKnowledge(query, 12, kind ? { kind } : {});
  });
}

export async function addKnowledgeAction(input: { kind: string; title: string; content: string; tags: string[] }) {
  return act(async () => {
    await assertAdmin();
    if (!input.title.trim() || !input.content.trim()) throw new Error("عنوان و محتوا الزامی است");
    return addKnowledge([{ ...input, score: 5, source: "manual" }]);
  });
}

export async function deleteKnowledgeAction(ids: string[]) {
  return act(async () => {
    await assertAdmin();
    await db().from("knowledge_items").delete().in("id", ids);
    return null;
  });
}

export async function rateKnowledgeAction(id: string, delta: number) {
  return act(async () => {
    await assertAdmin();
    const { data } = await db().from("knowledge_items").select("score").eq("id", id).single();
    await db().from("knowledge_items").update({ score: Math.max(0, Math.min(10, (data?.score ?? 0) + delta)) }).eq("id", id);
    return null;
  });
}

// ------------------------------------------------------------------ self-upgrade
export async function createUpgradeAction(input: { title: string; prompt: string; autoMerge: boolean; files: UploadedFile[] }) {
  return act(async () => {
    const admin = await assertAdmin();
    if (!input.prompt.trim()) throw new Error("پرامپت ارتقا خالی است");
    const { data: up, error } = await db()
      .from("upgrades")
      .insert({ title: input.title.trim() || null, prompt: input.prompt.trim(), auto_merge: input.autoMerge, created_by: admin.id })
      .select("*")
      .single<Upgrade>();
    if (error || !up) throw new Error(error?.message ?? "ثبت ارتقا ناموفق بود");
    const branch = `upgrade/${up.code.toLowerCase()}`;
    await db().from("upgrades").update({ branch }).eq("id", up.id);
    if (input.files.length) {
      for (const f of input.files) if (!f.storage_path.startsWith(`${admin.id}/`)) throw new Error("مسیر فایل نامعتبر است");
      await db()
        .from("task_files")
        .insert(input.files.map((f) => ({ upgrade_id: up.id, context: "upgrade", storage_path: f.storage_path, name: f.name, mime: f.mime, size: f.size, uploaded_by: admin.id })));
    }
    await enqueueJob({ kind: "upgrade", upgrade_id: up.id, priority: 60, created_by: admin.id });
    await kickWorker(await origin());
    return { id: up.id, code: up.code };
  });
}

export async function mergeUpgradeAction(id: string) {
  return act(async () => {
    await assertAdmin();
    const { data: up } = await db().from("upgrades").select("*").eq("id", id).single<Upgrade>();
    if (!up) throw new Error("ارتقا یافت نشد");
    await mergeUpgrade(up);
    return null;
  });
}

export async function refreshPreviewAction(id: string) {
  return act(async () => {
    await assertAdmin();
    const { data: up } = await db().from("upgrades").select("*").eq("id", id).single<Upgrade>();
    if (!up?.pr_number) throw new Error("Pull Request ندارد");
    const ref = await repoRef("app");
    const { data: pr } = await gh().rest.pulls.get({ ...ref, pull_number: up.pr_number });
    const url = await previewUrlForSha(ref, pr.head.sha);
    if (pr.merged && up.status !== "merged") await db().from("upgrades").update({ status: "merged", merged_at: pr.merged_at }).eq("id", id);
    if (url) await db().from("upgrades").update({ preview_url: url }).eq("id", id);
    return { url, merged: pr.merged, state: pr.state };
  });
}

export async function cancelUpgradeAction(id: string) {
  return act(async () => {
    await assertAdmin();
    const { data: up } = await db().from("upgrades").select("*").eq("id", id).single<Upgrade>();
    if (!up) throw new Error("ارتقا یافت نشد");
    await db().from("jobs").update({ status: "cancelled", finished_at: new Date().toISOString(), locked_by: null, locked_until: null }).eq("upgrade_id", id).in("status", ["queued", "running"]);
    if (up.pr_number) {
      const ref = await repoRef("app");
      await gh().rest.pulls.update({ ...ref, pull_number: up.pr_number, state: "closed" }).catch(() => undefined);
    }
    await db().from("upgrades").update({ status: "cancelled" }).eq("id", id);
    return null;
  });
}

/** Revert a merged upgrade by opening + merging a revert commit on the default branch. */
export async function rollbackUpgradeAction(id: string) {
  return act(async () => {
    await assertAdmin();
    const { data: up } = await db().from("upgrades").select("*").eq("id", id).single<Upgrade>();
    if (!up?.pr_number || up.status !== "merged") throw new Error("فقط ارتقای ادغام‌شده قابل بازگشت است");
    const ref = await repoRef("app");
    const { data: pr } = await gh().rest.pulls.get({ ...ref, pull_number: up.pr_number });
    if (!pr.merge_commit_sha) throw new Error("commit ادغام پیدا نشد");
    const base = pr.base.ref;
    const { data: head } = await gh().rest.git.getRef({ ...ref, ref: `heads/${base}` });
    const { data: mergeCommit } = await gh().rest.git.getCommit({ ...ref, commit_sha: pr.merge_commit_sha });
    const parent = mergeCommit.parents[0]?.sha;
    if (!parent) throw new Error("والد commit پیدا نشد");
    const { data: parentCommit } = await gh().rest.git.getCommit({ ...ref, commit_sha: parent });
    if (head.object.sha !== pr.merge_commit_sha) {
      throw new Error("بعد از این ارتقا تغییرات دیگری ادغام شده؛ بازگشت را از طریق یک ارتقای جدید («این تغییر را برگردان») انجام دهید");
    }
    const { data: commit } = await gh().rest.git.createCommit({ ...ref, message: `Revert ${up.code}`, tree: parentCommit.tree.sha, parents: [head.object.sha] });
    await gh().rest.git.updateRef({ ...ref, ref: `heads/${base}`, sha: commit.sha });
    await db().from("upgrades").update({ status: "rolled_back" }).eq("id", id);
    return null;
  });
}

// ------------------------------------------------------------------ users
export async function setUserStatusAction(userId: string, status: "active" | "disabled" | "pending") {
  return act(async () => {
    const admin = await assertAdmin();
    if (userId === admin.id) throw new Error("نمی‌توانید وضعیت حساب خودتان را تغییر دهید");
    await db().from("profiles").update({ status }).eq("id", userId);
    return null;
  });
}

export async function setUserRoleAction(userId: string, role: "admin" | "requester") {
  return act(async () => {
    const admin = await assertAdmin();
    if (userId === admin.id) throw new Error("نمی‌توانید نقش خودتان را تغییر دهید");
    await db().from("profiles").update({ role }).eq("id", userId);
    return null;
  });
}

export async function createUserAction(input: { email: string; password: string; full_name: string; org_unit?: string; phone?: string }) {
  return act(async () => {
    await assertAdmin();
    if (input.password.length < 8) throw new Error("رمز عبور حداقل ۸ کاراکتر باشد");
    const { data, error } = await db().auth.admin.createUser({
      email: input.email.trim().toLowerCase(),
      password: input.password,
      email_confirm: true,
      user_metadata: { full_name: input.full_name, org_unit: input.org_unit, phone: input.phone },
    });
    if (error || !data.user) throw new Error(error?.message ?? "ساخت کاربر ناموفق بود");
    await db()
      .from("profiles")
      .upsert({ id: data.user.id, email: data.user.email, full_name: input.full_name, org_unit: input.org_unit ?? null, phone: input.phone ?? null, status: "active", role: "requester" });
    return { id: data.user.id };
  });
}

export async function resetUserPasswordAction(userId: string, password: string) {
  return act(async () => {
    await assertAdmin();
    if (password.length < 8) throw new Error("رمز عبور حداقل ۸ کاراکتر باشد");
    const { error } = await db().auth.admin.updateUserById(userId, { password });
    if (error) throw new Error(error.message);
    return null;
  });
}

export async function attachFilesToTaskAction(taskId: string, context: "prework" | "main", files: UploadedFile[]) {
  return act(async () => {
    const admin = await assertAdmin();
    await registerFiles(admin, [taskId], context, files);
    return null;
  });
}
