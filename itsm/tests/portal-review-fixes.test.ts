// Review fixes of the self-service portal (each case failed before its fix):
//   · what survey invitations and responses copy from a record (title, number, person, comment) shows only to readers
//     of that record; the record page's survey panel answers only them
//   · anonymous surveys: no group on the invitation or the response, the answer's day only, the answers held and
//     written in shuffled batches (nothing ties a response to the invitation answered)
//   · survey answers never arrive from a Windows app push; a linked Windows app answers on the web version
//   · one response per invitation (row lock and unique index)
//   · the ticket's outage banner follows the announcement's audience and window and the parent incident
//   · a manager's or watcher's portal reply is neither the desk's first response nor a staff reply; a desk agent's
//     comment is, even through a request's context that has read nothing yet (its access loads on the spot)
//   · quick links and topics follow their audience in the record API; a workspace's portal is its members'; the draft
//     layout is for those who run the portal
//   · messenger webhooks are limited per key, not per client address (wrong keys are, per client)
//   · approval and ticket facts are Jalali dates in the organisation's zone
//   · the shell's command palette does not open above the portal
import { beforeAll, describe, expect, it } from "vitest";
import { portalWorld, statusOf, type PortalWorld } from "./portal-helpers";
import type { Client } from "./helpers";
import { addJournalIn, createIn, transitionIn, updateIn } from "@server/engine";
import { memberCtx } from "@server/access";
import { makeCtx } from "@server/context";
import { releaseHeldAnswers, submitSurvey, ANONYMOUS_BATCH } from "@server/modules/portal";
import { registerCloudLink } from "@server/modules/ai/relay";
import { resetRateLimits } from "@server/http/ratelimit";
import { tableDef } from "@shared/tables";
import { SYNC_PROTOCOL } from "@shared/constants";
import { uuidv7 } from "@shared/id";
import { togglesPalette } from "@ui/components/shell/context";

let w: PortalWorld;
let csat: Record<string, any>;

const rows = async (c: Client, table: string) => (await c.get(`${w.P}/r/${table}?size=200`)).rows as any[];
const stored = async (table: string, id: string) => (await w.e.db.one<Record<string, any>>(`select * from ${tableDef(table)!.table} where id = $1`, [id]))!;
const JALALI_TIME = /^[۰-۹]{4}\/[۰-۹]{2}\/[۰-۹]{2} [۰-۹]{2}:[۰-۹]{2}$/;

/** Resolve an incident as the system (the trigger invites its requester) and return the requester's invitation. */
async function resolveAndInvite(inc: Record<string, any>, as: Client, patch: Record<string, unknown> = {}): Promise<string> {
  await w.sys.write(async (tx) => {
    if (Object.keys(patch).length) await updateIn(tx, w.sys, "incident", inc.id, patch, { trusted: true });
    await transitionIn(tx, w.sys, "incident", inc.id, "resolved", { close_code: "solved", close_notes: "حل شد" });
  });
  await w.drain();
  const todo = await as.get(`${w.P}/portal/todo`);
  const all = todo.surveys as any[];
  const inv = all.find((s) => String(s.title).includes(String(inc.number))) ?? all[0];
  expect(inv).toBeTruthy();
  return String(inv.id);
}

async function answers(as: Client, invitation: string, stars: number, comment: string): Promise<Record<string, unknown>> {
  const view = await as.get(`${w.P}/portal/surveys/${invitation}`);
  const rating = view.questions.find((q: { metric: string }) => q.metric === "csat");
  const text = view.questions.find((q: { kind: string }) => q.kind === "text");
  return { [rating.id]: stars, ...(text ? { [text.id]: comment } : {}) };
}

beforeAll(async () => {
  w = await portalWorld();
  csat = (await rows(w.o, "survey")).find((s) => s.name === "رضایت از رسیدگی");
}, 180_000);

