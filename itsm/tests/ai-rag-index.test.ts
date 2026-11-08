// The AI index end to end on PGlite: record events index records (chunks per field group, never ai_private or
// secrets, redacted fields masked, access anchors and version kept), unchanged text is skipped by its hash, deletes
// leave the index, stale chunks are not served until re-indexed; hybrid retrieval (full text, LIKE, local and provider
// vectors) with pgvector and with the portable store (same answers); provider embeddings through the fake model with
// usage, holds and the rag.embed catch-up; re-embedding when the model changes; nightly reconciliation (orphans,
// missing records, moved anchors, unknown tables).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "./fixtures/rag";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { create, remove, systemCtx, update } from "@server/engine";
import { tick } from "@server/jobs";
import type { Ctx } from "@server/context";
import {
  activeEmbedder, ensureAnnIndexes, forceStoreBackend, indexNow, queueBackfill, reconcile, indexSession, retrieve, setAnnMinRows, storeBackend, RAG_JOBS,
} from "@server/modules/ai/rag";

const before = process.env.ITSM_AI_FAKE;
let e: EngineOrg;
let sys: Ctx;
let owner: Ctx;

const chunksOf = (id: string) =>
  e.db.query<{ id: string; field: string; groups: string[]; text: string; version: number; vec_key: string | null; unit_id: string | null; workspace_id: string | null }>(
    `select id, field, groups, text, version, vec_key, unit_id, workspace_id from sm_ai_chunks where record_id = $1 and kind = 'chunk' order by ord`,
    [id],
  );
const stateOf = (id: string) => e.db.one<{ status: string; version: number; hash: string; vec_key: string | null; vec_pending: boolean; chunks: number }>(`select * from sm_ai_rag_docs where record_id = $1`, [id]);
const run = async () => {
  for (let i = 0; i < 10; i++) {
    const r = await tick(e.cfg, { budgetMs: 20_000 });
    if (!r.more && !r.ran) break;
  }
};
const ticket = async (data: Record<string, unknown>) => (await create(sys, "rag_ticket", { short_description: "تیکت", ...data })).row.id as string;

beforeAll(async () => {
  process.env.ITSM_AI_FAKE = "1";
  e = await engineOrg();
  sys = await systemCtx(e.cfg, e.org);
  owner = await e.ctxOf(e.ownerId);
});

afterAll(() => {
  if (before === undefined) delete process.env.ITSM_AI_FAKE;
  else process.env.ITSM_AI_FAKE = before;
});

