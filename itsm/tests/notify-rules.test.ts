// Notification rules end to end on an in-memory server: built-in rules, the organisation's rules and conditions
// (`changes_to` against the value before the change), recipient resolution (assignee, requester, watchers, groups,
// roles, fields, mentions), the actor left out, per-recipient access (no access → nothing; hidden fields →
// «(محدود)»; internal notes only for the «internal» field group), preferences (opt-outs, mandatory rules), the inbox
// API and the delivery log.
import { describe, it, expect, beforeAll } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import type { Client } from "./helpers";
import { registerTable } from "@shared/tables";
import { tick } from "@server/jobs";
import { formatMention } from "@ui/records/model/mentions";

registerTable({
  key: "nt_ticket",
  table: "sm_nt_tickets",
  label: "تیکت آزمون",
  plural: "تیکت‌های آزمون",
  icon: "ticket",
  module: "test",
  area: "work",
  extends: "task",
  numbered: { prefix: "NTT", pad: 5 },
  display: "short_description",
  fields: [{ name: "cost_note", label: "یادداشت هزینه", type: "string", group: "financial" }],
  scope: {},
});

type Who = { client: Client; userId: string };
let e: EngineOrg;
let P = "";
let agent: Who; // legacy member: reads every «کار»
let req: Who; // requester role: only own records
let req2: Who;
let agentB: Who; // agent role: no financial field group
let admin: Who; // «مدیر»: every field group but hr and security

async function drain() {
  for (let i = 0; i < 30; i++) {
    const r = await tick(e.cfg, { budgetMs: 20_000 });
    if (!r.more && r.ran + r.failed === 0) return;
  }
}

const items = async (w: Who | Client, q = "") => (await ("client" in w ? w.client : w).get(`${P}/notify/inbox${q}`)).items as { title: string; body: string; kind: string; record_id: string; read: boolean; event: string; id: string }[];
const log = async (where: string, params: unknown[] = []) =>
  e.db.query<{ recipient_id: string; status: string; reason: string | null; channel: string; rule_key: string }>(`select recipient_id, status, reason, channel, rule_key from sm_notification_log where org_id = $1 and ${where} order by created_at`, [e.org, ...params]);

beforeAll(async () => {
  e = await engineOrg();
  P = `/o/${e.org}`;
  agent = await e.member("member", "agent@example.com");
  req = await e.member("member", "req@example.com");
  req2 = await e.member("member", "req2@example.com");
  agentB = await e.member("member", "agentb@example.com");
  admin = await e.member("admin", "admin@example.com");
  await e.owner.put(`${P}/access/members/${req.userId}`, { roles: ["requester"], persona: "requester" });
  await e.owner.put(`${P}/access/members/${req2.userId}`, { roles: ["requester"], persona: "requester" });
  await e.owner.put(`${P}/access/members/${agentB.userId}`, { roles: ["agent"], persona: "agent" });
  await drain();
});

describe("built-in rules", () => {
  it("tells the new assignee (not the person who assigned) and puts it in their inbox", async () => {
    const { row } = await e.owner.post(`${P}/r/todo`, { short_description: "چاپگر طبقهٔ دوم", caller_id: agentB.userId });
    await drain();
    await e.owner.patch(`${P}/r/todo/${row.id}`, { assigned_to: agent.userId, version: row.version });
    await drain();
    const mine = (await items(agent)).filter((x) => x.record_id === row.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ event: "assigned", kind: "direct", read: false });
    expect(mine[0].title).toContain(row.number);
    expect(mine[0].body).toContain("چاپگر طبقهٔ دوم");
    expect((await items(e.owner)).filter((x) => x.record_id === row.id)).toHaveLength(0);
    const sent = await log(`record_id = $2 and rule_key = 'builtin:assigned_to_me'`, [row.id]);
    expect(sent.map((x) => [x.recipient_id, x.channel, x.status])).toEqual([
      [agent.userId, "in_app", "sent"],
      [agent.userId, "email", "skipped"],
    ]);
    expect(sent[1].reason).toBe("no_channel");
  });

  it("does not tell people about their own change", async () => {
    const { row } = await agent.client.post(`${P}/r/todo`, { short_description: "کار خودم", assigned_to: agent.userId });
    await drain();
    expect((await items(agent)).filter((x) => x.record_id === row.id)).toHaveLength(0);
  });

  it("tells the requester when their record is resolved", async () => {
    const { row } = await req.client.post(`${P}/r/todo`, { short_description: "رمز ایمیل" });
    await drain();
    const t = await e.owner.post(`${P}/r/todo/${row.id}/transition`, { to: "resolved", data: { close_code: "solved", close_notes: "رمز بازنشانی شد" } });
    expect(t.row.state).toBe("resolved");
    await drain();
    const got = (await items(req)).filter((x) => x.record_id === row.id);
    expect(got.map((x) => x.event)).toEqual(["state_changed"]);
    expect(got[0].title).toContain("حل‌شده");
  });
});

