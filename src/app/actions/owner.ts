"use server";
import { headers } from "next/headers";
import { assertOwner } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { saveSystemSettings, type SystemSettings } from "@/lib/settings";
import { saveBanner, type BannerTone } from "@/lib/banner";
import { configureScheduler, setAppSecrets, systemStatus } from "@/lib/system";
import { enqueueJob, kickWorker } from "@/lib/queue/jobs";
import { mergeUpgrade } from "@/lib/claude/ingest";
import { appRepo, previewUrlForSha } from "@/lib/github/client";
import { act, mutate } from "./_util";
import { measureSpeed } from "@/lib/speed";
import { deleteUser } from "@/lib/tasks/delete";
import type { UploadedFile } from "@/lib/tasks/service";
import type { Upgrade } from "@/lib/types";

/*
 * Owner-only actions: the shared parts of the app (Vercel/Supabase, scheduler, worker lanes),
 * user management and upgrading the app itself. Every function checks assertOwner() first.
 */

async function origin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  return host ? `${h.get("x-forwarded-proto") ?? "https"}://${host}` : undefined;
}

// ------------------------------------------------------------------ system
export async function speedCheckAction() {
  return act(async () => {
    await assertOwner();
    return measureSpeed();
  });
}

export async function systemStatusAction() {
  return act(async () => {
    await assertOwner();
    return systemStatus();
  });
}

export async function configureSchedulerAction(interval: string) {
  return act(async () => {
    await assertOwner();
    await configureScheduler(interval);
    await kickWorker(await origin());
    return null;
  });
}

export async function saveSystemSettingsAction(patch: Partial<SystemSettings>) {
  return act(async () => {
    await assertOwner();
    return saveSystemSettings(patch);
  });
}

/** The message every user sees at the top of the app. */
export async function saveBannerAction(input: { text: string; link?: string | null; tone?: BannerTone; active: boolean }) {
  return mutate(async () => {
    await assertOwner();
    return saveBanner(input);
  });
}

/** How many AI jobs run at once for everyone, and per user. */
export async function saveLaneAction(lane: "llm" | "external" | "system", input: { max_running?: number; per_owner?: number; paused?: boolean }) {
  return mutate(async () => {
    await assertOwner();
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.max_running !== undefined) patch.max_running = Math.max(1, Math.min(Math.round(input.max_running), 200));
    if (input.per_owner !== undefined) patch.per_owner = Math.max(1, Math.min(Math.round(input.per_owner), 10));
    if (input.paused !== undefined) patch.paused = !!input.paused;
    await db().from("worker_lanes").update(patch).eq("lane", lane);
    if (input.paused === false) await kickWorker(await origin());
    return null;
  });
}

export async function setAppSecretsAction(input: { claudeToken?: string; anthropicKey?: string; dbUrl?: string }) {
  return act(async () => {
    await assertOwner();
    return setAppSecrets(input);
  });
}

// ------------------------------------------------------------------ self-upgrade
export async function createUpgradeAction(input: { title: string; prompt: string; autoMerge: boolean; files: UploadedFile[] }) {
  return act(async () => {
    const owner = await assertOwner();
    if (!input.prompt.trim()) throw new Error("پرامپت ارتقا خالی است");
    const { data: up, error } = await db()
      .from("upgrades")
      .insert({ title: input.title.trim() || null, prompt: input.prompt.trim(), auto_merge: input.autoMerge, created_by: owner.id })
      .select("*")
      .single<Upgrade>();
    if (error || !up) throw new Error(error?.message ?? "ثبت ارتقا ناموفق بود");
    await db().from("upgrades").update({ branch: `upgrade/${up.code.toLowerCase()}` }).eq("id", up.id);
    if (input.files.length) {
      for (const f of input.files) if (!f.storage_path.startsWith(`${owner.id}/`)) throw new Error("مسیر فایل نامعتبر است");
      await db()
        .from("task_files")
        .insert(input.files.map((f) => ({ upgrade_id: up.id, context: "upgrade", storage_path: f.storage_path, name: f.name, mime: f.mime, size: f.size, uploaded_by: owner.id })));
    }
    await enqueueJob({ kind: "upgrade", owner_id: owner.id, upgrade_id: up.id, priority: 60, created_by: owner.id });
    await kickWorker(await origin());
    return { id: up.id, code: up.code };
  });
}

export async function mergeUpgradeAction(id: string) {
  return act(async () => {
    await assertOwner();
    const { data: up } = await db().from("upgrades").select("*").eq("id", id).single<Upgrade>();
    if (!up) throw new Error("ارتقا یافت نشد");
    await mergeUpgrade(up);
    return null;
  });
}

