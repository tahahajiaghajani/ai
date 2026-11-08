// Background work of knowledge management (as the system, outside write transactions):
//   kb.sweep (every 30 minutes per organisation, re-queued by itself; the daily parts once a day)
//     · scheduled publications and retirements; review reminders and due reviews (banner, task or retirement as the
//       base says); expiry; negative feedback above the settings' threshold → a task for the owner group; the base
//       publishing models; reminders of read-and-acknowledge campaigns; expired KCS licences; view counters from the
//       event stream; articles whose owner left → one re-own task per person
//     · daily: health and next actions, duplicate candidates, knowledge gaps, integrity checks, the month's AQI samples,
//       retention of the event stream, and the trash emptied after its days
//   kb.counts      readable article counts of bases and categories
//   kb.reindex     a base's AI policy changed: its articles are indexed again
//   kb.block_hosts a block was published: its host articles (usage list) are indexed again
//   kb.units       the organisation tree changed: the unit sub-trees of audiences are expanded again
// Subscribers: approval decisions publish, schedule or return versions and retire articles; a published version tells
// its subscribers and the people working open records linked to the article; changes of the org tree.
import type { Ctx } from "../../context";
import { addJournalIn, createIn, defFor, onRecordEvent, removeIn, systemCtx, transitionIn, updateIn, type RecordEvent } from "../../engine";
import { enqueue, registerJobHandler, type JobContext } from "../../jobs";
import { actsHere, notifyPeople } from "../notify";
import { cancelApprovals } from "../sla";
import { activeMembers, addDaysISO, baseOf, countRows, expandUnits, isUuid, kbConfig, liveRow, liveRows, rowsById, sysOf, todayIn, uniq, type Row } from "./common";
import { publishIn } from "./versions";
import { runPublishingModels } from "./kcs";
import { remindAttestations } from "./attest";
import { computeHealth, detectGaps, findDuplicates, integrityChecks, sampleAqi } from "./quality";
import { pruneEvents, viewCounts } from "./events";

export const KB_SWEEP_EVERY = 30 * 60_000;
const lastQueued = new Map<string, number>();

export async function ensureKbSweep(q: JobContext["db"], orgId: string): Promise<void> {
  if (Date.now() - (lastQueued.get(orgId) ?? 0) < 10 * 60_000) return;
  lastQueued.set(orgId, Date.now());
  await enqueue(q, { kind: "kb.sweep", orgId, delayMs: 60_000, dedupeKey: "kb.sweep", maxAttempts: 5 });
}
export const resetKbSweepThrottle = () => lastQueued.clear();

export interface KbSweepResult {
  published: number;
  retired: number;
  reviews: number;
  expired: number;
  feedback: number;
  external: number;
  reminders: number;
  licences: number;
  reown: number;
  daily: boolean;
  health?: number;
  duplicates?: number;
  gaps?: number;
  integrity?: number;
  aqi?: number;
  purged?: number;
}