describe("surveys", () => {
  it("show what they copy from a record only to readers of that record", async () => {
    const TOKEN = "shekayatZ5";
    // a survey after complaints are answered; a complaint is confidential (the feedback group and the submitter)
    await w.p.sdm.client.post(`${w.P}/r/survey_trigger`, { name: "پس از پاسخ بازخورد", survey_id: csat.id, table_key: "portal_feedback", fire_on: "resolved", sample_pct: 100, cooldown_days: 0, active: true });
    const fb = (await w.p.req.client.post(`${w.P}/r/portal_feedback`, { kind: "complaint", short_description: `رفتار نامناسب ${TOKEN}`, description: "شرح شکایت", caller_id: w.p.req.userId, requested_for: w.p.req.userId, channel: "portal" })).row;
    expect(fb.confidential).toBe(true);
    await w.sys.write((tx) => transitionIn(tx, w.sys, "portal_feedback", fb.id, "responded", { response: "پیگیری شد" }));
    await w.drain();
    const todo = await w.p.req.client.get(`${w.P}/portal/todo`);
    const invitation = String((todo.surveys as any[]).find((x) => String(x.title).includes(TOKEN))!.id);
    // the invitee reads their own invitation in full
    expect((await w.p.req.client.get(`${w.P}/r/survey_invitation/${invitation}`)).row.title).toContain(TOKEN);
    await w.p.req.client.post(`${w.P}/portal/surveys/${invitation}`, { answers: await answers(w.p.req.client, invitation, 2, `نظر ${TOKEN}`) });
    // the survey manager, who may not read the complaint, sees the scores only
    await w.p.sdm.client.get(`${w.P}/r/portal_feedback/${fb.id}`, 404);
    const inv = (await rows(w.p.sdm.client, "survey_invitation")).find((r) => r.id === invitation);
    expect(inv).toBeTruthy();
    expect(JSON.stringify(inv)).not.toContain(TOKEN);
    expect(inv.record_number ?? null).toBeNull();
    expect(inv.user_id ?? null).toBeNull();
    const resp = (await rows(w.p.sdm.client, "survey_response")).filter((r) => r.survey_id === csat.id);
    expect(resp.length).toBeGreaterThan(0);
    expect(JSON.stringify(resp)).not.toContain(TOKEN);
    expect(JSON.stringify(resp)).not.toContain(String(fb.number));
    expect(resp.some((r) => r.respondent_id === w.p.req.userId)).toBe(false);
    const results = await w.p.sdm.client.get(`${w.P}/portal/survey-results?days=30`);
    expect(JSON.stringify(results.comments)).not.toContain(TOKEN);
    // the record page's «نظرسنجی» panel: nothing of a record the caller may not open, the answer for its readers
    expect((await w.p.sdm.client.get(`${w.P}/portal/record-surveys/portal_feedback/${fb.id}`)).responses).toEqual([]);
    const panel = (await w.p.req.client.get(`${w.P}/portal/record-surveys/portal_feedback/${fb.id}`)).responses as any[];
    expect(panel.some((r) => String(r.comment ?? "").includes(TOKEN))).toBe(true);
  });

  it("keep anonymous answers apart from their invitations", async () => {
    await w.p.sdm.client.patch(`${w.P}/r/survey/${csat.id}`, { anonymous: true, version: (await w.p.sdm.client.get(`${w.P}/r/survey/${csat.id}`)).row.version });
    const inc = await w.incident(w.p.req2.client, { short_description: "پرینتر کاغذ گیر می‌کند" });
    const invitation = await resolveAndInvite(inc, w.p.req2.client, { assignment_group_id: w.g.desk });
    await w.p.req2.client.post(`${w.P}/portal/surveys/${invitation}`, { answers: await answers(w.p.req2.client, invitation, 1, "بی‌نام ولی ناراضی") });
    // the rated group's agents do not list who was asked or answered; the invitation keeps the day only
    expect((await rows(w.p.agent.client, "survey_invitation")).some((r) => r.id === invitation)).toBe(false);
    const inv = await stored("survey_invitation", invitation);
    expect(inv.group_id).toBeNull();
    expect(new Date(inv.answered_at).toISOString()).toMatch(/T00:00:00\.000Z$/);
    // the answer is held until enough wait: no response yet, for anyone
    expect((await rows(w.p.sdm.client, "survey_response")).some((r) => r.comment === "بی‌نام ولی ناراضی")).toBe(false);
    const held = await w.e.db.query<{ payload: any }>(`select payload from sm_survey_held where org_id = $1 and survey_id = $2`, [w.e.org, csat.id]);
    expect(held.length).toBe(1);
    // more answers arrive (set-up): the batch is written shuffled, stamped with the day, with no person, group or record
    for (let i = 1; i < ANONYMOUS_BATCH; i++) {
      await w.e.db.query(`insert into sm_survey_held (id, org_id, survey_id, payload) values ($1, $2, $3, $4::jsonb)`, [uuidv7(), w.e.org, csat.id, JSON.stringify({ title: csat.name, survey_id: csat.id, answers: {}, csat: 5, satisfied: true, score: 100, comment: null, channel: "portal" })]);
    }
    expect(await releaseHeldAnswers(w.sys, csat.id)).toBe(ANONYMOUS_BATCH);
    const out = await w.e.db.query<Record<string, any>>(`select * from sm_survey_responses where org_id = $1 and survey_id = $2 and invitation_id is null and respondent_id is null and deleted_at is null`, [w.e.org, csat.id]);
    expect(out.length).toBe(ANONYMOUS_BATCH);
    for (const r of out) {
      expect(r.group_id ?? null).toBeNull();
      expect(r.record_number ?? null).toBeNull();
      expect(new Date(r.submitted_at).toISOString()).toMatch(/T00:00:00\.000Z$/);
    }
    expect((await w.e.db.query(`select 1 from sm_survey_held where org_id = $1`, [w.e.org])).length).toBe(0);
    await w.p.sdm.client.patch(`${w.P}/r/survey/${csat.id}`, { anonymous: false, version: (await w.p.sdm.client.get(`${w.P}/r/survey/${csat.id}`)).row.version });
  });

  it("take one answer per invitation, never a pushed one, and none on a Windows app linked to the web version", async () => {
    const inc = await w.incident(w.p.other.client, { short_description: "ورود به سامانه کند است" });
    const invitation = await resolveAndInvite(inc, w.p.other.client, { assignment_group_id: w.g.desk });
    const body = { answers: await answers(w.p.other.client, invitation, 4, "خوب") };
    // a linked Windows app sends the person to the web version
    const ctx = await memberCtx(w.e.cfg, w.e.org, w.p.other.userId);
    registerCloudLink(w.e.cfg.db, () => ({ url: "https://itsm.example", token: "t", org_id: w.e.org }));
    await expect(submitSurvey({ ...ctx, cfg: { ...ctx.cfg, mode: "desktop" } }, invitation, body.answers)).rejects.toMatchObject({ status: 400 });
    // two answers at once: one is stored, the other refused
    const both = await Promise.all([0, 1].map(() => statusOf(w.p.other.client, "POST", `${w.P}/portal/surveys/${invitation}`, body)));
    expect(both.sort()).toEqual([200, 409]);
    const mine = await w.e.db.query<{ id: string }>(`select id from sm_survey_responses where org_id = $1 and invitation_id = $2 and deleted_at is null`, [w.e.org, invitation]);
    expect(mine.length).toBe(1);
    // one response per invitation is also the database's rule
    await expect(w.e.db.query(`insert into sm_survey_responses (id, org_id, survey_id, invitation_id) values ($1, $2, $3, $4)`, [uuidv7(), w.e.org, csat.id, invitation])).rejects.toThrow();
    // a Windows push of an answer (here a forged one: no invitation, the desk's group, a colleague's record) is refused
    const forged = uuidv7();
    const now = new Date().toISOString();
    const res = await w.p.req.client.post(`/sync/push`, {
      org_id: w.e.org, device_id: uuidv7(), protocol: SYNC_PROTOCOL,
      aggregates: [{ entity: "survey_response", id: forged, base_rev: 0, row: { id: forged, org_id: w.e.org, survey_id: csat.id, respondent_id: w.p.req.userId, invitation_id: null, group_id: w.g.desk, csat: 1, satisfied: false, score: 0, table_key: "incident", record_id: inc.id, comment: "fake", submitted_at: now, updated_at: now } }],
    });
    expect(res.results[0].status).not.toBe("ok");
    expect(await w.e.db.one(`select 1 from sm_survey_responses where id = $1`, [forged])).toBeFalsy();
  });
});