describe("the organisation's rules", () => {
  it("are validated: table, condition, recipients, channels", async () => {
    const bad = await e.owner.post(`${P}/r/notification_rule`, { name: "بد", table_key: "nope", event: "created", recipients: { assignee: true }, channels: ["in_app"] }, 400);
    expect(bad.error.details.fields.table_key).toBeTruthy();
    const self = await e.owner.post(`${P}/r/notification_rule`, { name: "خودش", table_key: "notification", event: "created", recipients: { assignee: true }, channels: ["in_app"] }, 400);
    expect(self.error.details.fields.table_key).toMatch(/اعلان/);
    const cond = await e.owner.post(`${P}/r/notification_rule`, { name: "شرط", table_key: "todo", event: "updated", condition: { f: "nope", op: "eq", v: 1 }, recipients: { assignee: true }, channels: ["in_app"] }, 400);
    expect(cond.error.details.fields.condition).toBeTruthy();
    const none = await e.owner.post(`${P}/r/notification_rule`, { name: "بی‌گیرنده", table_key: "todo", event: "updated", recipients: {}, channels: ["in_app"] }, 400);
    expect(none.error.details.fields.recipients).toBeTruthy();
    // a requester has no access to the notification settings
    await req.client.post(`${P}/r/notification_rule`, { name: "x", table_key: "todo", event: "created", recipients: { assignee: true }, channels: ["in_app"] }, 403);
    await req.client.get(`${P}/notify/rules`, 403);
  });

  it("fire on `changes_to` only when the value changes to it", async () => {
    const rule = await e.owner.post(`${P}/r/notification_rule`, {
      name: "شروع کار",
      table_key: "todo",
      event: "updated",
      condition: { and: [{ f: "state", op: "changes_to", v: "in_progress" }, { f: "priority", op: "in", v: ["1", "2", "3"] }] },
      recipients: { users: [agentB.userId] },
      channels: ["in_app"],
    });
    expect(rule.row.recipients).toEqual({ users: [agentB.userId] });
    const { row } = await e.owner.post(`${P}/r/todo`, { short_description: "اولویت‌دار", priority: 2 });
    await drain();
    await e.owner.patch(`${P}/r/todo/${row.id}`, { priority: 3 });
    await drain();
    expect((await items(agentB)).filter((x) => x.record_id === row.id)).toHaveLength(0);
    await e.owner.post(`${P}/r/todo/${row.id}/transition`, { to: "in_progress" });
    await drain();
    const got = (await items(agentB)).filter((x) => x.record_id === row.id && x.event === "updated");
    expect(got).toHaveLength(1);
    // a later change that keeps the state does not fire again
    await e.owner.patch(`${P}/r/todo/${row.id}`, { description: "ادامه" });
    await drain();
    expect((await items(agentB)).filter((x) => x.record_id === row.id && x.event === "updated")).toHaveLength(1);
    await e.owner.del(`${P}/r/notification_rule/${rule.row.id}?version=${rule.row.version}`);
    await drain();
  });

  it("render per recipient: no access → nothing, hidden fields → «(محدود)»", async () => {
    const tpl = await e.owner.post(`${P}/r/notification_template`, {
      name: "تیکت تازه",
      subject: "تیکت تازه {{record.number}}",
      body: "هزینه: {{cost_note}}\n\nدرخواست‌کننده: {{caller_id.display}}{{#if cost_note}}\n\nهزینه دیده می‌شود{{/if}}",
    });
    await e.owner.post(`${P}/r/notification_rule`, {
      name: "تیکت‌های تازه",
      table_key: "nt_ticket",
      event: "created",
      recipients: { users: [req.userId, agentB.userId, admin.userId] },
      channels: ["in_app"],
      template_id: tpl.row.id,
    });
    await drain();
    const { row } = await e.owner.post(`${P}/r/nt_ticket`, { short_description: "خرید کابل", caller_id: req2.userId, cost_note: "۲ میلیون ریال" });
    await drain();
    // the requester may not read someone else's ticket: nothing, and the log says why
    expect((await items(req)).filter((x) => x.record_id === row.id)).toHaveLength(0);
    const skipped = await log(`record_id = $2 and recipient_id = $3`, [row.id, req.userId]);
    expect(skipped.map((x) => [x.status, x.reason])).toEqual([["skipped", "no_access"]]);
    // an agent without the financial field group sees the ticket but not the cost
    const b = (await items(agentB)).find((x) => x.record_id === row.id)!;
    expect(b.title).toBe(`تیکت تازه ${row.number}`);
    expect(b.body).toContain("هزینه: \\(محدود\\)");
    expect(b.body).not.toContain("۲ میلیون");
    expect(b.body).not.toContain("هزینه دیده می‌شود");
    expect(b.body).toContain("همکار");
    // «مدیر» carries the financial field group
    const a = (await items(admin)).find((x) => x.record_id === row.id)!;
    expect(a.body).toContain("۲ میلیون ریال");
    expect(a.body).toContain("هزینه دیده می‌شود");
    // the requester's own ticket reaches them
    const own = await e.owner.post(`${P}/r/nt_ticket`, { short_description: "تیکت خودش", caller_id: req.userId });
    await drain();
    expect((await items(req)).filter((x) => x.record_id === own.row.id)).toHaveLength(1);
  });

  it("resolve groups, roles, fields and watchers, and can include the actor", async () => {
    const g = (await e.owner.post(`${P}/r/group`, { name: "پشتیبانی شبکه" })).row.id;
    await e.owner.post(`${P}/access/groups/${g}/members`, { user_ids: [agent.userId, req2.userId] });
    await e.owner.post(`${P}/r/notification_rule`, {
      name: "همه",
      table_key: "todo",
      event: "created",
      condition: { f: "category", op: "eq", v: "meeting" },
      recipients: { groups: [g], roles: ["agent"], fields: ["requested_for"], watchers: true },
      notify_actor: true,
      channels: ["in_app"],
    });
    await drain();
    const { row } = await e.owner.post(`${P}/r/todo`, { short_description: "جلسهٔ هماهنگی", category: "meeting", requested_for: req.userId, watch_list: [admin.userId, e.ownerId] });
    await drain();
    const who = (await log(`record_id = $2 and channel = 'in_app' and status = 'sent'`, [row.id])).map((x) => x.recipient_id).sort();
    // req2 is in the group but may not read the record (a requester): skipped
    expect(who).toEqual([agent.userId, agentB.userId, req.userId, admin.userId, e.ownerId].sort());
    const kinds = Object.fromEntries((await Promise.all([agent, req, admin].map(async (w) => [w.userId, (await items(w)).find((x) => x.record_id === row.id)!.kind]))));
    expect(kinds).toEqual({ [agent.userId]: "watching", [req.userId]: "direct", [admin.userId]: "watching" });
    expect((await log(`record_id = $2 and recipient_id = $3`, [row.id, req2.userId]))[0]).toMatchObject({ status: "skipped", reason: "no_access" });
  });

  it("replace a built-in: switched off, nothing goes out", async () => {
    const off = await e.owner.post(`${P}/r/notification_rule`, { name: "ارجاع به کارشناس", builtin: "assigned_to_me", table_key: "*", event: "assigned", recipients: { assignee: true }, channels: ["in_app"], active: false });
    expect(off.row.table_key).toBe("*");
    const rules = await e.owner.get(`${P}/notify/rules`);
    const b = rules.rules.find((r: { replaces: string | null }) => r.replaces === "assigned_to_me");
    expect(b).toMatchObject({ active: false, is_builtin: false });
    expect(rules.rules.filter((r: { is_builtin: boolean }) => r.is_builtin).length).toBeGreaterThan(3);
    await drain();
    const { row } = await e.owner.post(`${P}/r/todo`, { short_description: "بی‌اعلان", assigned_to: agentB.userId });
    await drain();
    expect((await items(agentB)).filter((x) => x.record_id === row.id && x.event === "assigned")).toHaveLength(0);
    await e.owner.patch(`${P}/r/notification_rule/${off.row.id}`, { active: true, version: off.row.version });
    await drain();
  });
});