/** One pass of the sweep (exported for tests and the «اجرا» button of the workspace). */
export async function kbSweep(sys: Ctx, opts: { daily?: boolean } = {}): Promise<KbSweepResult> {
  const out: KbSweepResult = { published: 0, retired: 0, reviews: 0, expired: 0, feedback: 0, external: 0, reminders: 0, licences: 0, reown: 0, daily: !!opts.daily };
  const cfg = await kbConfig(sys.db, sys);
  const today = todayIn(sys);
  const now = new Date().toISOString();

  // scheduled publications
  for (const v of await liveRows(sys.db, sys, "kb_version", { and: [{ f: "state", op: "eq", v: "scheduled" }, { f: "publish_at", op: "lte", v: now }] }, { limit: 200 })) {
    try {
      await sys.write((tx) => publishIn(tx, sys, v.id, v.approved_by ?? v.submitted_by ?? null));
      out.published++;
    } catch {
      // an article that left publication meanwhile keeps the version as it is (articleAfter returns it to draft)
    }
  }
  // scheduled retirements
  for (const a of await liveRows(sys.db, sys, "kb_article", { and: [{ f: "state", op: "in", v: ["published", "pending_retirement"] }, { f: "retire_at", op: "lte", v: today }] }, { limit: 200 })) {
    await sys.write((tx) => transitionIn(tx, sys, "kb_article", a.id, "retired", { retire_reason: a.retire_reason || "بازنشستگی زمان‌بندی‌شده" }, { trusted: true }));
    out.retired++;
  }

  // reviews: reminders before the date, then what the base says
  const soon = addDaysISO(today, Math.max(0, cfg.review_remind_days));
  for (const a of await liveRows(sys.db, sys, "kb_article", { and: [{ f: "state", op: "in", v: ["published", "pending_retirement"] }, { f: "review_at", op: "lte", v: soon }] }, { limit: 1000 })) {
    const due = String(a.review_at) <= today;
    const base = await baseOf(sys.db, sys, a.base_id);
    const [open] = await liveRows(sys.db, sys, "kb_task", { and: [{ f: "article_id", op: "eq", v: a.id }, { f: "kind", op: "eq", v: "review" }, { f: "active", op: "eq", v: true }] }, { limit: 1 });
    await sys.write(async (tx) => {
      if (!open) {
        await createIn(tx, sys, "kb_task", { kind: "review", article_id: a.id, priority: due ? "3" : "4", assigned_to: a.owner_id ?? null, due_at: `${a.review_at}T12:00:00.000Z`, short_description: `بازبینی دوره‌ای ${a.number}: ${String(a.title).slice(0, 150)}`, description: "مقاله را بخوانید و یکی را بزنید: «درست است» (موعد بعدی تعیین می‌شود)، «به‌روزرسانی» یا «بازنشستگی»." }, { trusted: true });
        out.reviews++;
      }
      if (due && !a.review_due) {
        if (base?.review_policy === "retire") await transitionIn(tx, sys, "kb_article", a.id, "retired", { retire_reason: "موعد بازبینی گذشت (قاعدهٔ پایگاه)" }, { trusted: true });
        else if (base?.review_policy !== "task") await updateIn(tx, sys, "kb_article", a.id, { review_due: true }, { trusted: true, keepVersion: true, allowLocked: true });
      }
    });
  }
  // expiry
  for (const a of await liveRows(sys.db, sys, "kb_article", { and: [{ f: "state", op: "in", v: ["published", "pending_retirement"] }, { f: "valid_to", op: "lt", v: today }] }, { limit: 500 })) {
    const [open] = await liveRows(sys.db, sys, "kb_task", { and: [{ f: "article_id", op: "eq", v: a.id }, { f: "kind", op: "eq", v: "expiry" }, { f: "active", op: "eq", v: true }] }, { limit: 1 });
    if (open) continue;
    await sys.write((tx) => createIn(tx, sys, "kb_task", { kind: "expiry", article_id: a.id, priority: "3", assigned_to: a.owner_id ?? null, short_description: `اعتبار ${a.number} گذشته است: ${String(a.title).slice(0, 150)}`, description: "تاریخ «معتبر تا» را تمدید کنید (پس از بازبینی) یا مقاله را بازنشسته کنید." }, { trusted: true }));
    out.expired++;
  }
  // negative feedback above the threshold
  for (const a of await liveRows(sys.db, sys, "kb_article", { and: [{ f: "state", op: "in", v: ["published", "pending_retirement"] }, { f: "helpful_no", op: "gte", v: 1 }] }, { limit: 2000 })) {
    const yes = Number(a.helpful_yes ?? 0);
    const no = Number(a.helpful_no ?? 0);
    if (yes + no < cfg.negative_min_votes || (100 * no) / (yes + no) < cfg.negative_ratio) continue;
    const [open] = await liveRows(sys.db, sys, "kb_task", { and: [{ f: "article_id", op: "eq", v: a.id }, { f: "kind", op: "eq", v: "feedback" }, { f: "active", op: "eq", v: true }] }, { limit: 1 });
    if (open) continue;
    await sys.write((tx) => createIn(tx, sys, "kb_task", { kind: "feedback", article_id: a.id, priority: "3", short_description: `بیشتر خوانندگان «${String(a.title).slice(0, 120)}» را مفید ندانستند`, description: `${no} رأی «مفید نبود» در برابر ${yes} رأی «مفید بود». نظرهای خوانندگان را در بازخوردهای مقاله ببینید.` }, { trusted: true }));
    out.feedback++;
  }
  out.external = (await runPublishingModels(sys)).external;
  out.reminders = await remindAttestations(sys);
  // expired KCS licences
  for (const l of await liveRows(sys.db, sys, "kb_licence", { and: [{ f: "state", op: "eq", v: "active" }, { f: "expires_at", op: "lt", v: today }] }, { limit: 500 })) {
    await sys.write((tx) => transitionIn(tx, sys, "kb_licence", l.id, "expired", {}, { trusted: true }));
    out.licences++;
  }
  // view counters from the stream
  const views = await viewCounts(sys.db, sys.org.id, null);
  if (views.size) {
    const arts = await rowsById(sys.db, sys, "kb_article", [...views.keys()].slice(0, 5000));
    for (const a of arts) {
      const n = views.get(a.id) ?? 0;
      if (Number(a.view_count ?? 0) !== n) await sys.write((tx) => updateIn(tx, sys, "kb_article", a.id, { view_count: n }, { trusted: true, keepVersion: true, allowLocked: true }));
    }
  }
  // owners who left
  const owned = await liveRows(sys.db, sys, "kb_article", { f: "state", op: "nin", v: ["trashed", "retired"] }, { limit: 20_000 });
  const owners = uniq(owned.map((a) => a.owner_id).filter(isUuid));
  const active = await activeMembers(sys.db, sys.org.id, owners);
  for (const o of owners.filter((x) => !active.has(x))) {
    const [open] = await liveRows(sys.db, sys, "kb_task", { and: [{ f: "kind", op: "eq", v: "re_own" }, { f: "source_id", op: "eq", v: o }, { f: "active", op: "eq", v: true }] }, { limit: 1 });
    if (open) continue;
    const n = owned.filter((a) => a.owner_id === o).length;
    await sys.write((tx) => createIn(tx, sys, "kb_task", { kind: "re_own", priority: "3", source_table: "user", source_id: o, short_description: `${n} مقاله مالکی دارد که دیگر عضو نیست`, description: "در میز کار دانش «انتقال مالکیت» را بزنید و مالک تازه را انتخاب کنید." }, { trusted: true }));
    out.reown++;
  }

  if (opts.daily) {
    out.health = await computeHealth(sys);
    out.duplicates = await findDuplicates(sys);
    out.gaps = await detectGaps(sys);
    out.integrity = await integrityChecks(sys);
    out.aqi = await sampleAqi(sys);
    await pruneEvents(sys.db, sys.org.id, cfg.events_days);
    // the trash, emptied after its days (removed for good from lists; history stays)
    const cutoff = new Date(Date.now() - cfg.trash_days * 86_400_000).toISOString();
    let purged = 0;
    for (const a of await liveRows(sys.db, sys, "kb_article", { and: [{ f: "state", op: "eq", v: "trashed" }, { f: "trashed_at", op: "lt", v: cutoff }] }, { limit: 500 })) {
      await sys.write((tx) => removeIn(tx, sys, "kb_article", a.id, { allowLocked: true }));
      purged++;
    }
    out.purged = purged;
  }
  return out;
}

