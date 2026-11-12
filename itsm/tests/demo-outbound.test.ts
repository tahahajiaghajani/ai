// Nothing of the demo pack leaves the system (docs/DEMO_FA.md), checked at the source of every outbound path:
// · `callOut` (src/server/modules/integration/net.ts) — the integration hub's one HTTP function — makes no call inside
//   demo work and answers a refusal (`demo`), whoever calls it; `outsideFetch` (imports from a URL) rejects there;
// · the other outbound clients refuse inside demo work too: messengers and SMS gateways and the portal's bots
//   (`channelFetch`), the CMDB's URL sources, the event module's SNS confirmation, LDAP connections, reading a mailbox
//   (IMAP) — each before any connection, and a refusal says so (never «اتصال برقرار نشد»); e-mail, SMS and messenger
//   senders already assert it (demo-safety.test.ts); a scheduled export run inside demo work sends nothing and leaves
//   its schedule as it was;
// · paths that a real person or the system takes outside demo work but that would carry a demo record: an outbound
//   webhook delivery queued before its record joined the pack (skipped, never a failure of the receiver), the test send
//   «با یک رکورد واقعی» (a demo record is refused, the newest real one is picked), the portal's messenger link of a
//   demo account (no code, no link, and an earlier link ends without an answer from the assistant);
// · the AI providers are the one deliberate exception: the organisation's own model, under its data-use policy — the
//   demo script asks the assistant about demo records.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { makeServer, Client, signupWithOrg, quietLog } from "./helpers";
import { tick } from "@server/jobs";
import { aiNet } from "@server/modules/ai/net";
import { adapterEnv } from "@server/modules/ai/connections";
import { callOut, outsideFetch } from "@server/modules/integration/net";
import { channelFetch } from "@server/modules/notify/channels";
import { confirmSns } from "@server/modules/event/ingest";
import { runUrlSource } from "@server/modules/cmdb/jobs";
import { LdapClient, LdapError } from "@server/modules/integration/ldap";
import { newLinkCode } from "@server/modules/portal/channels";
import { notifyPeople, pollChannel, setMailboxOpener, type MailboxSession } from "@server/modules/notify";
import { runSchedule } from "@server/modules/integration/exports";
import { createIn, systemCtx } from "@server/engine";
import { inDemoScope, DemoOutboundError } from "@server/db/scope";
import { makeCtx, type AuthUser, type MemberRow, type OrgRow, type ServerConfig } from "@server/context";
import { uuidv7 } from "@shared/id";
import { enqueue } from "@server/jobs";
import type { Db } from "@server/db";

const calls: { url: string; method: string; body: string }[] = [];
const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  calls.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : "" });
  if (url.includes("api.telegram.org")) return Response.json({ ok: true, result: { message_id: 1 } });
  if (url.includes("cmdb.example.com")) return new Response("name,class\nسرور نمونه,server", { status: 200 });
  return new Response("ok", { status: 200 });
}) as typeof fetch;

