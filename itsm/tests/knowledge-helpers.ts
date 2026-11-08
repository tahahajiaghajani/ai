// Shared set-up of the knowledge tests: an organisation on an in-memory server with the incident and knowledge defaults,
// a knowledge manager («مدیران دانش»), a service-desk agent («میز خدمت»), an agent of another group, two requesters,
// an auditor and an HR agent, each holding the built-in ITSM role and signed in; helpers to write, submit, approve and
// publish articles.
import { engineOrg, type EngineOrg } from "./engine-helpers";
import type { Client } from "./helpers";
import { tick } from "@server/jobs";
import { systemCtx } from "@server/engine";
import type { Ctx } from "@server/context";

export type Who = "km" | "agent" | "other" | "req" | "req2" | "auditor" | "hr";

export interface KbWorld {
  e: EngineOrg;
  P: string;
  o: Client;
  p: Record<Who, { client: Client; userId: string }>;
  g: { desk: string; network: string; managers: string };
  bases: { guide: string; agents: string; ke: string };
  sys: Ctx;
  drain(): Promise<void>;
  /** create an article with its first draft (as `as`, default the knowledge manager) */
  article(data: Record<string, unknown>, as?: Client): Promise<{ article: Record<string, any>; version: Record<string, any> }>;
  /** submit a version for review / publication */
  submit(versionId: string, as?: Client): Promise<Record<string, any>>;
  /** decide the caller's pending approval of a record */
  decide(as: Client, table: string, recordId: string, decision?: "approved" | "rejected", comment?: string): Promise<void>;
  /** write, submit and approve: a published article (the knowledge manager writes, the owner approves when asked) */
  published(data: Record<string, unknown>, as?: Client): Promise<Record<string, any>>;
}

const ROLES: Record<Who, string> = { km: "knowledge_manager", agent: "agent", other: "agent", req: "requester", req2: "requester", auditor: "auditor", hr: "hr_agent" };

export async function kbWorld(): Promise<KbWorld> {
  const e = await engineOrg();
  const P = `/o/${e.org}`;
  const o = e.owner;
  await o.post(`${P}/incident/seed`, {});
  await o.post(`${P}/knowledge/seed`, {});
  const groups = (await o.get(`${P}/r/group?size=50`)).rows as { id: string; name: string }[];
  const desk = groups.find((x) => x.name === "میز خدمت")!.id;
  const managers = groups.find((x) => x.name === "مدیران دانش")!.id;
  const network = (await o.post(`${P}/r/group`, { name: "پشتیبانی شبکه", types: ["assignment"] })).row.id as string;
  const p = {} as KbWorld["p"];
  for (const k of Object.keys(ROLES) as Who[]) {
    p[k] = await e.member("member", `${k}@example.com`);
    await o.put(`${P}/access/members/${p[k].userId}`, { roles: [ROLES[k]], persona: k.startsWith("req") ? "requester" : "agent" });
  }
  await o.post(`${P}/access/groups/${desk}/members`, { user_ids: [p.agent.userId] });
  await o.post(`${P}/access/groups/${network}/members`, { user_ids: [p.other.userId] });
  await o.post(`${P}/access/groups/${managers}/members`, { user_ids: [p.km.userId, e.ownerId] });
  const bases = (await o.get(`${P}/r/kb_base?size=50`)).rows as { id: string; name: string }[];
  const sys = await systemCtx(e.cfg, e.org);
  const drain = async () => {
    for (let i = 0; i < 30; i++) {
      const r = await tick(e.cfg, { budgetMs: 30_000 });
      if (!r.ran && !r.more) break;
    }
  };
  await drain();
  const w: KbWorld = {
    e, P, o, p, sys, drain,
    g: { desk, network, managers },
    bases: { guide: bases.find((b) => b.name === "راهنمای کاربران")!.id, agents: bases.find((b) => b.name === "دانش کارشناسان")!.id, ke: bases.find((b) => b.name === "خطاهای شناخته‌شده")!.id },
    async article(data, as = p.km.client) {
      return as.post(`${P}/knowledge/articles`, { base_id: w.bases.guide, title: "مقالهٔ آزمایشی", body: "## گام‌ها\n\n1. یک کار\n2. کار دیگر\n", ...data });
    },
    async submit(versionId, as = p.km.client) {
      return (await as.post(`${P}/knowledge/versions/${versionId}/submit`, {})).row;
    },
    async decide(as, table, recordId, decision = "approved", comment) {
      const mine = (await as.get(`${P}/approvals/mine`)).approvals as { id: string; table_key: string; record_id: string }[];
      const a = mine.find((x) => x.table_key === table && x.record_id === recordId);
      if (!a) throw new Error(`no pending approval of ${table} ${recordId}`);
      await as.post(`${P}/approvals/${a.id}/decide`, { decision, comment: comment ?? null });
      await drain();
    },
    async published(data, as = p.km.client) {
      const r = await w.article(data, as);
      const v = await w.submit(r.version.id, as);
      if (v.state === "in_review") {
        // the base's approvers: the managers' group (the knowledge manager) or the owner
        const approver = as === p.km.client ? o : p.km.client;
        await w.decide(approver, "kb_version", r.version.id);
      }
      await drain();
      return (await o.get(`${P}/r/kb_article/${r.article.id}`)).row;
    },
  };
  return w;
}

/** Move a timestamp column of a row into the past (test set-up only). */
export async function backdate(e: EngineOrg, table: string, id: string, column: string, daysAgo: number): Promise<void> {
  await e.db.query(`update ${table} set ${column} = now() - ($2 || ' days')::interval where id = $1`, [id, String(daysAgo)]);
}

/** The HTTP status of a request (the client throws on any status but the expected one). */
export async function statusOf(c: Client, method: string, path: string, body?: unknown): Promise<number> {
  try {
    await c.req(method, path, body ?? (method === "GET" ? undefined : {}), 200);
    return 200;
  } catch (e) {
    const m = /→ (\d{3})/.exec(String(e));
    return m ? Number(m[1]) : 0;
  }
}