/** Readable counts of published articles per base and category (as the system: the stored counters are org-wide). */
async function recount(sys: Ctx): Promise<void> {
  const arts = await liveRows(sys.db, sys, "kb_article", { f: "state", op: "in", v: ["published", "pending_retirement"] }, { limit: 50_000 });
  const perBase = new Map<string, number>();
  const perCat = new Map<string, number>();
  for (const a of arts) {
    perBase.set(a.base_id, (perBase.get(a.base_id) ?? 0) + 1);
    if (a.category_id) perCat.set(a.category_id, (perCat.get(a.category_id) ?? 0) + 1);
  }
  for (const b of await liveRows(sys.db, sys, "kb_base", null, { limit: 500 })) {
    const n = perBase.get(b.id) ?? 0;
    if (Number(b.article_count ?? 0) !== n) await sys.write((tx) => updateIn(tx, sys, "kb_base", b.id, { article_count: n }, { trusted: true, keepVersion: true }));
  }
  for (const c of await liveRows(sys.db, sys, "kb_category", null, { limit: 5000 })) {
    const n = perCat.get(c.id) ?? 0;
    if (Number(c.article_count ?? 0) !== n) await sys.write((tx) => updateIn(tx, sys, "kb_category", c.id, { article_count: n }, { trusted: true, keepVersion: true }));
  }
}