describe("nothing of demo work leaves the system, at the source", () => {
  let app: Awaited<ReturnType<typeof makeServer>>["app"];
  let db: Db;
  let cfg: ServerConfig;
  let owner: Client;
  let org: string;
  let P: string;
  const lookup = aiNet.lookup;

  const drain = async () => {
    for (let i = 0; i < 30; i++) {
      await db.query(`update sm_jobs set run_at = now() where status = 'queued' and (kind like 'integration.%' or kind like 'portal.%')`);
      const r = await tick(cfg, { budgetMs: 30_000 });
      if (!r.ran && !r.more) break;
    }
  };
  const demoRow = (id: string, tbl: string) => db.query(`insert into sm_demo_rows (org_id, row_id, tbl) values ($1, $2, $3) on conflict do nothing`, [org, id, tbl]);

  beforeAll(async () => {
    aiNet.lookup = async () => ["93.184.216.34"];
    ({ app, db } = await makeServer({ config: { fetch: fakeFetch } }));
    cfg = { mode: "cloud", db, secret: "test-secret", allowSignup: true, platformAdmins: [], origin: "cloud", log: quietLog, fetch: fakeFetch };
    owner = new Client(app);
    org = await signupWithOrg(owner);
    P = `/o/${org}`;
    await db.query(`insert into sm_demo_packs (org_id, state, size, progress, counters) values ($1, 'loaded', 'small', '{}'::jsonb, '{}'::jsonb)`, [org]);
    await drain();
  }, 300_000);
  afterAll(() => {
    aiNet.lookup = lookup;
  });

  it("callOut makes no call inside demo work and answers a refusal; outside it calls", async () => {
    calls.length = 0;
    const refused = await inDemoScope(org, () => callOut(cfg, "https://hooks.example.com/x", { method: "POST", body: "{}" }, "مقصد آزمایشی"));
    expect(refused).toMatchObject({ ok: false, status: 0, demo: true });
    expect(refused.text).toContain("نمایشی");
    expect(calls).toEqual([]);
    // a fetch taken from it inside demo work rejects before any connection (imports from a URL use it)
    await expect(inDemoScope(org, () => outsideFetch(cfg)("https://files.example.com/a.csv"))).rejects.toBeInstanceOf(DemoOutboundError);
    expect(calls).toEqual([]);
    // outside demo work the same call is made
    const made = await callOut(cfg, "https://hooks.example.com/x", { method: "POST", body: "{}" }, "مقصد آزمایشی");
    expect(made).toMatchObject({ ok: true, status: 200 });
    expect(made.demo).toBeUndefined();
    expect(calls.map((c) => c.url)).toEqual(["https://hooks.example.com/x"]);
  });

  it("every other outbound client refuses inside demo work, before any connection", async () => {
    calls.length = 0;
    // messengers, SMS gateways and the portal's bots
    await expect(inDemoScope(org, () => channelFetch(cfg)("https://api.telegram.org/bot1:x/sendMessage", { method: "POST", body: "{}" }))).rejects.toBeInstanceOf(DemoOutboundError);
    // the event module's SNS subscription confirmation
    await expect(inDemoScope(org, () => confirmSns(cfg, "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=x"))).rejects.toThrow();
    // a CMDB URL source read by demo work
    const sys = await systemCtx(cfg, org);
    const src = await sys.write((tx) => createIn(tx, sys, "cmdb_data_source", { name: "منبع نمایشی", kind: "url", url: "https://cmdb.example.com/cis.csv", format: "csv" }, { trusted: true }));
    const read = await inDemoScope(org, () => runUrlSource(sys, String(src.id)));
    expect(read.rows).toBe(0);
    // said as a demo refusal, not as a network failure an administrator would go looking for
    expect(read.error).toContain("نمایشی");
    expect(calls).toEqual([]);
    // the same source outside demo work is read
    expect((await runUrlSource(sys, String(src.id))).error).toBeUndefined();
    expect(calls.map((c) => c.url)).toEqual(["https://cmdb.example.com/cis.csv"]);
    // a directory server is not even connected to (the refusal comes before the socket)
    const ldap = new LdapClient({ url: "ldap://127.0.0.1:1", bindDn: "cn=x", password: "y", timeoutMs: 2000 });
    const err = await inDemoScope(org, () => ldap.connect()).catch((e) => e);
    expect(err).toBeInstanceOf(LdapError);
    expect(String(err.message)).toContain("نمایشی");
  });

  it("no mailbox is opened inside demo work, whichever opener is set", async () => {
    const opened: string[] = [];
    setMailboxOpener(async (c) => {
      opened.push(c.host);
      const s: MailboxSession = {
        async fetch() {
          return { uidValidity: "1", uidNext: 1, messages: [], skipped: [] };
        },
        async markSeen() {},
        async close() {},
      };
      return s;
    });
    try {
      const sys = await systemCtx(cfg, org);
      const ch = { id: uuidv7(), name: "صندوق میز خدمت", imap_host: "imap.example.com", imap_user: "desk", imap_security: "tls", imap_folder: "INBOX" } as unknown as Parameters<typeof pollChannel>[2];
      await expect(inDemoScope(org, () => pollChannel(cfg, sys, ch))).rejects.toBeInstanceOf(DemoOutboundError);
      expect(opened).toEqual([]);
      // the same channel outside demo work is read
      expect((await pollChannel(cfg, sys, ch)).fetched).toBe(0);
      expect(opened).toEqual(["imap.example.com"]);
    } finally {
      setMailboxOpener(null);
    }
  });

  it("a scheduled export run inside demo work sends nothing and leaves its schedule as it was", async () => {
    const iu = (await owner.post(`${P}/r/integration_user`, { name: "انبار داده" })).row;
    await owner.put(`${P}/integration/users/${iu.id}/roles`, { roles: ["agent"] });
    await owner.post(`${P}/r/todo`, { short_description: "کار واقعی برای خروجی" });
    // switched off: run here only (its queued job would otherwise run under the other tests' drain)
    const s = (await owner.post(`${P}/r/export_schedule`, { name: "خروجی شبانه", active: false, tables: ["todo"], principal_id: iu.id, destination: "webhook", url: "https://warehouse.example.com/in", format: "json" })).row;
    const logged = async () => (await db.query(`select id from sm_int_log where org_id = $1 and ref_id = $2`, [org, s.id])).length;
    calls.length = 0;
    const refused = await inDemoScope(org, () => runSchedule(cfg, org, String(s.id)));
    expect(refused.ok).toBe(false);
    expect(refused.message).toContain("نمایشی");
    expect(calls).toEqual([]);
    expect(await logged()).toBe(0);
    // not the destination's failure: the schedule's health and result stay as they were
    const kept = (await owner.get(`${P}/r/export_schedule/${s.id}`)).row;
    expect([kept.health, kept.last_status ?? null, kept.last_run_at ?? null]).toEqual([s.health, s.last_status ?? null, s.last_run_at ?? null]);
    // outside demo work the same schedule is sent
    expect((await runSchedule(cfg, org, String(s.id))).ok).toBe(true);
    expect(calls.map((c) => c.url)).toEqual(["https://warehouse.example.com/in"]);
    expect(await logged()).toBe(1);
  });

  it("the AI providers stay reachable for demo work (the organisation's own model, under its data-use policy)", async () => {
    calls.length = 0;
    const res = await inDemoScope(org, () => adapterEnv(cfg).fetch("https://api.anthropic.com/v1/messages", { method: "POST", body: "{}" }));
    expect(res.ok).toBe(true);
    expect(calls.map((c) => c.url)).toEqual(["https://api.anthropic.com/v1/messages"]);
  });

  it("what the AI tells people about a demo record (an agent's proposal, an insight) leaves the system by no channel", async () => {
    // besides its model's calls (above), the AI reaches people only through notifyPeople — an agent's proposal notice
    // (ai/agents/runtime.ts), an insight's digest (ai/insights) —, and its delivery judges the record, whoever queued it
    // and in or outside demo work (notify/deliver.ts `demoQuiet`): no e-mail or SMS about a demo record, and no real
    // person hears of it; the same notice about a real record is delivered
    const me = String((await owner.get("/auth/me")).user.id);
    const sys = await systemCtx(cfg, org);
    const demoId = await inDemoScope(org, () => sys.write(async (tx) => String((await createIn(tx, sys, "todo", { short_description: "کار نمایشی برای عامل هوش مصنوعی" }, { trusted: true })).id)));
    const realId = await sys.write(async (tx) => String((await createIn(tx, sys, "todo", { short_description: "کار واقعی برای عامل هوش مصنوعی" }, { trusted: true })).id));
    const notice = (id: string) => ({
      table: "todo", id, users: [me], channels: ["in_app" as const, "email" as const, "sms" as const], label: "پیشنهاد عامل هوش مصنوعی",
      subject: "پیشنهاد «عامل آزمون»: بستن کار", body: "برای بررسی و تأیید به «پیشنهادهای هوش مصنوعی» بروید.", source: "عامل هوش مصنوعی «عامل آزمون»",
    });
    const run = async () => {
      for (let i = 0; i < 20; i++) {
        await db.query(`update sm_jobs set run_at = now() where status = 'queued' and kind like 'notify.%'`);
        const r = await tick(cfg, { budgetMs: 30_000 });
        if (!r.ran && !r.more) break;
      }
    };
    calls.length = 0;
    await sys.write((tx) => notifyPeople(tx, org, notice(demoId)), { internal: true });
    await run();
    expect(calls).toEqual([]);
    await sys.write((tx) => notifyPeople(tx, org, notice(realId)), { internal: true });
    await run();
    const logOf = (id: string) => db.query<{ channel: string; status: string; reason: string | null }>(`select channel, status, reason from sm_notification_log where org_id = $1 and record_id = $2 and rule_key like 'direct:%' order by channel`, [org, id]);
    const demoLog = await logOf(demoId);
    expect(demoLog.map((l) => l.channel)).toEqual(["email", "in_app", "sms"]);
    for (const l of demoLog) expect(l, l.channel).toMatchObject({ status: "skipped", reason: "demo" });
    expect(await db.one(`select 1 from sm_notifications where org_id = $1 and record_id = $2`, [org, demoId])).toBeNull();
    // the real record's notice: the bell is there, and nothing of it was held back as demo
    const realLog = await logOf(realId);
    expect(realLog.find((l) => l.channel === "in_app")?.status).not.toBe("skipped");
    expect(realLog.filter((l) => l.reason === "demo")).toEqual([]);
    expect(await db.one(`select 1 from sm_notifications where org_id = $1 and record_id = $2 and user_id = $3`, [org, realId, me])).toBeTruthy();
  });

  it("a demo record's webhook delivery is skipped and the test send never takes a demo record", async () => {
    const iu = (await owner.post(`${P}/r/integration_user`, { name: "سامانهٔ گزارش" })).row;
    await owner.put(`${P}/integration/users/${iu.id}/roles`, { roles: ["agent"] });
    const sub = (await owner.post(`${P}/r/webhook_subscription`, { name: "کارها به بیرون", url: "https://hooks.example.com/in", principal_id: iu.id, table_key: "todo", events: ["created", "updated"] })).row;
    const real = (await owner.post(`${P}/r/todo`, { short_description: "کار واقعی" })).row;
    await drain();
    // a delivery of a record that joined the pack after it was queued (or one replayed from the dead-letter list)
    const sys = await systemCtx(cfg, org);
    const demoId = await inDemoScope(org, () => sys.write(async (tx) => String((await createIn(tx, sys, "todo", { short_description: "کار نمایشی بانک" }, { trusted: true })).id)));
    const delivery = uuidv7();
    await db.query(`insert into sm_webhook_deliveries (id, org_id, subscription_id, event, table_key, record_id, record_number, status) values ($1, $2, $3, 'updated', 'todo', $4, null, 'pending')`, [delivery, org, sub.id, demoId]);
    await db.tx((tx) => enqueue(tx, { kind: "integration.webhook.deliver", orgId: org, payload: { id: delivery }, maxAttempts: 3 }));
    calls.length = 0;
    await drain();
    expect(calls).toEqual([]);
    const d = await db.one<{ status: string; error: string | null }>(`select status, error from sm_webhook_deliveries where id = $1`, [delivery]);
    expect(d!.status).toBe("skipped");
    expect(d!.error).toContain("نمایشی");
    const after = (await owner.get(`${P}/r/webhook_subscription/${sub.id}`)).row;
    expect(Number(after.failures ?? 0)).toBe(0);
    expect(after.paused).toBe(false);
    // «ارسال آزمایشی با یک رکورد واقعی»: a demo record named is refused; picked, the newest real one goes
    await owner.post(`${P}/integration/webhooks/${sub.id}/test`, { record_id: demoId }, 409);
    expect(calls).toEqual([]);
    const test = await owner.post(`${P}/integration/webhooks/${sub.id}/test`, {});
    expect(test.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].body).record_id).toBe(real.id);
  });

  it("a demo account gets no messenger link, and an earlier link ends without an answer", async () => {
    const ch = (await owner.post(`${P}/r/portal_channel`, { name: "ربات سازمان", kind: "telegram", token: "123:abc", bot_username: "org_help_bot", auth_mode: "header" })).row;
    const s = await owner.post(`${P}/portal/channels/${ch.id}/secret`, {});
    const key = String(s.webhook_url).split("/").pop()!;
    // one of the pack's people (as the loader adds them): marked, recorded, a member with an ordinary role
    const persona = uuidv7();
    await db.query(`insert into sm_users (id, email, full_name, prefs) values ($1, $2, 'کارشناس نمایشی', $3::jsonb)`, [persona, `agent.${org.slice(0, 6)}@aftab-bank.example`, JSON.stringify({ demo_org: org })]);
    await demoRow(persona, "sm_users");
    await db.query(`insert into sm_org_members (id, org_id, user_id, role, origin) values ($1, $2, $3, 'member', 'cloud')`, [uuidv7(), org, persona]);
    await owner.put(`${P}/access/members/${persona}`, { roles: ["agent"], persona: "agent" });
    // no link code for a demo account
    const user = (await db.one<AuthUser>(`select id, email, full_name, mobile, is_platform_admin, disabled, prefs from sm_users where id = $1`, [persona]))!;
    const orgRow = (await db.one<OrgRow>(`select * from sm_orgs where id = $1`, [org]))!;
    const member = (await db.one<MemberRow>(`select id, org_id, user_id, role, overrides, is_active from sm_org_members where org_id = $1 and user_id = $2`, [org, persona]))!;
    await expect(newLinkCode(makeCtx(cfg, user, orgRow, member))).rejects.toMatchObject({ status: 403 });
    const deliver = async (text: string, from: number) => {
      const id = Math.floor(Math.random() * 1e9);
      const body = JSON.stringify({ update_id: id, message: { message_id: id, date: 1, text, chat: { id: from, type: "private" }, from: { id: from, first_name: "مهمان", is_bot: false } } });
      const res = await app.fetch(new Request(`http://local.test/api/public/portal/hooks/${key}`, { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": s.secret }, body }));
      expect(res.status).toBe(200);
      await drain();
    };
    const sys = await systemCtx(cfg, org);
    // a code issued for the demo account (made before the pack's rules, say) links nothing
    const code = "ABCDEFGH";
    await sys.write((tx) => createIn(tx, sys, "portal_link_code", { user_id: persona, code_hash: createHash("sha256").update(`portal.link:${org}:${code}`, "utf8").digest("hex"), expires_at: new Date(Date.now() + 600_000).toISOString() }, { trusted: true }));
    calls.length = 0;
    await deliver(`/link ${code}`, 801);
    expect(await db.one(`select 1 from sm_portal_channel_identities where org_id = $1 and user_id = $2 and active`, [org, persona])).toBeNull();
    expect(calls.map((c) => JSON.parse(c.body).text)).toEqual(["حساب‌های نمایشی به پیام‌رسان وصل نمی‌شوند."]);
    // an earlier link of the demo account: the next message ends it; the assistant answers nothing
    const identity = await sys.write((tx) => createIn(tx, sys, "portal_channel_identity", { channel_id: ch.id, user_id: persona, external_id: "802", external_name: "مهمان", linked_at: new Date().toISOString(), active: true }, { trusted: true }));
    calls.length = 0;
    await deliver("وضعیت درخواست‌های من چیست؟", 802);
    expect((await db.one<{ active: boolean }>(`select active from sm_portal_channel_identities where id = $1`, [identity.id]))!.active).toBe(false);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].body).text).toContain("حساب‌های نمایشی به پیام‌رسان وصل نمی‌شوند");
    expect(await db.one(`select 1 from sm_portal_channel_log where org_id = $1 and user_id = $2 and status = 'replied'`, [org, persona])).toBeNull();
  });
});
