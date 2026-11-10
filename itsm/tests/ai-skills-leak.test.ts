// RAG leak canaries of the module tables (catalogue AI-171; docs/spec/AI.md §10): incidents, problems, changes,
// knowledge articles, CIs and catalogue items of a real organisation (incident, knowledge, change, CMDB and request
// modules seeded, «نیاز به دانستن»), each carrying a unique token in a place some members may not read — another
// group's record, a confidential row, a field group (an article's internal part), a table outside a role's areas. Every
// member asks `retrieve` and `askWithCitations` for every token and runs grounded skills on a record of their own;
// the engine's own predicate (`readableIds`) and the member's field groups are the oracle: no token of anything the
// member may not read ever comes back — in passages, answers, citations or what reached the skill's model.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kbWorld, type KbWorld } from "./knowledge-helpers";
import { PLANS, at } from "./change-helpers";
import { create } from "@server/engine";
import type { Ctx } from "@server/context";
import { access } from "@server/access/provider";
import { memberCtx, readableIds } from "@server/access";
import { askWithCitations, retrieve } from "@server/modules/ai/rag";
import { seedRequestDefaults } from "@server/modules/request";
import { FAKE_INBOX, clearFakeInbox } from "@server/modules/ai/adapters/fake";
import { runSkill } from "@server/modules/ai/skills";
import type { FieldGroup } from "@shared/model/types";

const before = process.env.ITSM_AI_FAKE;
afterAll(() => {
  if (before === undefined) delete process.env.ITSM_AI_FAKE;
  else process.env.ITSM_AI_FAKE = before;
});

interface Canary {
  token: string;
  table: string;
  id: string;
  /** the field group the token's field belongs to (null: the record's own readability decides) */
  group: FieldGroup | null;
  what: string;
}