export async function refreshPreviewAction(id: string) {
  return act(async () => {
    await assertOwner();
    const { data: up } = await db().from("upgrades").select("*").eq("id", id).single<Upgrade>();
    if (!up?.pr_number) throw new Error("Pull Request ندارد");
    const app = await appRepo();
    const { data: pr } = await app.gh.rest.pulls.get({ owner: app.owner, repo: app.repo, pull_number: up.pr_number });
    const url = await previewUrlForSha(app, pr.head.sha);
    if (pr.merged && up.status !== "merged") await db().from("upgrades").update({ status: "merged", merged_at: pr.merged_at }).eq("id", id);
    if (url) await db().from("upgrades").update({ preview_url: url }).eq("id", id);
    return { url, merged: pr.merged, state: pr.state };
  });
}

export async function cancelUpgradeAction(id: string) {
  return act(async () => {
    await assertOwner();
    const { data: up } = await db().from("upgrades").select("*").eq("id", id).single<Upgrade>();
    if (!up) throw new Error("ارتقا یافت نشد");
    await db().from("jobs").update({ status: "cancelled", finished_at: new Date().toISOString(), locked_by: null, locked_until: null }).eq("upgrade_id", id).in("status", ["queued", "running"]);
    if (up.pr_number) {
      const app = await appRepo();
      await app.gh.rest.pulls.update({ owner: app.owner, repo: app.repo, pull_number: up.pr_number, state: "closed" }).catch(() => undefined);
    }
    await db().from("upgrades").update({ status: "cancelled" }).eq("id", id);
    return null;
  });
}

/** Revert a merged upgrade with a commit on the default branch (only while nothing was merged after it). */
export async function rollbackUpgradeAction(id: string) {
  return act(async () => {
    await assertOwner();
    const { data: up } = await db().from("upgrades").select("*").eq("id", id).single<Upgrade>();
    if (!up?.pr_number || up.status !== "merged") throw new Error("فقط ارتقای ادغام‌شده قابل بازگشت است");
    const app = await appRepo();
    const ref = { owner: app.owner, repo: app.repo };
    const { data: pr } = await app.gh.rest.pulls.get({ ...ref, pull_number: up.pr_number });
    if (!pr.merge_commit_sha) throw new Error("commit ادغام پیدا نشد");
    const base = pr.base.ref;
    const { data: head } = await app.gh.rest.git.getRef({ ...ref, ref: `heads/${base}` });
    const { data: mergeCommit } = await app.gh.rest.git.getCommit({ ...ref, commit_sha: pr.merge_commit_sha });
    const parent = mergeCommit.parents[0]?.sha;
    if (!parent) throw new Error("والد commit پیدا نشد");
    const { data: parentCommit } = await app.gh.rest.git.getCommit({ ...ref, commit_sha: parent });
    if (head.object.sha !== pr.merge_commit_sha) throw new Error("بعد از این ارتقا تغییرات دیگری ادغام شده؛ بازگشت را با یک ارتقای جدید («این تغییر را برگردان») انجام دهید");
    const { data: commit } = await app.gh.rest.git.createCommit({ ...ref, message: `Revert ${up.code}`, tree: parentCommit.tree.sha, parents: [head.object.sha] });
    await app.gh.rest.git.updateRef({ ...ref, ref: `heads/${base}`, sha: commit.sha });
    await db().from("upgrades").update({ status: "rolled_back" }).eq("id", id);
    return null;
  });
}

// ------------------------------------------------------------------ users
export async function setUserStatusAction(userId: string, status: "active" | "disabled" | "pending") {
  return mutate(async () => {
    const owner = await assertOwner();
    if (userId === owner.id) throw new Error("نمی‌توانید وضعیت حساب خودتان را تغییر دهید");
    await db().from("profiles").update({ status }).eq("id", userId);
    return null;
  });
}

export async function setUserRoleAction(userId: string, role: "owner" | "member") {
  return mutate(async () => {
    const owner = await assertOwner();
    if (userId === owner.id) throw new Error("نمی‌توانید نقش خودتان را تغییر دهید");
    await db().from("profiles").update({ role, ...(role === "owner" ? { mode: "full" } : {}) }).eq("id", userId);
    return null;
  });
}

export async function createUserAction(input: { email: string; password: string; full_name: string; org_unit?: string; phone?: string }) {
  return mutate(async () => {
    await assertOwner();
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
      .upsert({ id: data.user.id, email: data.user.email, full_name: input.full_name, org_unit: input.org_unit ?? null, phone: input.phone ?? null, status: "active", role: "member", mode: "simple" });
    return { id: data.user.id };
  });
}

export async function resetUserPasswordAction(userId: string, password: string) {
  return act(async () => {
    await assertOwner();
    if (password.length < 8) throw new Error("رمز عبور حداقل ۸ کاراکتر باشد");
    const { error } = await db().auth.admin.updateUserById(userId, { password });
    if (error) throw new Error(error.message);
    return null;
  });
}

/** Deletes a user; their tasks are deleted with everything in them or transferred to the owner. */
export async function deleteUserAction(userId: string, mode: "delete" | "transfer") {
  return mutate(async () => {
    const owner = await assertOwner();
    if (mode !== "delete" && mode !== "transfer") throw new Error("حالت حذف نامعتبر است");
    return deleteUser(owner, userId, mode);
  });
}