describe("comments and mentions", () => {
  it("tells the mentioned (who may read) and warns the author about those who may not", async () => {
    const { row } = await req.client.post(`${P}/r/todo`, { short_description: "دسترسی VPN" });
    await drain();
    const body = `${formatMention(agentB.userId, "کارشناس ب")} و ${formatMention(req2.userId, "درخواست‌دهندهٔ دوم")} لطفاً ببینید`;
    await e.owner.post(`${P}/r/todo/${row.id}/journal`, { body });
    await drain();
    const m = (await items(agentB)).find((x) => x.record_id === row.id && x.event === "mentioned")!;
    expect(m.kind).toBe("direct");
    expect(m.title).toContain("از شما نام برد");
    expect(m.body).toContain("**@کارشناس ب**");
    expect((await items(req2)).filter((x) => x.record_id === row.id)).toHaveLength(0);
    const warn = (await items(e.owner)).find((x) => x.record_id === row.id && x.kind === "system")!;
    expect(warn.title).toContain("باخبر نشدند");
    // the requester hears about the public comment on their record
    expect((await items(req)).filter((x) => x.record_id === row.id && x.event === "commented")).toHaveLength(1);
  });

  it("keeps internal notes from people without the «internal» field group", async () => {
    const { row } = await e.owner.post(`${P}/r/todo`, { short_description: "یادداشت داخلی", caller_id: req.userId, assigned_to: agentB.userId, watch_list: [req.userId] });
    await drain();
    await agent.client.post(`${P}/r/todo/${row.id}/journal`, { kind: "work_note", body: "احتمالاً مشکل از فایروال است" });
    await drain();
    expect((await items(agentB)).filter((x) => x.record_id === row.id && x.event === "commented")).toHaveLength(1);
    expect((await items(req)).filter((x) => x.record_id === row.id && x.event === "commented")).toHaveLength(0);
    expect((await log(`record_id = $2 and recipient_id = $3 and rule_key = 'builtin:work_note_to_team'`, [row.id, req.userId]))[0]).toMatchObject({ status: "skipped", reason: "no_access" });
  });
});

