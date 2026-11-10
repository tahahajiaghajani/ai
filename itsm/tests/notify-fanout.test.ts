// Notification fan-out at scale (docs/spec/services/notify.md §6, PERFORMANCE_FA.md «دور دوم»): one rule's notification
// to a group is ONE `notify.batch` job whose bell rows are written by one insert in one short transaction, with no
// record event per bell; the e-mail/SMS deliveries are inserted with one statement too. Still per recipient: access
// (no access → nothing), preferences (opt-outs; quiet hours hold the e-mail). Large groups (more than 50 members under
// «خودکار») tell their leads and manager instead of every member; the group and the rule can say otherwise.
import { describe, it, expect, beforeAll } from "vitest";
import { engineOrg, outbox, type EngineOrg } from "./engine-helpers";
import type { Client } from "./helpers";
import { registerTable } from "@shared/tables";
import { groupAudience, LARGE_GROUP } from "@shared/notify";
import { tick } from "@server/jobs";
import { notifyPeople } from "@server/modules/notify";
import type { Tx } from "@server/db";

registerTable({
  key: "nf_ticket",
  table: "sm_nf_tickets",
  label: "تیکت پخش",
  plural: "تیکت‌های پخش",
  icon: "ticket",
  module: "test",
  area: "work",
  extends: "task",
  numbered: { prefix: "NFT", pad: 5 },
  display: "short_description",
  fields: [],
  scope: {},
});

type Who = { client: Client; userId: string };
let e: EngineOrg;
let P = "";
let a1: Who; // legacy member: reads every «کار»
let a2: Who;
let req: Who; // requester role: only own records
let small = ""; // a small group: a1, a2, req
let n = 0;

/** The statements of every transaction that runs while `fn` does, in order (the database layer's `tx`). */
async function transactions(fn: () => Promise<void>): Promise<string[][]> {
  const out: string[][] = [];
  const db = e.db as { tx: (f: (tx: Tx) => Promise<unknown>) => Promise<unknown> };
  const orig = db.tx.bind(e.db);
  db.tx = (f) =>
    orig((tx: Tx) => {
      const seen: string[] = [];
      out.push(seen);
      const watch = <T extends (...a: any[]) => any>(g: T) => ((text: string, ...rest: unknown[]) => {
        seen.push(text.replace(/\s+/g, " ").trim());
        return g(text, ...rest);
      }) as unknown as T;
      return f({ ...tx, query: watch(tx.query.bind(tx)), one: watch(tx.one.bind(tx)) });
    });
  try {
    await fn();
  } finally {
    db.tx = orig;
  }
  return out;
}
const isBellInsert = (q: string) => /^insert into sm_notifications\b/i.test(q);
const isLock = (q: string) => /^insert into sm_org_sync\b/i.test(q);

async function drain() {
  for (let i = 0; i < 40; i++) {
    const r = await tick(e.cfg, { budgetMs: 20_000 });
    if (!r.more && r.ran + r.failed === 0) return;
  }
}

const bells = (record: string) =>
  e.db.query<{ user_id: string; kind: string; event: string; title: string }>(`select user_id, kind, event, title from sm_notifications where org_id = $1 and record_id = $2 and deleted_at is null order by user_id`, [e.org, record]);
const log = (record: string, channel = "in_app") =>
  e.db.query<{ recipient_id: string; status: string; reason: string | null }>(`select recipient_id, status, reason from sm_notification_log where org_id = $1 and record_id = $2 and channel = $3 order by recipient_id`, [e.org, record, channel]);

/** Members created through the API (no sign-in), their user ids. */
async function people(count: number): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const email = `fan${++n}@example.com`;
    await e.owner.post(`${P}/members`, { email, full_name: `عضو ${n}`, role: "member" });
    out.push((await e.db.one<{ id: string }>(`select id from sm_users where lower(email) = $1`, [email]))!.id);
  }
  return out;
}

async function group(name: string, members: string[], extra: Record<string, unknown> = {}, leads: string[] = []): Promise<string> {
  const g = (await e.owner.post(`${P}/r/group`, { name, ...extra })).row.id as string;
  for (let i = 0; i < members.length; i += 200) await e.owner.post(`${P}/access/groups/${g}/members`, { user_ids: members.slice(i, i + 200) });
  if (leads.length) await e.owner.post(`${P}/access/groups/${g}/members`, { user_ids: leads, kind: "lead" });
  return g;
}

/** A new ticket (its own notifications delivered). */
async function ticket(title: string): Promise<{ id: string; version: number }> {
  const { row } = await e.owner.post(`${P}/r/nf_ticket`, { short_description: title });
  await drain();
  return row;
}

