// The AI index over attachments (`ai.attachments`, KB-010): the text of a record's attached files is indexed with the
// record — a part per file, cited to the record — and answers only those who may read the record; removing the file
// takes its text out; tables without the option never index attachments; images and unknown files are skipped.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerTable } from "@shared/tables";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { addAttachment, create, listAttachments, removeAttachment, systemCtx } from "@server/engine";
import { tick } from "@server/jobs";
import type { Ctx } from "@server/context";
import { retrieve } from "@server/modules/ai/rag";

registerTable({
  key: "rag_case",
  table: "sm_rag_cases",
  label: "پروندهٔ آزمایشی",
  plural: "پرونده‌های آزمایشی",
  icon: "ticket",
  module: "test",
  area: "incident",
  extends: "task",
  numbered: { prefix: "RGC", pad: 5 },
  display: "short_description",
  fields: [],
  scope: {},
  features: { attachments: true, rag: true },
  ai: { title: "short_description", text: ["description"], attachments: true },
});
registerTable({
  key: "rag_plain",
  table: "sm_rag_plains",
  label: "پروندهٔ بی‌پیوست",
  plural: "پرونده‌های بی‌پیوست",
  icon: "ticket",
  module: "test",
  area: "incident",
  extends: "task",
  display: "short_description",
  fields: [],
  scope: {},
  features: { attachments: true, rag: true },
  ai: { title: "short_description", text: ["description"] },
});

const before = process.env.ITSM_AI_FAKE;
let e: EngineOrg;
let sys: Ctx;
let owner: Ctx;
let caller: Ctx;
let stranger: Ctx;

const run = async () => {
  for (let i = 0; i < 10; i++) {
    const r = await tick(e.cfg, { budgetMs: 20_000 });
    if (!r.more && !r.ran) break;
  }
};
const text = (s: string) => new TextEncoder().encode(s);
const found = async (ctx: Ctx, q: string) => (await retrieve(ctx, q, { tables: ["rag_case", "rag_plain"], k: 10 })).passages;

beforeAll(async () => {
  process.env.ITSM_AI_FAKE = "1";
  e = await engineOrg();
  sys = await systemCtx(e.cfg, e.org);
  owner = await e.ctxOf(e.ownerId);
  const a = await e.member("member", "rag-caller@example.com");
  const b = await e.member("member", "rag-stranger@example.com");
  for (const m of [a, b]) await e.owner.put(`/o/${e.org}/access/members/${m.userId}`, { roles: ["requester"], persona: "requester" });
  caller = await e.ctxOf(a.userId);
  stranger = await e.ctxOf(b.userId);
});

afterAll(() => {
  if (before === undefined) delete process.env.ITSM_AI_FAKE;
  else process.env.ITSM_AI_FAKE = before;
});

describe("attachments in the AI index", () => {
  let caseId = "";
  let fileId = "";

  it("indexes the text of attached files with the record, cited to it, for those who may read it", async () => {
    caseId = (await create(sys, "rag_case", { short_description: "چاپگر مالی کار نمی‌کند", description: "از صبح", caller_id: caller.user.id })).row.id as string;
    const f = await addAttachment(owner, "rag_case", caseId, { name: "راهنما.txt", type: "text/plain", data: text("برای رفع خطای زرکوب‌واژه کابل شبکهٔ چاپگر را جدا و وصل کنید.") });
    fileId = f.id;
    await addAttachment(owner, "rag_case", caseId, { name: "screenshot.png", type: "image/png", data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]) });
    await run();
    // (short parts of one group share a chunk)
    const chunks = await e.db.query<{ fields: string[]; groups: string[]; text: string }>(`select fields, groups, text from sm_ai_chunks where record_id = $1 and kind = 'chunk' order by ord`, [caseId]);
    const att = chunks.find((c) => c.fields.includes(`attachment:${fileId}`))!;
    expect(att.groups).toEqual([]);
    expect(att.text).toContain("زرکوب‌واژه");
    expect(chunks.flatMap((c) => c.fields).filter((f) => f.startsWith("attachment:"))).toEqual([`attachment:${fileId}`]);
    // the caller reads their case: the attachment answers them, cited to the case
    const mine = await found(caller, "زرکوب‌واژه");
    expect(mine.map((p) => p.citation.id)).toContain(caseId);
    expect((await found(owner, "زرکوب‌واژه")).map((p) => p.citation.id)).toContain(caseId);
    // someone who may not read the case gets nothing from its files
    expect(await found(stranger, "زرکوب‌واژه")).toEqual([]);
  });

  it("removing the file takes its text out of the index", async () => {
    await removeAttachment(owner, "rag_case", caseId, fileId);
    await run();
    expect((await listAttachments(owner, "rag_case", caseId)).attachments.map((a) => a.name)).toEqual(["screenshot.png"]);
    const chunks = await e.db.query<{ fields: string[]; text: string }>(`select fields, text from sm_ai_chunks where record_id = $1 and kind = 'chunk'`, [caseId]);
    expect(chunks.flatMap((c) => c.fields).some((f) => f.startsWith("attachment:"))).toBe(false);
    expect(chunks.map((c) => c.text).join(" ")).not.toContain("زرکوب‌واژه");
    expect(await found(caller, "زرکوب‌واژه")).toEqual([]);
  });

  it("tables without `ai.attachments` never index attachments", async () => {
    const id = (await create(sys, "rag_plain", { short_description: "پروندهٔ دیگر", description: "متن پرونده", caller_id: caller.user.id })).row.id as string;
    await addAttachment(owner, "rag_plain", id, { name: "note.txt", type: "text/plain", data: text("واژهٔ نهان گلبرگ‌سنگ در پیوست") });
    await run();
    const chunks = await e.db.query<{ fields: string[]; text: string }>(`select fields, text from sm_ai_chunks where record_id = $1 and kind = 'chunk'`, [id]);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.flatMap((c) => c.fields).some((f) => f.startsWith("attachment:"))).toBe(false);
    expect(await found(owner, "گلبرگ‌سنگ")).toEqual([]);
  });
});