describe("the ticket page", () => {
  it("shows an outage banner only within its audience and window, and for the incidents under a major one", async () => {
    const inc = await w.incident(w.p.req.client, { short_description: "ایمیل نمی‌رسد" });
    const pub = async (data: Record<string, unknown>) =>
      w.sys.write(async (tx) => {
        const a = await createIn(tx, w.sys, "announcement", { kind: "outage", body: "در حال بررسی", ...data }, { trusted: true });
        await transitionIn(tx, w.sys, "announcement", String(a.id), "published");
      });
    await pub({ title: "نفوذ باج‌افزار به سرور ایمیل", incident_id: inc.id, audience: "agents" });
    await pub({ title: "قطعی آینده", incident_id: inc.id, starts_at: new Date(Date.now() + 86_400_000).toISOString() });
    expect((await w.p.req.client.get(`${w.P}/portal/tickets/incident/${inc.id}`)).outage).toBeNull();
    // an incident under a major one gets the major one's banner
    const major = await w.incident(w.p.req2.client, { short_description: "قطعی گستردهٔ ایمیل" });
    await w.sys.write((tx) => updateIn(tx, w.sys, "incident", inc.id, { parent_id: major.id }, { trusted: true }));
    await pub({ title: "اختلال گستردهٔ ایمیل", incident_id: major.id });
    expect((await w.p.req.client.get(`${w.P}/portal/tickets/incident/${inc.id}`)).outage).toMatchObject({ title: "اختلال گستردهٔ ایمیل" });
  });

  it("does not count a manager's reply as the desk's first response, nor show it as staff", async () => {
    const inc = await w.incident(w.p.req.client, { short_description: "وی‌پی‌ان وصل نمی‌شود" });
    await w.sys.write((tx) => updateIn(tx, w.sys, "incident", inc.id, { assignment_group_id: w.g.desk }, { trusted: true }));
    await w.p.mgr.client.post(`${w.P}/portal/tickets/incident/${inc.id}/reply`, { body: "لطفاً سریع‌تر پیگیری کنید" });
    expect((await stored("incident", inc.id)).first_response_at).toBeNull();
    let t = await w.p.req.client.get(`${w.P}/portal/tickets/incident/${inc.id}`);
    expect(t.timeline.find((e: any) => e.body === "لطفاً سریع‌تر پیگیری کنید").staff).toBe(false);
    await w.p.agent.client.post(`${w.P}/r/incident/${inc.id}/journal`, { kind: "comment", body: "در حال بررسی هستیم" });
    expect((await stored("incident", inc.id)).first_response_at).toBeTruthy();
    t = await w.p.req.client.get(`${w.P}/portal/tickets/incident/${inc.id}`);
    expect(t.timeline.find((e: any) => e.body === "در حال بررسی هستیم").staff).toBe(true);
  });

  it("weighs a desk agent's first response even through a request's context that has read nothing yet", async () => {
    const inc = await w.incident(w.p.req.client, { short_description: "چاپگر طبقهٔ دوم چاپ نمی‌کند" });
    await w.sys.write((tx) => updateIn(tx, w.sys, "incident", inc.id, { assignment_group_id: w.g.desk }, { trusted: true }));
    // a request's context as the HTTP layer makes it: its access subject loads with its first engine call
    const q = w.e.db;
    const [user, org, member] = await Promise.all([
      q.one<any>(`select id, email, full_name, mobile, is_platform_admin, disabled, prefs from sm_users where id = $1`, [w.p.agent.userId]),
      q.one<any>(`select * from sm_orgs where id = $1`, [w.e.org]),
      q.one<any>(`select id, org_id, user_id, role, overrides, is_active from sm_org_members where org_id = $1 and user_id = $2 and deleted_at is null`, [w.e.org, w.p.agent.userId]),
    ]);
    const fresh = makeCtx(w.e.cfg, user, org, member);
    const row = await stored("incident", inc.id);
    await fresh.write((tx) => addJournalIn(tx, fresh, tableDef("incident")!, row, { kind: "comment", body: "چاپگر را بررسی می‌کنیم" }));
    expect((await stored("incident", inc.id)).first_response_at).toBeTruthy();
  });

  it("shows dates of facts in Jalali, in the organisation's time zone", async () => {
    const inc = await w.incident(w.p.req.client, { short_description: "نمایشگر سوسو می‌زند" });
    await w.sys.write((tx) => updateIn(tx, w.sys, "incident", inc.id, { due_at: "2026-11-10T08:30:00.000Z" }, { trusted: true }));
    const t = await w.p.req.client.get(`${w.P}/portal/tickets/incident/${inc.id}`);
    const due = t.facts.find((f: { label: string }) => f.label === "موعد");
    expect(due.value).toMatch(JALALI_TIME);
    expect(due.value).toBe("۱۴۰۵/۰۸/۱۹ ۱۲:۰۰");
    const item = (await w.o.get(`${w.P}/r/catalog_item?filter=${encodeURIComponent(JSON.stringify({ f: "code", op: "eq", v: "software_install" }))}`)).rows[0];
    const order = await w.p.req.client.post(`${w.P}/request/order`, { lines: [{ item_id: item.id, answers: { software: "office", computer_name: "PC-77" } }], channel: "portal" });
    await w.drain();
    const a = ((await w.p.mgr.client.get(`${w.P}/portal/todo`)).approvals as any[]).find((x) => x.record_id === order.items[0].id);
    const detail = await w.p.mgr.client.get(`${w.P}/portal/approvals/${a.id}`);
    const opened = detail.facts.find((f: { label: string }) => f.label === "زمان ثبت");
    expect(opened.value).toMatch(JALALI_TIME);
  });
});