/** A ticket assigned to `g` with nobody assigned (the built-in «ارجاع به گروه»), its notifications delivered. */
async function assignToGroup(g: string, title = "قطعی شبکهٔ شعبه", row?: { id: string; version: number }): Promise<string> {
  const t = row ?? (await ticket(title));
  await e.owner.patch(`${P}/r/nf_ticket/${t.id}`, { assignment_group_id: g, version: t.version });
  await drain();
  return t.id;
}

beforeAll(async () => {
  e = await engineOrg();
  P = `/o/${e.org}`;
  a1 = await e.member("member", "fan-a1@example.com");
  a2 = await e.member("member", "fan-a2@example.com");
  req = await e.member("member", "fan-req@example.com");
  await e.owner.put(`${P}/access/members/${req.userId}`, { roles: ["requester"], persona: "requester" });
  small = await group("پشتیبانی شبکه", [a1.userId, a2.userId, req.userId]);
  await drain();
}, 120_000);

describe("one notification, set-based", () => {
  it("writes every member's bell with one insert and no record event per bell; whoever may not read gets nothing", async () => {
    const t = await ticket("قطعی شبکهٔ شعبه");
    let id = "";
    const txs = await transactions(async () => {
      id = await assignToGroup(small, "", t);
    });
    // one statement for the group's bells (the assignment raises one notification: the built-in «ارجاع به گروه»)
    expect(txs.flat().filter(isBellInsert)).toHaveLength(1);
    // the organisation's write lock is taken last in that transaction, right before the bell insert: the log rows,
    // the deliveries, the progress and the rows' preparation ran without it
    const batch = txs.find((x) => x.some(isBellInsert))!;
    const lock = batch.findIndex(isLock);
    expect(lock).toBeGreaterThan(batch.findIndex((q) => /^insert into sm_notification_log\b/i.test(q)));
    expect(lock).toBeGreaterThan(batch.findIndex((q) => /^update sm_jobs set payload\b/i.test(q)));
    expect(batch.slice(lock + 1).filter((q) => !/^(select|insert into sm_notifications)\b/i.test(q))).toEqual([]);
    expect(batch.indexOf(batch.find(isBellInsert)!)).toBe(lock + 1);
    expect((await bells(id)).map((b) => b.user_id).sort()).toEqual([a1.userId, a2.userId].sort());
    expect((await bells(id)).every((b) => b.event === "assigned")).toBe(true);
    // the requester is in the group but may not read the ticket: nothing, logged as no access
    expect((await log(id)).find((x) => x.recipient_id === req.userId)).toMatchObject({ status: "skipped", reason: "no_access" });
    expect((await log(id)).filter((x) => x.status === "sent")).toHaveLength(2);
    // the rule's deliveries are one job for everyone, and the bells raise no record events
    const batches = (await outbox(e.db, e.org, "notify.batch")).filter((j) => j.payload.ev?.id === id);
    expect(batches).toHaveLength(1);
    expect(batches[0].payload.people).toHaveLength(3);
    expect((await outbox(e.db, e.org, "notify.send")).filter((j) => j.payload.ev?.id === id)).toHaveLength(0);
    expect((await outbox(e.db, e.org, "record.created")).filter((j) => j.payload.table === "notification")).toHaveLength(0);
    // the inbox reads them as usual
    const inbox = (await a1.client.get(`${P}/notify/inbox`)).items as { record_id: string }[];
    expect(inbox.filter((x) => x.record_id === id)).toHaveLength(1);
  });

  it("never writes a bell twice when the batch runs again (its progress commits with the bells)", async () => {
    const id = await assignToGroup(small, "تکرار دسته");
    const before = (await bells(id)).length;
    await e.db.query(`update sm_jobs set status = 'queued', run_at = now(), done_at = null where org_id = $1 and kind = 'notify.batch' and payload->'ev'->>'id' = $2`, [e.org, id]);
    await drain();
    expect((await bells(id)).length).toBe(before);
  });

  it("honours preferences per person: an opted-out bell is skipped, quiet hours hold the e-mail", async () => {
    await a1.client.put(`${P}/notify/prefs`, { optouts: ["assigned:in_app"] });
    await a2.client.put(`${P}/notify/prefs`, { quiet_from: "00:00", quiet_to: "23:59" });
    const rule = (await e.owner.post(`${P}/r/notification_rule`, {
      name: "ارجاع به گروه با ایمیل", table_key: "nf_ticket", event: "assigned", recipients: { assignment_group: true }, channels: ["in_app", "email"],
      condition: { f: "assignment_group_id", op: "changed" },
    })).row.id as string;
    await drain();
    const id = await assignToGroup(small, "ترجیح‌ها");
    const mine = (await bells(id)).map((b) => b.user_id);
    // a1 switched the bell off for assignments (both rules); a2 still gets both bells
    expect(mine.filter((u) => u === a1.userId)).toHaveLength(0);
    expect(mine.filter((u) => u === a2.userId)).toHaveLength(2);
    expect((await log(id)).filter((x) => x.recipient_id === a1.userId).every((x) => x.status === "skipped" && x.reason === "opted_out")).toBe(true);
    // the e-mails are per-person delivery jobs (inserted together): a2's is held for quiet hours
    const sends = (await outbox(e.db, e.org, "notify.send")).filter((j) => j.payload.ev?.id === id);
    expect(sends.map((j) => j.payload.user).sort()).toEqual([a1.userId, a2.userId].sort());
    expect(sends.every((j) => JSON.stringify(j.payload.rule.channels) === '["email"]')).toBe(true);
    expect((await log(id, "email")).find((x) => x.recipient_id === a2.userId)).toMatchObject({ status: "held", reason: "quiet" });
    await e.owner.del(`${P}/r/notification_rule/${rule}`);
    await a1.client.put(`${P}/notify/prefs`, { optouts: [] });
    await a2.client.put(`${P}/notify/prefs`, { quiet_from: null, quiet_to: null });
    await drain();
  });

  it("queues a service's notification to named people as one batch (notifyPeople)", async () => {
    const { row } = await e.owner.post(`${P}/r/nf_ticket`, { short_description: "اعلان مستقیم" });
    await drain();
    await e.db.tx((tx) => notifyPeople(tx, e.org, { table: "nf_ticket", id: row.id, users: [a1.userId, a2.userId, req.userId], subject: "{{record.display}}", source: "آزمون" }));
    const queued = (await outbox(e.db, e.org, "notify.batch")).filter((j) => j.payload.ev?.id === row.id);
    expect(queued).toHaveLength(1);
    await drain();
    expect((await bells(row.id)).map((b) => b.user_id).sort()).toEqual([a1.userId, a2.userId].sort());
  });
});