describe("RAG leak canaries of the module tables: retrieve, askWithCitations and skills", () => {
  let w: KbWorld;
  const canaries: Canary[] = [];
  const members: Record<string, string> = {};
  const own: Record<string, string> = {}; // an incident of each member (they are its caller)

  beforeAll(async () => {
    process.env.ITSM_AI_FAKE = "1";
    w = await kbWorld();
    const { o, P } = w;
    await o.post(`${P}/ai/connections`, { preset: "fake", embed: { model: "fake-embed", dims: 32 } });
    await o.post(`${P}/change/seed`, {});
    await o.post(`${P}/cmdb/seed`, {});
    await seedRequestDefaults(w.e.cfg, w.e.org);
    const vendor = await w.e.member("member", "vendor@example.com");
    await o.put(`${P}/access/members/${vendor.userId}`, { roles: ["vendor_agent"], persona: "agent" });
    await o.post(`${P}/access/groups/${w.g.network}/members`, { user_ids: [vendor.userId] });
    await o.put(`${P}/access/settings`, { preset: "need_to_know", domain_separation: false });
    for (const [k, v] of Object.entries(w.p)) members[k] = v.userId;
    members.vendor = vendor.userId;
    members.owner = w.e.ownerId;
    const add = (c: Canary) => canaries.push(c);

    // incidents: the network group's (need-to-know), a confidential one, the desk's
    const inc = async (token: string, data: Record<string, unknown>) =>
      String((await o.post(`${P}/r/incident`, { short_description: `قطعی شبکهٔ بی‌سیم ${token}`, description: `شرح قطعی شبکه ${token}`, ...data })).row.id);
    add({ token: "incnetQ1", table: "incident", id: await inc("incnetQ1", { caller_id: members.req2, assignment_group_id: w.g.network }), group: null, what: "another group's incident" });
    add({ token: "incconfQ2", table: "incident", id: await inc("incconfQ2", { caller_id: members.req2, assignment_group_id: w.g.network, confidential: true }), group: null, what: "a confidential incident" });
    add({ token: "incdeskQ3", table: "incident", id: await inc("incdeskQ3", { caller_id: members.req, assignment_group_id: w.g.desk }), group: null, what: "the desk's incident" });
    // a problem of the network group
    add({ token: "prbnetQ4", table: "problem", id: String((await create(w.sys, "problem", { short_description: `مشکل تکرارشوندهٔ شبکه prbnetQ4`, description: "شرح prbnetQ4", assignment_group_id: w.g.network })).row.id), group: null, what: "another group's problem" });
    // a confidential change of the network group
    const ch = await o.post(`${P}/r/change_request`, { short_description: "ارتقای دیوارهٔ آتش chgconfQ5", type: "normal", assignment_group_id: w.g.network, planned_start: at(12), planned_end: at(12, 11), ...PLANS, description: "ارتقای دیوارهٔ آتش chgconfQ5", confidential: true });
    add({ token: "chgconfQ5", table: "change_request", id: String(ch.row.id), group: null, what: "a confidential change" });
    // a published article whose internal part only agents may read, and a confidential article
    const art = await w.published({ title: "اتصال به شبکهٔ بی‌سیم مهمان", body: "## گام‌ها\n\n1. شبکهٔ مهمان را برگزینید kbpubQ6\n", internal_body: "رمز مدیریتی نقطهٔ دسترسی در گاوصندوق است kbintQ7" });
    add({ token: "kbpubQ6", table: "kb_article", id: String(art.id), group: null, what: "a public article" });
    add({ token: "kbintQ7", table: "kb_article", id: String(art.id), group: "internal", what: "an article's internal part" });
    // a CI (requesters and vendors read no CMDB)
    const ci = await o.post(`${P}/r/ci`, { name: "نقطهٔ دسترسی طبقهٔ سوم", class: "server", state: "operational", description: "نقطهٔ دسترسی بی‌سیم cmdbQ8" });
    add({ token: "cmdbQ8", table: "ci", id: String(ci.row.id), group: null, what: "a CI" });
    // a catalogue item (vendors read no catalogue)
    const catalog = (await o.get(`${P}/r/catalog?size=1`)).rows[0];
    const item = await create(w.sys, "catalog_item", { name: "درخواست دسترسی بی‌سیم", type: "access", catalog_id: catalog.id, short_description: "دسترسی به شبکهٔ بی‌سیم catQ9" });
    add({ token: "catQ9", table: "catalog_item", id: String(item.row.id), group: null, what: "a catalogue item" });
    // an incident of each member, for their grounded skill runs
    for (const k of ["req", "req2", "agent", "other", "hr", "auditor", "km"]) own[k] = await inc(`own${k}`, { caller_id: members[k], assignment_group_id: k === "other" ? w.g.network : w.g.desk });
    // every member's summary is grounded on the knowledge base (their own access)
    await o.patch(`${P}/ai/skills/admin/record.summary`, { grounding: "knowledge", grounding_k: 6 });
    await w.drain();
  }, 240_000);

  /** Which canaries `ctx` may see (the oracle: the engine's predicate and the member's field groups). */
  async function allowed(ctx: Ctx): Promise<Set<string>> {
    const out = new Set<string>();
    for (const c of canaries) {
      const ok = (await readableIds(ctx, c.table, [c.id])).has(c.id) && (!c.group || access().hasFieldGroup(ctx, c.group));
      if (ok) out.add(c.token);
    }
    return out;
  }

  const leaked = (text: string, ok: Set<string>) => canaries.filter((c) => text.includes(c.token) && !ok.has(c.token)).map((c) => `${c.token} (${c.what})`);

  it("indexed every canary record (the probes are not vacuous)", async () => {
    const rows = await w.e.db.query<{ n: number }>(`select count(distinct record_id)::int as n from sm_ai_chunks where org_id = $1 and record_id = any($2::uuid[])`, [w.e.org, `{${[...new Set(canaries.map((c) => c.id))].join(",")}}`]);
    expect(rows[0].n).toBe(new Set(canaries.map((c) => c.id)).size);
  });

  for (const who of ["req", "req2", "agent", "other", "hr", "vendor", "auditor", "km", "owner"]) {
    it(`${who}: no canary of anything they may not read comes back`, async () => {
      const ctx = await memberCtx(w.e.cfg, w.e.org, members[who]);
      const ok = await allowed(ctx);
      const problems: string[] = [];
      let found = 0;
      for (const c of canaries) {
        const r = await retrieve(ctx, c.token, { k: 12 });
        for (const p of r.passages) {
          if (!(await readableIds(ctx, p.citation.table, [p.citation.id])).has(p.citation.id)) problems.push(`cited unreadable ${p.citation.table} ${p.citation.id}`);
          const text = `${p.text}\n${p.context}\n${p.citation.title}\n${p.heading ?? ""}`;
          problems.push(...leaked(text, ok).map((x) => `retrieve «${c.token}»: ${x}`));
          if (text.includes(c.token)) found++;
        }
        const a = await askWithCitations(ctx, c.token, {}, { k: 6 });
        problems.push(...leaked(`${a.answer}\n${a.passages.map((p) => `${p.text} ${p.citation.title}`).join("\n")}`, ok).map((x) => `ask «${c.token}»: ${x}`));
        for (const cit of a.citations) if (!(await readableIds(ctx, cit.table, [cit.id])).has(cit.id)) problems.push(`ask cited unreadable ${cit.table}`);
      }
      // grounded skills on a record of their own: nothing unreadable reached the model, nothing came back
      if (own[who]) {
        clearFakeInbox();
        const s = await runSkill(ctx, "record.summary", { table: "incident", id: own[who], params: { query: "شبکهٔ بی‌سیم مهمان دسترسی" } });
        problems.push(...leaked(`${FAKE_INBOX.map((t) => t.text).join("\n")}\n${JSON.stringify(s)}`, ok).map((x) => `record.summary: ${x}`));
        for (const cit of s.citations) if (!(await readableIds(ctx, cit.table, [cit.id])).has(cit.id)) problems.push(`summary cited unreadable ${cit.table}`);
        if (ctx.can("ai", "view") && (await readableIds(ctx, "incident", [own[who]])).size) {
          const roles = (await import("@server/access")).subjectOf(ctx).eff.roles;
          if (roles.includes("agent")) {
            clearFakeInbox();
            await runSkill(ctx, "incident.triage", { table: "incident", id: own[who] }).catch(() => null);
            problems.push(...leaked(FAKE_INBOX.map((t) => t.text).join("\n"), ok).map((x) => `incident.triage: ${x}`));
          }
        }
      }
      expect(problems).toEqual([]);
      // members who may read a canary find it (recall, not only absence)
      if (ok.size) expect(found).toBeGreaterThan(0);
    }, 120_000);
  }

  it("the oracle itself separates the members (each restriction is exercised)", async () => {
    const seen = async (who: string) => allowed(await memberCtx(w.e.cfg, w.e.org, members[who]));
    const req = await seen("req");
    const agent = await seen("agent");
    const other = await seen("other");
    const vendor = await seen("vendor");
    expect(req.has("kbpubQ6")).toBe(true);
    expect(req.has("kbintQ7")).toBe(false); // the internal part: agents only
    expect(agent.has("kbintQ7")).toBe(true);
    expect(agent.has("incnetQ1")).toBe(false); // need-to-know: the other group's incident
    expect(other.has("incnetQ1")).toBe(true);
    expect(agent.has("incconfQ2")).toBe(false); // confidential
    expect(req.has("cmdbQ8")).toBe(false); // no CMDB for requesters
    expect(agent.has("cmdbQ8")).toBe(true);
    expect(vendor.has("catQ9")).toBe(false); // no catalogue for vendors
    expect(req.has("catQ9")).toBe(true);
    expect(agent.has("chgconfQ5")).toBe(false);
  });
});
