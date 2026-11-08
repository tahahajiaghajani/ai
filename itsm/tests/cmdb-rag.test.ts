// CIs and services as retrieval documents (docs/spec/AI.md): the CI's class, identity and class attributes, the
// service's own words (never other records' names), indexed and retrieved only for people who may read the record.
import { beforeAll, describe, expect, it } from "vitest";
import { buildDocument, indexNow, isRagTable, retrieve } from "@server/modules/ai/rag";
import { tableDef } from "@shared/tables";
import { cmdbWorld, type CmdbWorld } from "./cmdb-helpers";

let w: CmdbWorld;
let ci: Record<string, any>;
let svc: Record<string, any>;
let blind: string;
const R = (t: string, id?: string) => `${w.P}/r/${t}${id ? `/${id}` : ""}`;

beforeAll(async () => {
  w = await cmdbWorld();
  ci = await w.ci({ name: "srv-rag-01", class: "server", serial_number: "RAG-1", os: "Ubuntu", os_version: "24.04", attrs: { rack_u: 2 } });
  svc = (await w.o.post(R("service"), { name: "پیام‌رسان سازمانی", name_en: "Corporate messenger", description: "پیام‌رسانی امن کارکنان با رمزنگاری سرتاسری", owner_id: w.p.so.userId })).row;
  await w.o.put(`${w.P}/access/roles/rag_blind`, { name: "بدون سبد", description: "", persona: "agent", grants: { cmdb: { read: "all", write: "none", delete: "none", create: false, approve: false, admin: false } }, field_groups: [], contains: [], workspaces: "member", domains: "own", active: true });
  const m = await w.e.member("member", "rag-blind@example.com");
  await w.o.put(`${w.P}/access/members/${m.userId}`, { roles: ["rag_blind"], persona: "agent" });
  blind = m.userId;
}, 120_000);

describe("retrieval documents", () => {
  it("describe a CI by its class, identity and class attributes, and a service by its own words", async () => {
    expect(isRagTable(tableDef("ci"))).toBe(true);
    expect(isRagTable(tableDef("service"))).toBe(true);
    const ciRow = (await w.o.get(R("ci", ci.id))).row;
    const doc = await buildDocument({ ctx: w.sys, q: w.e.db, def: tableDef("ci")!, row: ciRow });
    const text = doc!.parts.map((p) => p.text).join("\n");
    expect(text).toContain("کلاس: سرور");
    expect(text).toContain("Ubuntu 24.04");
    expect(doc!.title).toBe("srv-rag-01");
    const svcRow = (await w.o.get(R("service", svc.id))).row;
    const sdoc = await buildDocument({ ctx: w.sys, q: w.e.db, def: tableDef("service")!, row: svcRow });
    expect(sdoc!.title).toBe("پیام‌رسان سازمانی — Corporate messenger");
    expect(sdoc!.parts.map((p) => p.field)).toEqual(expect.arrayContaining(["service_type", "description"]));
  });

  it("finds a service by its description only for people who may read it", async () => {
    await indexNow(w.e.cfg, w.e.org, "service", svc.id, { force: true });
    const owner = await w.e.ctxOf(w.e.ownerId);
    const hit = await retrieve(owner, "پیام‌رسانی امن کارکنان");
    expect(hit.passages.map((p) => p.citation.id)).toContain(svc.id);
    const other = await w.e.ctxOf(blind);
    const miss = await retrieve(other, "پیام‌رسانی امن کارکنان");
    expect(miss.passages.map((p) => p.citation.id)).not.toContain(svc.id);
  });
});