describe("portal content in the record API", () => {
  it("holds quick links to their audience, portals to their workspace and the draft layout to its administrators", async () => {
    await w.p.sdm.client.post(`${w.P}/r/portal_link`, { name: "سامانهٔ فروش", url: "https://sales.example.com", aud_units: [w.units.sales] });
    expect((await rows(w.p.req.client, "portal_link")).some((l) => l.name === "سامانهٔ فروش")).toBe(false);
    expect((await rows(w.p.other.client, "portal_link")).some((l) => l.name === "سامانهٔ فروش")).toBe(true);
    expect((await rows(w.p.sdm.client, "portal_link")).some((l) => l.name === "سامانهٔ فروش")).toBe(true);
    await w.p.sdm.client.post(`${w.P}/r/portal_topic`, { name: "فروش و بازاریابی", aud_units: [w.units.sales] });
    expect((await rows(w.p.req.client, "portal_topic")).some((l) => l.name === "فروش و بازاریابی")).toBe(false);
    // the draft layout is the administrators'
    const portal = (await rows(w.o, "portal"))[0];
    await w.p.sdm.client.patch(`${w.P}/r/portal/${portal.id}`, { layout: [{ type: "search" }, { type: "text", text: "پیش‌نویس محرمانه" }] });
    const mine = (await rows(w.p.req.client, "portal")).find((p) => p.id === portal.id);
    expect(mine?.layout ?? null).toBeNull();
    expect((await w.p.sdm.client.get(`${w.P}/r/portal/${portal.id}`)).row.layout).toBeTruthy();
    // a workspace's portal is its members'
    const ws = (await w.o.post(`${w.P}/r/workspace`, { name: "منابع انسانی", key: "hr_ws" })).row.id as string;
    const hr = (await w.o.post(`${w.P}/r/portal`, { name: "درگاه منابع انسانی", workspace_id: ws })).row;
    expect(hr.workspace_id).toBe(ws);
    expect((await rows(w.p.req.client, "portal")).some((p) => p.id === hr.id)).toBe(false);
  });
});