describe("preferences and the inbox", () => {
  it("honours opt-outs, except for mandatory rules", async () => {
    await agent.client.put(`${P}/notify/prefs`, { optouts: ["assigned:in_app"] });
    expect((await agent.client.get(`${P}/notify/prefs`)).prefs.optouts).toEqual(["assigned:in_app"]);
    const { row } = await e.owner.post(`${P}/r/todo`, { short_description: "خاموش", assigned_to: agent.userId });
    await drain();
    expect((await items(agent)).filter((x) => x.record_id === row.id)).toHaveLength(0);
    expect((await log(`record_id = $2 and recipient_id = $3 and channel = 'in_app'`, [row.id, agent.userId]))[0]).toMatchObject({ status: "skipped", reason: "opted_out" });
    await e.owner.post(`${P}/r/notification_rule`, { name: "اجباری", table_key: "todo", event: "assigned", mandatory: true, recipients: { assignee: true }, channels: ["in_app"] });
    await drain();
    const two = await e.owner.post(`${P}/r/todo`, { short_description: "اجباری", assigned_to: agent.userId });
    await drain();
    expect((await items(agent)).filter((x) => x.record_id === two.row.id)).toHaveLength(1);
    await agent.client.put(`${P}/notify/prefs`, { optouts: [] });
    await agent.client.put(`${P}/notify/prefs`, { quiet_from: "25:00", quiet_to: "07:00" }, 400);
  });

  it("counts, filters and marks items read (one or all)", async () => {
    const before = (await agent.client.get(`${P}/notify/inbox/count`)).unread as number;
    expect(before).toBeGreaterThan(1);
    const list = await agent.client.get(`${P}/notify/inbox?unread=1&limit=2`);
    expect(list.items).toHaveLength(2);
    expect(list.more).toBe(true);
    const next = await agent.client.get(`${P}/notify/inbox?unread=1&limit=2&before=${encodeURIComponent(list.items[1].created_at)}`);
    expect(next.items[0].id).not.toBe(list.items[0].id);
    const r = await agent.client.post(`${P}/notify/inbox/read`, { ids: [list.items[0].id] });
    expect(r.unread).toBe(before - 1);
    // someone else's item cannot be marked (or seen)
    const other = (await items(agentB))[0];
    await agent.client.post(`${P}/notify/inbox/read`, { ids: [other.id] });
    expect((await items(agentB)).find((x) => x.id === other.id)!.read).toBe(false);
    await agent.client.get(`${P}/r/notification/${other.id}`, 404);
    const all = await agent.client.post(`${P}/notify/inbox/read`, { all: true });
    expect(all.unread).toBe(0);
    expect((await items(agent)).every((x) => x.read)).toBe(true);
    // something new after «همه را خواندم» is unread again
    const { row } = await e.owner.post(`${P}/r/todo`, { short_description: "تازه‌تر", assigned_to: agent.userId });
    await drain();
    expect((await agent.client.get(`${P}/notify/inbox/count`)).unread).toBeGreaterThanOrEqual(1);
    expect((await items(agent, "?unread=1")).some((x) => x.record_id === row.id)).toBe(true);
  });

  it("snoozes items: hidden and not counted until their time, then back unread at the top", async () => {
    const { row } = await e.owner.post(`${P}/r/todo`, { short_description: "بعداً یادآوری کن", assigned_to: agent.userId });
    await drain();
    const item = (await items(agent)).find((x) => x.record_id === row.id)!;
    const before = (await agent.client.get(`${P}/notify/inbox/count`)).unread as number;
    const r = await agent.client.post(`${P}/notify/inbox/snooze`, { ids: [item.id], minutes: 60 });
    expect(r).toMatchObject({ changed: 1, unread: before - 1 });
    expect((await items(agent)).some((x) => x.id === item.id)).toBe(false);
    expect((await items(agent, "?snoozed=1")).map((x) => x.id)).toEqual([item.id]);
    // nobody else can snooze it; a time in the past or beyond a month is refused
    expect((await agentB.client.post(`${P}/notify/inbox/snooze`, { ids: [item.id], minutes: 5 })).changed).toBe(0);
    await agent.client.post(`${P}/notify/inbox/snooze`, { ids: [item.id], until: new Date(Date.now() - 60_000).toISOString() }, 400);
    await agent.client.post(`${P}/notify/inbox/snooze`, { ids: [item.id], minutes: 31 * 24 * 60 }, 400);
    // «همه را خواندم» while it waits, then its time comes: back unread, at the top
    await agent.client.post(`${P}/notify/inbox/read`, { all: true });
    await e.db.query(`update sm_notifications set snoozed_until = clock_timestamp() where id = $1`, [item.id]);
    const back = await items(agent);
    expect(back[0]).toMatchObject({ id: item.id, read: false });
    expect((await agent.client.get(`${P}/notify/inbox/count`)).unread).toBe(1);
    // «بازگرداندن اکنون» ends a snooze at once
    await agent.client.post(`${P}/notify/inbox/snooze`, { ids: [item.id], minutes: 30 });
    expect((await agent.client.get(`${P}/notify/inbox/count`)).unread).toBe(0);
    expect((await agent.client.post(`${P}/notify/inbox/snooze`, { ids: [item.id], until: null })).changed).toBe(1);
    expect((await items(agent))[0]).toMatchObject({ id: item.id, read: false });
    await agent.client.post(`${P}/notify/inbox/read`, { ids: [item.id] });
  });

  it("shows the delivery log to people with notification settings, without subjects of records they may not read", async () => {
    const r = await e.owner.get(`${P}/notify/log?limit=200`);
    expect(r.entries.length).toBeGreaterThan(5);
    expect(r.entries.some((x: { status: string; reason_label: string | null }) => x.status === "skipped" && x.reason_label)).toBe(true);
    await agent.client.get(`${P}/notify/log`, 403);
  });
});