describe("large groups", () => {
  let crowd: string[] = [];
  let lead = "";
  let manager = "";

  beforeAll(async () => {
    crowd = await people(LARGE_GROUP + 1);
    [lead, manager] = await people(2);
  }, 120_000);

  it("decides who of a group hears it: the rule, then the group, then the size", () => {
    expect(groupAudience("group", "auto", LARGE_GROUP)).toBe("members");
    expect(groupAudience("group", "auto", LARGE_GROUP + 1)).toBe("leads");
    expect(groupAudience(null, null, 500)).toBe("leads");
    expect(groupAudience("group", "members", 500)).toBe("members");
    expect(groupAudience("group", "leads", 3)).toBe("leads");
    expect(groupAudience("members", "leads", 3)).toBe("members");
    expect(groupAudience("leads", "members", 3)).toBe("leads");
  });

  it("tells a large group's leads and manager, not every member («خودکار»)", async () => {
    const g = await group("میز خدمت بزرگ", crowd, { manager_id: manager }, [lead]);
    const id = await assignToGroup(g);
    expect((await bells(id)).map((b) => b.user_id).sort()).toEqual([lead, manager].sort());
    // the group's setting «همهٔ اعضا» brings every member back
    await e.owner.patch(`${P}/r/group/${g}`, { notify_mode: "members" });
    const two = await assignToGroup(g, "همهٔ اعضا");
    expect((await bells(two)).length).toBe(crowd.length + 1);
  }, 120_000);

  it("lets a rule override the groups (members always, or leads only even for a small group)", async () => {
    const big = await group("گروه بزرگ دوم", crowd, { manager_id: manager }, [lead]);
    await e.owner.post(`${P}/r/notification_rule`, {
      name: "ارجاع به گروه", builtin: "assigned_to_group", table_key: "*", event: "assigned", recipients: { assignment_group: true }, channels: ["in_app"], large_groups: "members",
    });
    await drain();
    const id = await assignToGroup(big, "قانون: همه");
    expect((await bells(id)).length).toBe(crowd.length + 1);
    const rule = (await e.owner.get(`${P}/r/notification_rule?filter=${encodeURIComponent(JSON.stringify({ f: "builtin", op: "eq", v: "assigned_to_group" }))}`)).rows[0];
    await e.owner.patch(`${P}/r/notification_rule/${rule.id}`, { large_groups: "leads", version: rule.version });
    await drain();
    const smallLed = await group("گروه کوچک با سرپرست", [a1.userId], { manager_id: manager }, [a2.userId]);
    const two = await assignToGroup(smallLed, "قانون: سرپرستان");
    expect((await bells(two)).map((b) => b.user_id).sort()).toEqual([a2.userId, manager].sort());
    await e.owner.del(`${P}/r/notification_rule/${rule.id}`);
    await drain();
  }, 120_000);
});