/** Re-index articles (AI policy of their base changed, or a block they embed). */
async function reindex(jctx: JobContext, orgId: string, ids: string[]): Promise<void> {
  const { indexNow } = await import("../ai/rag");
  for (const id of ids.slice(0, 2000)) await indexNow(jctx.cfg, orgId, "kb_article", id, { force: true }).catch(() => undefined);
}

/** Unit sub-trees of every audience, expanded again (the org tree changed). */
async function recompileUnits(sys: Ctx): Promise<void> {
  for (const b of await liveRows(sys.db, sys, "kb_base", null, { limit: 500 })) {
    const r = await expandUnits(sys.db, sys, b.read_units, b.units_tree !== false);
    const x = await expandUnits(sys.db, sys, b.deny_units, true);
    if (JSON.stringify(r) !== JSON.stringify(b.r_units ?? []) || JSON.stringify(x) !== JSON.stringify(b.x_units ?? [])) await sys.write((tx) => updateIn(tx, sys, "kb_base", b.id, { r_units: r, x_units: x }, { trusted: true, keepVersion: true }));
  }
  for (const c of await liveRows(sys.db, sys, "kb_category", { f: "read_mode", op: "eq", v: "audience" }, { order: "t.depth", limit: 5000 })) {
    const u = await expandUnits(sys.db, sys, c.read_units, c.units_tree !== false);
    if (JSON.stringify(u) !== JSON.stringify(c.c_units ?? [])) await sys.write((tx) => updateIn(tx, sys, "kb_category", c.id, { c_units: u }, { trusted: true, keepVersion: true }));
  }
  for (const a of await liveRows(sys.db, sys, "kb_article", { or: [{ f: "read_units", op: "nempty" }, { f: "deny_units", op: "nempty" }] }, { limit: 20_000 })) {
    const r = await expandUnits(sys.db, sys, a.read_units, a.units_tree !== false);
    const x = await expandUnits(sys.db, sys, a.deny_units, true);
    if (JSON.stringify(r) !== JSON.stringify(a.r_units ?? []) || JSON.stringify(x) !== JSON.stringify(a.x_units ?? [])) await sys.write((tx) => updateIn(tx, sys, "kb_article", a.id, { r_units: r, x_units: x }, { trusted: true, keepVersion: true, allowLocked: true }));
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Subscribers

async function onApproval(e: RecordEvent, jctx: JobContext): Promise<void> {
  if (!actsHere(jctx.cfg) || !isUuid(e.org_id) || !isUuid(e.id)) return;
  const outcome = String(e.data?.outcome ?? "");
  const decision = String(e.data?.decision ?? "");
  const by = isUuid(e.data?.by) ? String(e.data!.by) : null;
  const sys = await systemCtx(jctx.cfg, e.org_id, by ? { onBehalfOf: by } : undefined);
  const comment = e.data?.comment ? String(e.data.comment) : "";
  // «یک تأییدکننده کافی است»: the first answer decides — a rejection returns the draft at once (its author gets the
  // reviewer's comment) and the other reviewers' open approvals are withdrawn; the other modes follow the round
  const firstAnswer = (mode: unknown) => (mode ?? "any") === "any" && decision === "rejected";
  if (e.table === "kb_version") {
    const v = await liveRow(jctx.db, sys, "kb_version", e.id);
    if (!v || v.state !== "in_review") return;
    const rejected = outcome === "rejected" || firstAnswer(v.approval_mode);
    if (outcome !== "approved" && !rejected) return;
    if (rejected) await cancelApprovals(sys, "kb_version", v.id).catch(() => undefined);
    await sys.write(async (tx) => {
      if (!rejected) {
        await updateIn(tx, sys, "kb_version", v.id, { approved_at: new Date().toISOString(), approved_by: by }, { trusted: true });
        await publishIn(tx, sys, v.id, by);
      } else {
        const back = await transitionIn(tx, sys, "kb_version", v.id, "draft", {}, { trusted: true });
        const { def } = await defFor(sys, "kb_version", tx);
        await addJournalIn(tx, sys, def, back, { kind: "work_note", body: `نسخه برای اصلاح برگشت${comment ? `: ${comment.slice(0, 1000)}` : "."}` }, { trusted: true, author: by });
      }
    });
    return;
  }
  if (e.table === "kb_article") {
    const a = await liveRow(jctx.db, sys, "kb_article", e.id);
    if (!a || a.state !== "pending_retirement") return;
    const rejected = outcome === "rejected" || firstAnswer("any");
    if (outcome !== "approved" && !rejected) return;
    if (rejected) await cancelApprovals(sys, "kb_article", a.id).catch(() => undefined);
    await sys.write((tx) => transitionIn(tx, sys, "kb_article", a.id, rejected ? "published" : "retired", rejected ? { retire_reason: null } : {}, { trusted: true }));
  }
}

/** A published version: subscribers of the article, its category and its base; people working open linked records. */
async function onPublished(e: RecordEvent, jctx: JobContext): Promise<void> {
  if (!actsHere(jctx.cfg) || !isUuid(e.org_id) || !isUuid(e.id)) return;
  const sys = await systemCtx(jctx.cfg, e.org_id);
  const a = await liveRow(jctx.db, sys, "kb_article", e.id);
  if (!a) return;
  const major = !!e.data?.major;
  const first = !!e.data?.first;
  const subs = await liveRows(jctx.db, sys, "kb_subscription", {
    or: [
      { and: [{ f: "target_table", op: "eq", v: "kb_article" }, { f: "target_id", op: "eq", v: a.id }] },
      ...(a.category_id ? [{ and: [{ f: "target_table", op: "eq" as const, v: "kb_category" }, { f: "target_id", op: "eq" as const, v: a.category_id }] }] : []),
      { and: [{ f: "target_table", op: "eq", v: "kb_base" }, { f: "target_id", op: "eq", v: a.base_id }] },
    ],
  }, { limit: 5000 });
  const wanted = subs.filter((s) => {
    const ev: string[] = Array.isArray(s.events) ? s.events : ["published"];
    return ev.includes("published") || (major && ev.includes("major")) || (first && s.target_table !== "kb_article");
  });
  const users = uniq(wanted.map((s) => s.user_id).filter((u) => u && u !== e.actor));
  // people working open records linked to the article (a workaround they apply changed)
  const linked = first ? [] : await jctx.db.query<{ from_table: string; from_id: string }>(`select from_table, from_id from sm_links where org_id = $1 and to_table = 'kb_article' and to_id = $2 and deleted_at is null and kind in ('kb_solved_by', 'kb_workaround', 'kb_related')`, [e.org_id, a.id]);
  const workers: string[] = [];
  for (const l of linked.slice(0, 200)) {
    const r = await liveRow(jctx.db, sys, l.from_table, l.from_id).catch(() => null);
    if (r && r.active === true && isUuid(r.assigned_to) && r.assigned_to !== e.actor) workers.push(r.assigned_to);
  }
  await sys.write(async (tx) => {
    if (users.length) {
      await notifyPeople(tx, e.org_id, { table: "kb_article", id: a.id, users, event: "custom", label: first ? "مقالهٔ تازه" : "به‌روزرسانی مقاله", subject: `${first ? "مقالهٔ تازه" : major ? "تغییر اساسی مقاله" : "به‌روزرسانی مقاله"}: {{record.display}}`, body: `نسخهٔ ${e.data?.version ?? a.version_label ?? ""} منتشر شد.`, channels: ["in_app", "email"], actor: e.actor, source: "مدیریت دانش" });
    }
    if (workers.length) {
      await notifyPeople(tx, e.org_id, { table: "kb_article", id: a.id, users: uniq(workers), event: "custom", label: "مقالهٔ پیوسته تغییر کرد", subject: "مقالهٔ پیوسته به رکورد باز شما تغییر کرد: {{record.display}}", body: "راه‌حل یا راه‌حل موقت این مقاله به‌روز شده است؛ آن را با رکوردهای باز خود بررسی کنید.", channels: ["in_app"], actor: e.actor, source: "مدیریت دانش" });
    }
  });
}

async function onKbEvent(e: RecordEvent, jctx: JobContext): Promise<void> {
  if (!actsHere(jctx.cfg) || !isUuid(e.org_id)) return;
  await ensureKbSweep(jctx.db, e.org_id);
}

let installed = false;
export function installKnowledgeJobs(): void {
  if (installed) return;
  installed = true;
  onRecordEvent("kb.approvals", onApproval, { tables: ["kb_version", "kb_article"], kinds: ["record.approval_decided"] });
  onRecordEvent("kb.published", onPublished, { tables: ["kb_article"], kinds: ["record.kb.published"] });
  onRecordEvent("kb.sweep", onKbEvent, { tables: ["kb_article", "kb_version", "kb_feedback", "kb_task"], kinds: ["record.created"] });
  onRecordEvent("kb.units", async (e, jctx) => {
    if (!actsHere(jctx.cfg) || !isUuid(e.org_id)) return;
    if (e.kind === "record.updated" && !(e.changed ?? []).some((f) => f === "parent_id" || f === "path")) return;
    await enqueue(jctx.db, { kind: "kb.units", orgId: e.org_id, payload: {}, dedupeKey: "kb.units", delayMs: 5_000 });
  }, { tables: ["org_unit"], kinds: ["record.created", "record.updated", "record.deleted"] });
  registerJobHandler("kb.sweep", async (job, jctx) => {
    if (!job.org_id || !actsHere(jctx.cfg)) return;
    const sys = await systemCtx(jctx.cfg, job.org_id);
    const payload = (job.payload ?? {}) as { daily_on?: string };
    const today = todayIn(sys);
    const daily = payload.daily_on !== today;
    await kbSweep(sys, { daily });
    if (daily) await jctx.save({ ...payload, daily_on: today });
    return { again: KB_SWEEP_EVERY };
  });
  registerJobHandler("kb.counts", async (job, jctx) => {
    if (!job.org_id) return;
    await recount(await systemCtx(jctx.cfg, job.org_id));
  });
  registerJobHandler("kb.reindex", async (job, jctx) => {
    if (!job.org_id) return;
    const sys = await systemCtx(jctx.cfg, job.org_id);
    const baseId = String((job.payload as Row | null)?.base_id ?? "");
    const arts = await liveRows(jctx.db, sys, "kb_article", { f: "base_id", op: "eq", v: baseId }, { limit: 5000 });
    await reindex(jctx, job.org_id, arts.map((a) => a.id));
  });
  registerJobHandler("kb.block_hosts", async (job, jctx) => {
    if (!job.org_id) return;
    const sys = await systemCtx(jctx.cfg, job.org_id);
    const b = await liveRow(jctx.db, sys, "kb_block", (job.payload as Row | null)?.block_id);
    if (!b?.number) return;
    const needle = String(b.number);
    const hosts = (await liveRows(jctx.db, sys, "kb_article", { or: [{ f: "body", op: "contains", v: `block:${needle}` }, { f: "internal_body", op: "contains", v: `block:${needle}` }] }, { limit: 2000 })).map((a) => a.id);
    await sys.write((tx) => updateIn(tx, sys, "kb_block", b.id, { used_in: hosts.slice(0, 500) }, { trusted: true, keepVersion: true }));
    await reindex(jctx, job.org_id, hosts);
  });
  registerJobHandler("kb.units", async (job, jctx) => {
    if (!job.org_id) return;
    await recompileUnits(await systemCtx(jctx.cfg, job.org_id));
  });
}

export { countRows };