describe("indexing", () => {
  it("uses pgvector in PGlite (vector columns added at startup of the index)", async () => {
    const b = await storeBackend(e.db);
    expect(b.kind).toBe("pgvector");
    expect(b.version).toMatch(/^0\.\d+/);
    const cols = await e.db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'sm_ai_chunks' and column_name in ('lvec_v', 'vec_v')`);
    expect(cols.map((c) => c.column_name).sort()).toEqual(["lvec_v", "vec_v"]);
  });

  it("indexes a record from its events: one partition per field group, never ai_private or secrets, redacted fields masked", async () => {
    const id = await ticket({
      short_description: "قطعی ایمیل ساختمان مرکزی",
      description: "کاربران طبقهٔ سوم ایمیل دریافت نمی‌کنند.",
      diagnosis: "گواهی سرور Exchange منقضی شده است.",
      salary_note: "اضافه‌کار شب برای تیم شبکه.",
      private_note: "این متن هرگز نباید نمایه شود.",
      token: "s3cr3t-token",
      national_code: "0012345679",
    });
    await run();
    const chunks = await chunksOf(id);
    expect(chunks.map((c) => [c.field, c.groups])).toEqual([
      ["description", []],
      ["diagnosis", ["internal"]],
      ["salary_note", ["hr"]],
    ]);
    const all = JSON.stringify(await e.db.query(`select text, norm from sm_ai_chunks where record_id = $1`, [id]));
    expect(all).not.toContain("هرگز نباید");
    expect(all).not.toContain("s3cr3t");
    const st = await stateOf(id);
    expect(st).toMatchObject({ status: "ok", chunks: 3, vec_pending: false });
    expect(chunks.every((c) => c.version === st!.version)).toBe(true);
  });

  it("masks fields marked ai.redact before they are indexed", async () => {
    const id = await ticket({ short_description: "درخواست کارت ورود", national_code: "0012345679", description: "کارت گم شده است" });
    await indexNow(e.cfg, e.org, "rag_ticket", id);
    // national_code is not in ai.text but marked ai.index: indexed masked
    const texts = (await e.db.query<{ text: string }>(`select text from sm_ai_chunks where record_id = $1`, [id])).map((r) => r.text).join(" ");
    expect(texts).toContain("***5679");
    expect(texts).not.toContain("0012345679");
  });

  it("skips unchanged text by its hash (only the version moves) and re-chunks changed text", async () => {
    const id = await ticket({ short_description: "چاپگر طبقهٔ دوم", description: "کاغذ گیر می‌کند." });
    await run();
    const first = await chunksOf(id);
    await update(sys, "rag_ticket", id, { priority: 2 });
    await run();
    const second = await chunksOf(id);
    expect(second.map((c) => c.id)).toEqual(first.map((c) => c.id));
    expect(second[0].version).toBe(first[0].version + 1);
    await update(sys, "rag_ticket", id, { description: "تونر چاپگر تمام شده است." });
    await run();
    const third = await chunksOf(id);
    expect(third[0].id).not.toBe(first[0].id);
    expect(third[0].text).toBe("تونر چاپگر تمام شده است.");
  });

  it("removes deleted records from the index", async () => {
    const id = await ticket({ short_description: "حذف‌شدنی", description: "این تیکت حذف می‌شود" });
    await run();
    expect((await chunksOf(id)).length).toBe(1);
    await remove(sys, "rag_ticket", id);
    await run();
    expect(await chunksOf(id)).toEqual([]);
    expect(await stateOf(id)).toBeNull();
  });
});

describe("retrieval", () => {
  let printer = "";
  let vpn = "";
  beforeAll(async () => {
    printer = await ticket({ short_description: "خرابی چاپگر حسابداری", description: "چاپگرهای واحد حسابداری کاغذ را مچاله می‌کنند؛ غلتک باید تعویض شود." });
    vpn = await ticket({ short_description: "VPN connection drops", description: "The VPN client disconnects every ten minutes; reinstalling the client fixed it." });
    await run();
  });

  it("finds Persian records by stemmed full text and English ones by words", async () => {
    const r = await retrieve(owner, "چاپگر حسابداری کاغذ");
    expect(r.passages[0].citation.id).toBe(printer);
    expect(r.passages[0].citation).toMatchObject({ table: "rag_ticket", table_label: "تیکت آزمایشی", title: "خرابی چاپگر حسابداری", field: "description", field_label: "شرح", path: `r/rag_ticket/${printer}` });
    expect(r.passages[0].citation.number).toMatch(/^RAG\d{5}$/);
    expect(r.info.lists.fts).toBeGreaterThan(0);
    const en = await retrieve(owner, "vpn disconnects");
    expect(en.passages[0].citation.id).toBe(vpn);
  });

  it("matches spelling variants (Arabic letters, joined suffixes) through normalisation and local vectors", async () => {
    const r = await retrieve(owner, "چاپگرهاي حسابداري");
    expect(r.passages.map((p) => p.citation.id)).toContain(printer);
    expect(r.info.quality).toBe("local");
    expect(r.info.backend).toBe("pgvector");
  });

  it("never serves a chunk of an older version (fail closed until the record is re-indexed)", async () => {
    // the record moves on without its event being processed yet
    await e.db.query(`update sm_rag_tickets set version = version + 1 where id = $1`, [printer]);
    const stale = await retrieve(owner, "چاپگر حسابداری");
    expect(stale.passages.map((p) => p.citation.id)).not.toContain(printer);
    await indexNow(e.cfg, e.org, "rag_ticket", printer);
    const fresh = await retrieve(owner, "چاپگر حسابداری");
    expect(fresh.passages.map((p) => p.citation.id)).toContain(printer);
  });

  it("refuses to run as the system", async () => {
    await expect(retrieve(sys, "چاپگر")).rejects.toThrow(/asking member/);
  });

  it("narrows to tables and records of the scope", async () => {
    const r = await retrieve(owner, "چاپگر", { records: [{ table: "rag_ticket", id: vpn }] });
    expect(r.passages.every((p) => p.citation.id === vpn)).toBe(true);
    expect((await retrieve(owner, "چاپگر", { tables: ["todo"] })).passages.every((p) => p.citation.table === "todo")).toBe(true);
  });

  it("returns no local-vector noise for a question the index holds nothing about, but a chosen record still answers", async () => {
    const off = await retrieve(owner, "دستور پخت قورمه سبزی");
    expect(off.passages).toEqual([]);
    expect(off.info.lists.local).toBe(0);
    // a record the member chose answers whatever the words (e.g. «summarise this»)
    const scoped = await retrieve(owner, "دستور پخت قورمه سبزی", { records: [{ table: "rag_ticket", id: vpn }] });
    expect(scoped.passages.length).toBeGreaterThan(0);
    expect(scoped.passages.every((p) => p.citation.id === vpn)).toBe(true);
  });
});

describe("provider embeddings", () => {
  let id = "";
  it("embeds chunks with the organisation's model (usage recorded) and searches its vectors", async () => {
    const { connection } = await e.owner.post(`/o/${e.org}/ai/connections`, { preset: "fake", embed: { model: "fake-embed", dims: 32 } });
    expect(connection.embed).toEqual({ model: "fake-embed", dims: 32, api: "fake" });
    expect((await activeEmbedder(owner))?.key).toBe("fake:fake-embed:32");
    await run(); // rag.embed fills the chunks indexed before the model existed
    const missing = await e.db.one<{ n: number }>(`select count(*)::int as n from sm_ai_chunks where org_id = $1 and kind = 'chunk' and (vec_key is null or vec_key <> 'fake:fake-embed:32')`, [e.org]);
    expect(missing!.n).toBe(0);
    id = await ticket({ short_description: "شبکهٔ بی‌سیم سالن", description: "اتصال وای‌فای سالن همایش قطع و وصل می‌شود." });
    await run();
    expect((await chunksOf(id))[0].vec_key).toBe("fake:fake-embed:32");
    const r = await retrieve(owner, "وای‌فای سالن همایش");
    expect(r.info.quality).toBe("provider");
    expect(r.info.lists.vector).toBeGreaterThan(0);
    expect(r.passages[0].citation.id).toBe(id);
    const usage = await e.db.one<{ n: number }>(`select count(*)::int as n from sm_ai_usage where org_id = $1 and feature = 'rag_embed' and ok`, [e.org]);
    expect(usage!.n).toBeGreaterThan(1);
  });

  it("keeps a record with local vectors when the model is rate-limited, holds the model and catches up later", async () => {
    const bad = await ticket({ short_description: "آزمون سقف", description: "[embed-error:rate] متن این تیکت" });
    await run();
    expect(await stateOf(bad)).toMatchObject({ status: "ok", vec_pending: true });
    expect((await chunksOf(bad))[0].vec_key).toBeNull();
    const hold = await e.db.one<{ kind: string }>(`select kind from sm_ai_holds where org_id = $1 and model = 'fake-embed'`, [e.org]);
    expect(hold?.kind).toBe("rate");
    // still findable by full text and the local vector meanwhile
    expect((await retrieve(owner, "آزمون سقف")).passages.map((p) => p.citation.id)).toContain(bad);
    const job = await e.db.one<{ status: string }>(`select status from sm_jobs where org_id = $1 and kind = $2 order by created_at desc limit 1`, [e.org, RAG_JOBS.embed]);
    expect(job?.status).toBe("queued");
  });

  it("re-embeds everything when the embedding model changes", async () => {
    // the provider answers again
    await e.db.query(`delete from sm_ai_holds where org_id = $1`, [e.org]);
    const bad = (await e.db.one<{ record_id: string }>(`select record_id from sm_ai_chunks where org_id = $1 and text like '%embed-error%'`, [e.org]))!.record_id;
    await update(sys, "rag_ticket", bad, { description: "متن این تیکت اکنون درست است" });
    const { connections } = await e.owner.get(`/o/${e.org}/ai/connections`);
    await e.owner.patch(`/o/${e.org}/ai/connections/${connections[0].id}`, { embed: { model: "fake-embed", dims: 48 } });
    await e.db.query(`update sm_jobs set run_at = now() where org_id = $1 and kind = $2 and status = 'queued'`, [e.org, RAG_JOBS.embed]);
    await run();
    const keys = await e.db.query<{ vec_key: string | null; n: number }>(`select vec_key, count(*)::int as n from sm_ai_chunks where org_id = $1 and kind = 'chunk' group by vec_key`, [e.org]);
    expect(keys).toEqual([{ vec_key: "fake:fake-embed:48", n: expect.any(Number) }]);
    expect(await stateOf(bad)).toMatchObject({ vec_pending: false, vec_key: "fake:fake-embed:48" });
  });
});

describe("approximate neighbours", () => {
  it("creates HNSW indexes per embedding model and for the local vectors once large enough, and searches through them", async () => {
    setAnnMinRows(1);
    try {
      const made = await ensureAnnIndexes(e.db, await storeBackend(e.db));
      expect(made).toContain("sm_ai_chunks_lvec_hnsw");
      expect(made.some((n) => /^sm_ai_chunks_vec_[0-9a-f]+_hnsw$/.test(n))).toBe(true);
      const idx = await e.db.query<{ indexdef: string }>(`select indexdef from pg_indexes where indexname = any($1::text[])`, [`{${made.join(",")}}`]);
      expect(idx.map((i) => i.indexdef).join("\n")).toMatch(/USING hnsw/);
      // ensureAnnIndexes forgets the cached "no index" answer: this query goes through HNSW (iterative scan)
      const r = await retrieve(owner, "وای‌فای سالن همایش");
      expect(r.passages.length).toBeGreaterThan(0);
    } finally {
      setAnnMinRows(20_000);
    }
  });
});

describe("reconciliation", () => {
  it("removes orphans and unknown tables, indexes what is missing, re-keys moved anchors", async () => {
    const s = await indexSession(e.cfg, e.org);
    const a = await ticket({ short_description: "بدون رویداد", description: "این تیکت بی‌رویداد ساخته شد" });
    // not indexed yet (its event not delivered) and an orphan of a vanished record and table
    await e.db.query(`insert into sm_ai_rag_docs (id, org_id, table_key, record_id, version, status) values (gen_random_uuid(), $1, 'rag_ticket', gen_random_uuid(), 1, 'ok'), (gen_random_uuid(), $1, 'gone_table', gen_random_uuid(), 1, 'ok')`, [e.org]);
    const unit = (await e.owner.post(`/o/${e.org}/r/org_unit`, { name: "واحد جابه‌جا" })).row.id as string;
    const moved = await ticket({ short_description: "جابه‌جا", description: "تیکتی که واحدش عوض می‌شود" });
    await run();
    await e.db.query(`update sm_rag_tickets set unit_id = $2 where id = $1`, [moved, unit]);
    const r = await reconcile(s, { deadline: Date.now() + 20_000 });
    expect(r.stats.unknown).toBe(1);
    expect(r.stats.removed).toBe(1);
    expect(r.stats.rekeyed).toBeGreaterThanOrEqual(1);
    expect((await chunksOf(a)).length).toBe(1);
    expect((await chunksOf(moved))[0].unit_id).toBe(unit);
  });

  it("rebuilds a table on demand (rag.backfill)", async () => {
    await e.db.query(`delete from sm_ai_chunks where org_id = $1 and table_key = 'rag_ticket'`, [e.org]);
    await e.db.query(`delete from sm_ai_rag_docs where org_id = $1 and table_key = 'rag_ticket'`, [e.org]);
    await queueBackfill(e.db, e.org, { table: "rag_ticket", force: true });
    await run();
    const n = await e.db.one<{ n: number }>(`select count(*)::int as n from sm_ai_rag_docs where org_id = $1 and table_key = 'rag_ticket'`, [e.org]);
    const live = await e.db.one<{ n: number }>(`select count(*)::int as n from sm_rag_tickets where org_id = $1 and deleted_at is null`, [e.org]);
    expect(n!.n).toBe(live!.n);
    const runs = await e.db.query<{ kind: string; finished_at: string | null }>(`select kind, finished_at from sm_ai_rag_runs where org_id = $1`, [e.org]);
    expect(runs.some((x) => x.kind === "backfill:rag_ticket" && x.finished_at)).toBe(true);
  });
});

describe("portable store (no pgvector): same answers", () => {
  it("finds the same records with float arrays compared in the server", async () => {
    const p = await engineOrg();
    forceStoreBackend(p.db, "portable");
    expect((await storeBackend(p.db)).kind).toBe("portable");
    const psys = await systemCtx(p.cfg, p.org);
    const pv = await create(psys, "rag_ticket", { short_description: "خرابی چاپگر حسابداری", description: "چاپگرهای واحد حسابداری کاغذ را مچاله می‌کنند؛ غلتک باید تعویض شود." });
    const other = await create(psys, "rag_ticket", { short_description: "VPN connection drops", description: "The VPN client disconnects every ten minutes." });
    for (let i = 0; i < 5; i++) await tick(p.cfg, { budgetMs: 20_000 });
    const lvec = await p.db.one<{ n: number }>(`select count(*)::int as n from sm_ai_chunks where org_id = $1 and lvec is not null`, [p.org]);
    expect(lvec!.n).toBe(2);
    const pctx = await p.ctxOf(p.ownerId);
    const a = await retrieve(pctx, "چاپگرهاي حسابداري");
    expect(a.info.backend).toBe("portable");
    expect(a.passages[0].citation.id).toBe(pv.row.id);
    expect((await retrieve(pctx, "vpn disconnects")).passages[0].citation.id).toBe(other.row.id);
  });
});
