// Read-and-acknowledge campaigns (KB-026): a controlled article (policy, circular, regulation) is sent to people, groups
// and units of the organisation tree (with their sub-units) with a Jalali due date; each member confirms «خواندم و
// می‌پذیرم» for the version in force — recorded as `kb_ack` rows the member and the campaign's owner can read — and the
// sweep reminds those who have not, through the notification service, every few days until the campaign ends.
import type { KbAttestationItem } from "@shared/knowledge/api";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { createIn, get, updateIn } from "../../engine";
import { bad, forbidden } from "../../http/errors";
import { notifyPeople } from "../notify";
import { activeMembers, expandUnits, groupMembers, ids, liveRow, liveRows, rowsById, sysOf, todayIn, uniq, unitMembers, type Row } from "./common";
import { logEvent } from "./events";

/** Everyone a campaign addresses (active members). */
export async function audienceOf(q: Queryable, ctx: Ctx, att: Row): Promise<string[]> {
  const sys = sysOf(ctx);
  const units = await expandUnits(q, sys, att.target_units, true);
  const people = uniq([...ids(att.target_users), ...(await groupMembers(q, sys, att.target_groups)), ...(await unitMembers(q, sys, units))]);
  const active = await activeMembers(q, ctx.org.id, people);
  return people.filter((p) => active.has(p));
}

async function acked(q: Queryable, ctx: Ctx, attId: string): Promise<Set<string>> {
  const rows = await liveRows(q, sysOf(ctx), "kb_ack", { f: "attestation_id", op: "eq", v: attId }, { limit: 50_000 });
  return new Set(rows.map((r) => String(r.user_id)));
}

/** The member's pending (or done) acknowledgement of an article, if a running campaign addresses them. */
export async function myAttestation(ctx: Ctx, articleId: string): Promise<{ attestation_id: string; title: string; due_at: string; acked_at: string | null } | null> {
  const sys = sysOf(ctx);
  const camps = await liveRows(ctx.db, sys, "kb_attestation", { and: [{ f: "article_id", op: "eq", v: articleId }, { f: "state", op: "eq", v: "active" }] }, { order: "t.created_at desc", limit: 5 });
  for (const c of camps) {
    const aud = await audienceOf(ctx.db, ctx, c);
    if (!aud.includes(ctx.user.id)) continue;
    const [ack] = await liveRows(ctx.db, sys, "kb_ack", { and: [{ f: "attestation_id", op: "eq", v: c.id }, { f: "user_id", op: "eq", v: ctx.user.id }] }, { limit: 1 });
    return { attestation_id: c.id, title: c.title, due_at: c.due_at, acked_at: ack?.acked_at ?? null };
  }
  return null;
}

/** «خواندم و می‌پذیرم» (the member must be addressed by the campaign and read the article). */
export async function acknowledge(ctx: Ctx, attId: string) {
  if (ctx.actor === "system") throw bad("تأیید مطالعه با خود عضو است");
  const sys = sysOf(ctx);
  const att = await liveRow(ctx.db, sys, "kb_attestation", attId);
  if (!att || att.state !== "active") throw bad("این کارزار در جریان نیست");
  const article = (await get(ctx, "kb_article", att.article_id)).row as Row; // 404 unless readable
  const aud = await audienceOf(ctx.db, ctx, att);
  if (!aud.includes(ctx.user.id)) throw forbidden("این کارزار شما را در بر نمی‌گیرد");
  const done = await acked(ctx.db, ctx, attId);
  const by = sysOf(ctx, ctx.user.id);
  if (!done.has(ctx.user.id)) {
    await by.write(async (tx) => {
      await createIn(tx, by, "kb_ack", { attestation_id: attId, article_id: att.article_id, user_id: ctx.user.id, version_label: article.version_label ?? null, acked_at: new Date().toISOString() }, { trusted: true });
      await updateIn(tx, by, "kb_attestation", attId, { ack_count: done.size + 1, audience_count: aud.length }, { trusted: true, keepVersion: true });
    });
    await logEvent(ctx.db, ctx, { kind: "attest", article_id: att.article_id, data: { attestation_id: attId } });
  }
  return { ok: true as const };
}

