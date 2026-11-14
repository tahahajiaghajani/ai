// GET /meta/tables carries a validator (src/server/engine/meta.ts): every page load of the app asks for the table
// definitions again (about 2 MB for an administrator); the browser keeps the answer and sends If-None-Match, and the
// server confirms an unchanged answer (304) without building, compressing or sending it. The tag follows everything
// the answer is made of — the organisation's custom fields and choices, what the caller's roles and field groups make
// of them, the tables the caller takes part in — so nobody ever keeps definitions that no longer apply to them. It also
// names the person and the session: a browser one person filled (the Windows app's window after «خروج» and another
// sign-in) is never told that its definitions apply to someone else or to a later session.
import { describe, it, expect, beforeAll } from "vitest";
import { world, type World } from "./incident-helpers";
import { Client } from "./helpers";

let w: World;

/** GET /api/o/:org/meta/tables as `who`, optionally with If-None-Match. */
async function meta(who: Client, tag?: string | null): Promise<{ status: number; tag: string | null; cache: string | null; tables: number; body: string }> {
  const headers: Record<string, string> = {};
  if (who.cookie) headers.cookie = who.cookie;
  if (tag) headers["if-none-match"] = tag;
  const res = await w.e.app.fetch(new Request(`http://local.test/api${w.P}/meta/tables`, { headers }));
  const body = await res.text();
  return { status: res.status, tag: res.headers.get("etag"), cache: res.headers.get("cache-control"), tables: body ? (JSON.parse(body).tables?.length ?? 0) : 0, body };
}

beforeAll(async () => {
  w = await world();
}, 300_000);

describe("GET /meta/tables is revalidated, never rebuilt while unchanged", () => {
  it("answers 304 without a body when the browser already has this caller's definitions", async () => {
    const first = await meta(w.o);
    expect(first.status).toBe(200);
    expect(first.tag).toMatch(/^W\/"m-[A-Za-z0-9_-]{32}"$/);
    expect(first.cache).toBe("private, no-cache");
    expect(first.tables).toBeGreaterThan(50);
    const again = await meta(w.o, first.tag);
    expect(again.status).toBe(304);
    expect(again.body).toBe("");
    expect(again.tag).toBe(first.tag);
    // the strong form, a list and an unknown tag
    expect((await meta(w.o, first.tag!.replace(/^W\//, ""))).status).toBe(304);
    expect((await meta(w.o, `W/"other", ${first.tag}`)).status).toBe(304);
    expect((await meta(w.o, `W/"m-unknown"`)).status).toBe(200);
  });

  it("gives every caller a tag of their own: access that differs, and another person with the same access", async () => {
    const owner = await meta(w.o);
    const agent = await meta(w.p.agent.client);
    const other = await meta(w.p.other.client);
    const req = await meta(w.p.req.client);
    expect(agent.tag).not.toBe(owner.tag);
    expect(req.tag).not.toBe(agent.tag);
    expect(req.tables).toBeLessThan(agent.tables);
    // two agents with the same role read the same definitions, under tags of their own
    expect(other.body).toBe(agent.body);
    expect(other.tag).not.toBe(agent.tag);
    expect((await meta(w.p.other.client, agent.tag)).status).toBe(200);
    // a requester's browser holding an agent's definitions is never told they still apply
    expect((await meta(w.p.req.client, agent.tag)).status).toBe(200);
  });

  it("never confirms one session's definitions to the next: «خروج» and a sign-in in the same window", async () => {
    // one window (one cookie jar, one HTTP cache), the way the Windows app switches accounts
    const added = await w.o.post(`${w.P}/members`, { email: "meta-switch@example.com", full_name: "همکار دوم", role: "member" });
    const browser = new Client(w.e.app);
    await browser.post("/auth/login", { email: "owner@example.com", password: "s3cret-pass" });
    const first = await meta(browser);
    expect(first.status).toBe(200);
    expect((await meta(browser, first.tag)).status).toBe(304);
    await browser.post("/auth/logout");
    // signed out: nothing at all, not even a confirmation
    expect((await meta(browser, first.tag)).status).toBe(401);
    // the same person again: a new session, a new tag — the cached answer is replaced, not confirmed
    await browser.post("/auth/login", { email: "owner@example.com", password: "s3cret-pass" });
    const again = await meta(browser, first.tag);
    expect(again.status).toBe(200);
    expect(again.tag).not.toBe(first.tag);
    expect(again.body).toBe(first.body);
    expect(again.cache).toBe("private, no-cache");
    // another person in the same window gets their own definitions, never a 304 for what the browser keeps
    await browser.post("/auth/logout");
    await browser.post("/auth/login", { email: "meta-switch@example.com", password: added.temp_password });
    const member = await meta(browser, again.tag);
    expect(member.status).toBe(200);
    expect(member.tag).not.toBe(again.tag);
    expect(member.tables).toBeLessThan(again.tables);
    expect((await meta(browser, member.tag)).status).toBe(304);
  });

  it("changes the tag when the organisation's definitions change (a custom field, a choice list)", async () => {
    const before = await meta(w.o);
    await w.o.post(`${w.P}/r/custom_field`, { table_key: "incident", name: "u_branch_code", label: "کد شعبه", type: "string" });
    const after = await meta(w.o, before.tag);
    expect(after.status).toBe(200);
    expect(after.tag).not.toBe(before.tag);
    expect(after.body).toContain("u_branch_code");
    expect((await meta(w.o, after.tag)).status).toBe(304);
  });

  it("changes the tag when the caller's roles change, and back when they are restored", async () => {
    const before = await meta(w.p.req2.client);
    await w.o.put(`${w.P}/access/members/${w.p.req2.userId}`, { roles: ["agent"], persona: "agent" });
    const agent = await meta(w.p.req2.client, before.tag);
    expect(agent.status).toBe(200);
    expect(agent.tag).not.toBe(before.tag);
    expect(agent.tables).toBeGreaterThan(before.tables);
    await w.o.put(`${w.P}/access/members/${w.p.req2.userId}`, { roles: ["requester"], persona: "requester" });
    const back = await meta(w.p.req2.client, agent.tag);
    expect(back.status).toBe(200);
    expect(back.tag).toBe(before.tag);
  });
});
