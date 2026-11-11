// Tables only the platform writes — computed scores and facts, deliveries, ledgers and runs a module keeps — carry the
// row rule `rowAccess.write: NEVER` (docs/spec/ENGINE.md): nobody else gets «… تازه» or «ورود از اکسل» (`can.create`
// of /meta/tables is false, whatever the roles), and the server refuses a person's create with 403 before it looks at
// the values. The candidates are the tables whose description says only the system writes them, the computed tables
// of the demo purge (COMPUTED_TABLES) and the runtime's own records whose hooks refuse every write but the system's
// (skill and agent runs, the virtual agent's conversations, messenger links); those people work (definitions, gaps,
// candidates, reviews, runs) and the ledgers a Windows app pushes as the trace of its own changes (custody, device
// status, assignments, SLA timers, survey answers) stay as they are — see `PEOPLE_WRITE` and `PUSHED` below.
import { describe, it, expect, beforeAll } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import type { Client } from "./helpers";
import { tick } from "@server/jobs";
import { tableDef } from "@shared/tables";
import { isNever } from "@shared/model/conditions";
import { combineRoles, grantIn, roleClosure, type RoleDef } from "@shared/access/model";
import { COMPUTED_TABLES } from "@server/modules/demo/purge";
import { TABLES } from "@shared/tables";
import { draftable } from "@server/modules/ai/tools/records";
import { SYNC_PROTOCOL } from "@shared/constants";
import { uuidv7 } from "@shared/id";

/** Written only by their module (the jobs that compute them, the services that book them). */
const SYSTEM_ONLY = [
  "service_score_fact", "change_success_score", "analytics_score", "analytics_delivery", "allocation_result",
  "cmdb_health_fact", "account_health", "supplier_scorecard", "license_position", "license_reconcile_run",
  "entitlement_ledger", "ai_digest",
  // the runtime's own records (their module's routes write them as the system; their hooks refuse everyone else)
  "ai_skill_run", "ai_agent_run", "va_conversation", "va_message", "portal_channel_identity", "portal_link_code",
  // closed before this round
  "slm_compliance", "slm_xla_score", "wfm_presence_log", "wfm_points",
];
/** Candidates people work themselves (definitions they keep, rows they act on): not system-only. */
const PEOPLE_WRITE = ["analytics_indicator", "capacity_record", "wfm_capacity", "wfm_coverage", "kb_gap", "kb_duplicate", "problem_candidate", "incident_period_review", "allocation_run"];
/** Ledgers a Windows app pushes as the trace of its own changes (judged by their modules' push rules, never NEVER). */
const PUSHED = ["task_sla", "asset_assignment", "stock_movement", "asset_custody", "device_status_event", "survey_invitation", "survey_response", "portal_pref"];

describe("tables only the platform writes", () => {
  let e: EngineOrg;
  let P: string;
  let catalog: Map<string, RoleDef>;
  const holders = new Map<string, { client: Client; role: string }>();

  beforeAll(async () => {
    e = await engineOrg();
    P = `/o/${e.org}`;
    for (let i = 0; i < 40; i++) {
      const r = await tick(e.cfg, { budgetMs: 30_000 });
      if (!r.ran && !r.more) break;
    }
    const roles = (await e.owner.get(`${P}/access/roles`)).roles as (RoleDef & { active?: boolean })[];
    catalog = new Map(roles.map((r) => [r.key, r]));
  }, 600_000);

  /** A member holding a role (not the organisation's administrator) whose grants include creating in `area`. */
  async function creatorIn(area: string): Promise<{ client: Client; role: string }> {
    const hit = holders.get(area);
    if (hit) return hit;
    const grants = (key: string) => grantIn(combineRoles(roleClosure([key], catalog).map((k) => catalog.get(k)!).filter(Boolean)), area);
    const role = [...catalog.values()].find((r) => r.key !== "tenant_admin" && r.active !== false && grants(r.key).create)?.key ?? "tenant_admin";
    expect(grants(role).create, `${role} creates in ${area}`).toBe(true);
    const m = await e.member("member");
    await e.owner.put(`${P}/access/members/${m.userId}`, { roles: [role], persona: "agent" });
    const out = { client: m.client, role };
    holders.set(area, out);
    return out;
  }

  it("are marked NEVER, and the rest of the candidates are people's or pushed ledgers", () => {
    for (const key of SYSTEM_ONLY) expect(isNever(tableDef(key)?.rowAccess?.write), key).toBe(true);
    for (const key of [...PEOPLE_WRITE, ...PUSHED]) expect(isNever(tableDef(key)?.rowAccess?.write), key).toBe(false);
    // every candidate is decided one way or the other: «فقط سامانه می‌نویسد» in the description, or a computed table of
    // the demo purge
    const decided = new Set([...SYSTEM_ONLY, ...PEOPLE_WRITE, ...PUSHED]);
    const computed = new Set(COMPUTED_TABLES);
    for (const def of TABLES.values()) {
      const candidate = /فقط سامانه|فقط ماژول|نوشتهٔ سامانه|سامانه محاسبه/.test(String(def.description ?? "")) || computed.has(def.table);
      if (candidate) expect(decided.has(def.key) || isNever(def.rowAccess?.write), `${def.key} is undecided`).toBe(true);
    }
    // the assistant drafts no records for them either (a draft would always be refused)
    for (const key of SYSTEM_ONLY) expect(draftable(tableDef(key)!), key).toBe(false);
  });

  it("offer no «… تازه» or import to whoever holds the area's create right, and refuse their create", async () => {
    for (const key of SYSTEM_ONLY) {
      const def = tableDef(key)!;
      const who = await creatorIn(String(def.area));
      const meta = await who.client.get(`${P}/meta/tables/${key}`);
      expect(meta.table.can.create, `${key} for ${who.role}`).toBe(false);
      const refused = await who.client.post(`${P}/r/${key}`, {}, 403);
      expect(refused.error.message, key).toContain("سامانه");
      // nor through a Windows app: a pushed new row is refused whatever it holds (the web version computes its own)
      const id = uuidv7();
      const now = new Date().toISOString();
      const push = await who.client.post(`/sync/push`, { org_id: e.org, device_id: uuidv7(), protocol: SYNC_PROTOCOL, aggregates: [{ entity: key, id, base_rev: 0, row: { id, org_id: e.org, created_at: now, updated_at: now }, children: {} }] });
      expect(push.results[0].status, `${key} pushed by ${who.role}`).toBe("error");
      expect(await e.db.one(`select 1 from ${def.table} where id = $1`, [id]), key).toBeNull();
      // nor to the organisation's owner, who may create everything people create
      expect((await e.owner.get(`${P}/meta/tables/${key}`)).table.can.create, `${key} for the owner`).toBe(false);
      await e.owner.post(`${P}/r/${key}`, {}, 403);
    }
    // the owner still sees «… تازه» where people write
    expect((await e.owner.get(`${P}/meta/tables/incident`)).table.can.create).toBe(true);
    expect((await e.owner.get(`${P}/meta/tables/analytics_indicator`)).table.can.create).toBe(true);
  }, 600_000);
});