/** Campaigns addressing the member (running, and the done ones of the last months). */
export async function myAttestations(ctx: Ctx): Promise<KbAttestationItem[]> {
  const sys = sysOf(ctx);
  const camps = await liveRows(ctx.db, sys, "kb_attestation", { f: "state", op: "eq", v: "active" }, { order: "t.due_at", limit: 200 });
  const out: KbAttestationItem[] = [];
  const today = todayIn(ctx);
  for (const c of camps) {
    const aud = await audienceOf(ctx.db, ctx, c);
    if (!aud.includes(ctx.user.id)) continue;
    const [article] = await rowsById(ctx.db, ctx, "kb_article", [c.article_id]);
    if (!article) continue;
    const [ack] = await liveRows(ctx.db, sys, "kb_ack", { and: [{ f: "attestation_id", op: "eq", v: c.id }, { f: "user_id", op: "eq", v: ctx.user.id }] }, { limit: 1 });
    out.push({ id: c.id, number: c.number ?? null, title: c.title, article_id: c.article_id, article_title: article.title, version_label: c.version_label ?? null, due_at: c.due_at, acked_at: ack?.acked_at ?? null, overdue: !ack && String(c.due_at) < today });
  }
  return out;
}

/** Who has and has not acknowledged (for the campaign's owner; counts kept on the campaign). */
export async function attestationStatus(ctx: Ctx, attId: string) {
  const att = (await get(ctx, "kb_attestation", attId)).row as Row; // 404 unless the caller reads the campaign
  const aud = await audienceOf(ctx.db, ctx, att);
  const done = await acked(ctx.db, ctx, attId);
  const pending = aud.filter((u) => !done.has(u));
  if (att.audience_count !== aud.length || att.ack_count !== done.size) {
    const sys = sysOf(ctx);
    await sys.write((tx) => updateIn(tx, sys, "kb_attestation", attId, { audience_count: aud.length, ack_count: done.size }, { trusted: true, keepVersion: true }));
  }
  return { audience: aud.length, acknowledged: done.size, pending, done: [...done] };
}

/** Reminders of running campaigns (the sweep): pending people, every `remind_every_days`. */
export async function remindAttestations(sys: Ctx): Promise<number> {
  const camps = await liveRows(sys.db, sys, "kb_attestation", { f: "state", op: "eq", v: "active" }, { limit: 200 });
  let sent = 0;
  for (const c of camps) {
    const every = Number(c.remind_every_days ?? 0);
    if (every <= 0) continue;
    if (c.reminded_at && Date.now() - Date.parse(c.reminded_at) < every * 86_400_000) continue;
    const aud = await audienceOf(sys.db, sys, c);
    const done = await acked(sys.db, sys, c.id);
    const pending = aud.filter((u) => !done.has(u));
    await sys.write(async (tx) => {
      if (pending.length) {
        await notifyPeople(tx, sys.org.id, { table: "kb_article", id: c.article_id, users: pending, event: "custom", label: "تأیید مطالعه", subject: `لطفاً «${String(c.title).slice(0, 120)}» را بخوانید و تأیید کنید`, body: `موعد تأیید: ${c.due_at}. از مرکز دانش، مقاله را باز کنید و «خواندم و می‌پذیرم» را بزنید.`, channels: ["in_app", "email"], source: "مدیریت دانش" });
        sent += pending.length;
      }
      await updateIn(tx, sys, "kb_attestation", c.id, { reminded_at: new Date().toISOString(), audience_count: aud.length, ack_count: done.size }, { trusted: true, keepVersion: true });
    });
  }
  return sent;
}