describe("messenger webhooks", () => {
  it("limit deliveries per webhook key, not per client address; wrong keys per client", async () => {
    resetRateLimits();
    const ch = await w.o.post(`${w.P}/r/portal_channel`, { name: "ربات", kind: "telegram", token: "123:abc", bot_username: "org_bot", auth_mode: "header" });
    const s = await w.o.post(`${w.P}/portal/channels/${ch.row.id}/secret`, {});
    const key = String(s.webhook_url).split("/").pop()!;
    const send = (k: string, n: number, secret: string | null) =>
      w.e.app.fetch(new Request(`http://local.test/api/public/portal/hooks/${k}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(secret ? { "x-telegram-bot-api-secret-token": secret } : {}) },
        body: JSON.stringify({ update_id: 9000 + n, message: { message_id: n, date: 1, text: "سلام", chat: { id: 700 + n, type: "private" }, from: { id: 700 + n, first_name: "علی" } } }),
      }));
    const good: number[] = [];
    for (let i = 0; i < 130; i++) good.push((await send(key, i, s.secret)).status);
    expect(good.filter((x) => x === 429)).toEqual([]);
    const bad: number[] = [];
    for (let i = 0; i < 125; i++) bad.push((await send("x".repeat(24), 500 + i, null)).status);
    expect(bad.at(-1)).toBe(429);
  });
});

describe("the shell", () => {
  it("does not open the command palette while the portal covers it", () => {
    const ctrlK = { ctrlKey: true, metaKey: false, altKey: false, code: "KeyK", key: "k" };
    expect(togglesPalette(ctrlK, false)).toBe(true);
    expect(togglesPalette({ ...ctrlK, code: "KeyX", key: "ن" }, false)).toBe(true);
    expect(togglesPalette(ctrlK, true)).toBe(false);
  });
});
