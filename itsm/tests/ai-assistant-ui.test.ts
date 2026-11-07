// «دستیار» (the assistant) UI logic (no browser): the SSE reader and the client's continue/reconnect loop, how stream events
// build the conversation, safe links, page context, suggested prompts, figures, attachments and the thread list.
import { describe, expect, it } from "vitest";
import type { AiProposal, AiStreamEvent } from "@shared/ai/types";
import { ApiError, type OrgApi } from "../src/ui/lib/api";
import { SseParser, aiClient, errorEvent, readFrames, toStreamEvent } from "../src/ui/ai/client";
import { applyEvent, blankMessage, fromView, knownRefs, settle, withProposal, type UiMessage } from "../src/ui/ai/assistant/state";
import { resolveHref, safePath } from "../src/ui/ai/markdown/links";
import { REPORT_PAGES, RECORD_ROUTES, pageContext, titleOf } from "../src/ui/ai/assistant/context";
import { APP_NAME } from "@shared/constants";
import { BY_PAGE, RECORD, S, looksLikeQuestion, promptName, suggestionsFor } from "../src/ui/ai/assistant/prompts";
import { decimalParts, figureText, isNumeric, toNumber } from "../src/ui/ai/assistant/format";
import { MAX_FILES, MAX_PDF, overTotal, refuseFile } from "../src/ui/ai/assistant/attach";
import { groupThreads } from "../src/ui/ai/assistant/threads-model";

const UUID = "3f8a2c10-5b7e-4d21-9c4a-1e2f3a4b5c6d";

// ---------------------------------------------------------------- SSE

describe("SseParser", () => {
  it("joins chunks, ignores heartbeats and handles CRLF split across chunks", () => {
    const p = new SseParser();
    const out = [
      ...p.push(": ping\n\nevent: text\ndata: {\"type\":\"text\",\"delta\":\"سل"),
      ...p.push("ام\"}\r"),
      ...p.push("\n\r\ndata: a\ndata: b\n\n"),
    ];
    expect(p.comments).toBe(1);
    expect(out).toEqual([
      { event: "text", data: '{"type":"text","delta":"سلام"}', id: undefined },
      { event: "message", data: "a\nb", id: undefined },
    ]);
  });

  it("dispatches a last event without a trailing blank line at the end of the stream", () => {
    const p = new SseParser();
    expect(p.push('data: {"type":"done"}')).toEqual([]);
    expect(p.end()).toEqual([{ event: "message", data: '{"type":"done"}', id: undefined }]);
  });

  it("reads typed events, takes the type from `event:` when the JSON has none, drops junk", () => {
    expect(toStreamEvent({ event: "message", data: '{"type":"text","delta":"x"}' })).toEqual({ type: "text", delta: "x" });
    expect(toStreamEvent({ event: "usage", data: '{"input":1,"output":2,"cache_read":0,"cache_write":0,"cost_usd":null}' })?.type).toBe("usage");
    expect(toStreamEvent({ event: "text", data: '{"delta":3}' })).toBeNull();
    expect(toStreamEvent({ event: "ping", data: "{}" })).toBeNull();
    expect(toStreamEvent({ event: "message", data: "{broken" })).toBeNull();
    expect(toStreamEvent({ event: "message", data: "[1]" })).toBeNull();
  });

  it("readFrames reports activity on every chunk", async () => {
    let ticks = 0;
    const frames = [];
    for await (const f of readFrames(body([": ping\n\n", 'data: {"type":"text","delta":"a"}\n\n']), () => ticks++)) frames.push(f);
    expect(ticks).toBe(2);
    expect(frames).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- client: continue, reconnect, refusals

function body(chunks: string[], hang = false): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const k of chunks) c.enqueue(enc.encode(k));
      if (!hang) c.close();
    },
  });
}
const sse = (events: AiStreamEvent[]) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);

function fakeApi(script: ((path: string, b: unknown) => Response | Promise<Response>)[]) {
  const calls: { path: string; body: unknown }[] = [];
  const api = {
    stream: async (path: string, b: unknown, signal?: AbortSignal) => {
      calls.push({ path, body: b });
      const step = script.shift();
      if (!step) throw new Error("unexpected request");
      const res = await step(path, b);
      signal?.addEventListener("abort", () => res.body?.cancel().catch(() => {}));
      return res;
    },
  } as unknown as OrgApi;
  return { api, calls };
}

describe("aiClient.chat", () => {
  it("follows `continue` into /threads/:id/continue and ends on `done`", async () => {
    const { api, calls } = fakeApi([
      () => new Response(body(sse([{ type: "meta", thread_id: "t1", message_id: "m1", model: "x", connection: null }, { type: "text", delta: "یک" }, { type: "continue", thread_id: "t1" }]))),
      () => new Response(body(sse([{ type: "text", delta: " دو" }, { type: "done", message_id: "m1", stop: "end" }]))),
    ]);
    const events: AiStreamEvent[] = [];
    const phases: string[] = [];
    const r = await aiClient(api).chat({ text: "سلام" }, { onEvent: (e) => events.push(e), onPhase: (p) => phases.push(p) }, new AbortController().signal);
    expect(calls.map((c) => c.path)).toEqual(["/ai/chat", "/ai/threads/t1/continue"]);
    expect(r).toMatchObject({ threadId: "t1", aborted: false, resync: false, done: { stop: "end" } });
    expect(events.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join("")).toBe("یک دو");
    expect(phases).toEqual(["connecting", "streaming", "continuing", "streaming"]);
  });

  it("resumes a dropped connection from the stored steps", async () => {
    const { api, calls } = fakeApi([
      () => new Response(body(sse([{ type: "meta", thread_id: "t9", message_id: "m1", model: null, connection: null }, { type: "text", delta: "نیمه" }]))),
      () => new Response(body(sse([{ type: "done", message_id: "m1", stop: "end" }]))),
    ]);
    const r = await aiClient(api).chat({ text: "q" }, { onEvent: () => {} }, new AbortController().signal, { retries: 1 });
    expect(calls[1].path).toBe("/ai/threads/t9/continue");
    expect(r.done?.stop).toBe("end");
  });

  it("turns a refused request into an error event (not configured)", async () => {
    const { api } = fakeApi([
      () => {
        throw new ApiError(409, "not_configured", "هوش مصنوعی راه‌اندازی نشده است");
      },
    ]);
    const events: AiStreamEvent[] = [];
    const r = await aiClient(api).chat({ text: "q" }, { onEvent: (e) => events.push(e) }, new AbortController().signal);
    expect(events).toEqual([{ type: "error", kind: "not_configured", message_fa: "هوش مصنوعی راه‌اندازی نشده است" }]);
    expect(r.done).toBeNull();
  });

  it("gives up after the idle watchdog when nothing arrives and no thread exists", async () => {
    const { api } = fakeApi([() => new Response(body([], true))]);
    const events: AiStreamEvent[] = [];
    const r = await aiClient(api).chat({ text: "q" }, { onEvent: (e) => events.push(e) }, new AbortController().signal, { idleMs: 50 });
    expect(events.at(-1)).toMatchObject({ type: "error", kind: "network" });
    expect(r.resync).toBe(false);
  });

  it("stops quietly when aborted", async () => {
    const { api } = fakeApi([() => new Response(body(sse([{ type: "meta", thread_id: "t1", message_id: "m1", model: null, connection: null }]), true))]);
    const ctl = new AbortController();
    const p = aiClient(api).chat({ text: "q" }, { onEvent: () => {} }, ctl.signal);
    setTimeout(() => ctl.abort(), 30);
    const r = await p;
    expect(r).toMatchObject({ aborted: true, threadId: "t1" });
  });

  it("errorEvent classifies errors", () => {
    expect(errorEvent(new ApiError(0, "network", "x")).kind).toBe("network");
    expect(errorEvent(new ApiError(429, "error", "x")).kind).toBe("rate");
    expect(errorEvent(new ApiError(402, "budget", "سقف")).kind).toBe("budget");
    expect(errorEvent(new Error("boom")).kind).toBe("network");
  });
});

// ---------------------------------------------------------------- conversation state

const run = (events: AiStreamEvent[], start: UiMessage[] = [blankMessage("user", { text: "q" }), blankMessage("assistant")]) => events.reduce(applyEvent, start);

const proposal = (status: AiProposal["status"] = "proposed"): AiProposal => ({
  id: "p1",
  kind: "test_item",
  title_fa: "پیش‌نویس قلم",
  summary_fa: "",
  preview: [],
  status,
  expires_at: new Date(Date.now() + 3600e3).toISOString(),
});

describe("applyEvent", () => {
  it("builds an answer from meta, text, tools, charts, tables and proposals", () => {
    const m = run([
      { type: "meta", thread_id: "t", message_id: "m1", model: "claude-sonnet-4-6", connection: "A" },
      { type: "tool_start", call_id: "c1", tool: "run_report", title_fa: "گزارش فروش" },
      { type: "thinking", delta: "..." },
      { type: "tool_end", call_id: "c1", ok: true, summary_fa: "۸ ردیف", refs: [{ type: "report", id: "members", label: "اعضا", path: "settings/users" }] },
      { type: "chart", data_ref: "d1", spec: { kind: "bar", x: "m", series: [{ field: "v", label: "فروش" }] } },
      { type: "chart", data_ref: "d1", spec: { kind: "bar", x: "m", series: [{ field: "v", label: "فروش" }] } },
      { type: "table", data_ref: "d2", columns: [{ key: "a", title: "الف" }], total_rows: 3 },
      { type: "proposal", proposal: proposal() },
      { type: "text", delta: "سلام" },
      { type: "text", delta: " دنیا" },
      { type: "done", message_id: "m1", stop: "end" },
    ]);
    expect(m).toHaveLength(2);
    const a = m[1];
    expect(a).toMatchObject({ id: "m1", model: "claude-sonnet-4-6", text: "سلام دنیا", thinking: "...", status: "done" });
    expect(a.tools).toEqual([{ call_id: "c1", tool: "run_report", title_fa: "گزارش فروش", input_fa: undefined, status: "ok", summary_fa: "۸ ردیف" }]);
    expect(a.charts).toHaveLength(1);
    expect(a.tables).toHaveLength(1);
    expect(a.proposals[0].id).toBe("p1");
    expect(a.refs.map((r) => r.id)).toEqual(["members"]);
  });

  it("marks tools still running as failed on error and keeps the message", () => {
    const m = run([
      { type: "tool_start", call_id: "c1", tool: "x", title_fa: "x" },
      { type: "error", kind: "rate", message_fa: "شلوغ است" },
      { type: "done", message_id: "m2", stop: "error" },
    ]);
    expect(m[1]).toMatchObject({ status: "error", error: { kind: "rate" }, id: "m2" });
    expect(m[1].tools[0].status).toBe("failed");
  });

  it("starts a new part when a continued answer arrives with another message id", () => {
    const m = run([
      { type: "meta", thread_id: "t", message_id: "m1", model: null, connection: null },
      { type: "text", delta: "یک" },
      { type: "continue", thread_id: "t" },
      { type: "meta", thread_id: "t", message_id: "m2", model: null, connection: null },
      { type: "text", delta: "دو" },
      { type: "done", message_id: "m2", stop: "end" },
    ]);
    expect(m.map((x) => [x.role, x.id, x.text, x.status])).toEqual([
      ["user", null, "q", "done"],
      ["assistant", "m1", "یک", "done"],
      ["assistant", "m2", "دو", "done"],
    ]);
  });

  it("maps stop reasons and never changes its input", () => {
    const start = [blankMessage("assistant")];
    const out = applyEvent(start, { type: "done", message_id: "m", stop: "max_steps" });
    expect(out[0].status).toBe("max_steps");
    expect(start[0].status).toBe("pending");
  });

  it("settle, withProposal and knownRefs", () => {
    const live = run([{ type: "tool_start", call_id: "c", tool: "t", title_fa: "t" }]);
    const stopped = settle(live, "stopped");
    expect(stopped[1]).toMatchObject({ status: "stopped" });
    expect(stopped[1].tools[0].status).toBe("failed");
    expect(settle(stopped, "error")).toBe(stopped);

    const withP = run([{ type: "proposal", proposal: proposal() }, { type: "done", message_id: "m", stop: "end" }]);
    const done = withProposal(withP, { ...proposal("executed"), result: { type: "test_doc", id: UUID, label: "سند ۱۲", path: `test/docs/${UUID}` } });
    expect(done[1].proposals[0].status).toBe("executed");
    expect(knownRefs(done).map((r) => r.id)).toEqual([UUID]);
  });

  it("fromView restores a stored message", () => {
    const m = fromView({ id: "m1", role: "assistant", text: "x", created_at: "2026-11-02T10:00:00Z", tools: [{ call_id: "c", tool: "t", title_fa: "T", ok: false }], rating: -1 });
    expect(m).toMatchObject({ key: "mm1", status: "done", rating: -1 });
    expect(m.tools[0].status).toBe("failed");
  });
});

// ---------------------------------------------------------------- links

describe("links in answers", () => {
  const refs = [{ type: "test_doc", id: UUID, label: "سند", path: `test/docs/${UUID}` }];
  const pages = new Set(["test/docs", "settings/users"]);

  it("allows records the tools returned and the app's own pages", () => {
    expect(resolveHref(`record:test_doc/${UUID}`, refs, pages)).toBe(`test/docs/${UUID}`);
    expect(resolveHref(`/test/docs/${UUID}`, refs, pages)).toBe(`test/docs/${UUID}`);
    expect(resolveHref("settings/users?q=reza", refs, pages)).toBe("settings/users?q=reza");
    expect(resolveHref(`/${UUID}/test/docs`, refs, pages)).toBe("test/docs");
  });

  it("refuses everything else", () => {
    for (const bad of ["https://evil.example", "javascript:alert(1)", "//evil.example/x", "data:text/html,x", "mailto:a@b.c", `record:test_doc/${UUID.replace("3f", "00")}`, `test/docs/${UUID.replace("3f", "00")}`, "../admin", "settings/secret", ""]) {
      expect(resolveHref(bad, refs, pages)).toBeNull();
    }
    expect(safePath("a/../b")).toBeNull();
    expect(safePath("test\\x")).toBeNull();
    expect(safePath("/test/docs/")).toBe("test/docs");
  });
});

// ---------------------------------------------------------------- page context, prompts

describe("page context", () => {
  it("names the record of a detail page and the report with its filters (routes a module registers)", () => {
    // the platform has none of its own: a module registers its detail routes and report pages
    expect(pageContext(`/test/docs/${UUID}/`, "", "سند ۱۲")).toEqual({ path: `test/docs/${UUID}`, title: "سند ۱۲" });
    RECORD_ROUTES.push({ re: /^test\/docs\/([^/]+)$/, type: "test_doc" });
    REPORT_PAGES["test/summary"] = "test_summary";
    expect(pageContext(`/test/docs/${UUID}/`, "", "سند ۱۲")).toEqual({ path: `test/docs/${UUID}`, title: "سند ۱۲", record: { type: "test_doc", id: UUID, label: "سند ۱۲" } });
    expect(pageContext("test/summary", "?from=2026-03-21&x=" + "a".repeat(200), "خلاصه")).toEqual({ path: "test/summary", title: "خلاصه", report: { key: "test_summary", params: { from: "2026-03-21" } } });
    expect(pageContext("test/docs/new", "", null)).toEqual({ path: "test/docs/new" });
    expect(pageContext("settings/users", "", "کاربران و دسترسی‌ها")).toEqual({ path: "settings/users", title: "کاربران و دسترسی‌ها" });
  });

  it("reads the page title from the window title", () => {
    expect(titleOf(`کاربران و دسترسی‌ها — ${APP_NAME}`, APP_NAME)).toBe("کاربران و دسترسی‌ها");
    expect(titleOf(APP_NAME, APP_NAME)).toBeNull();
    expect(titleOf("  ", APP_NAME)).toBeNull();
  });
});

describe("suggested prompts", () => {
  const all = { has: () => true, canDraft: true };
  // as a module registers its starters
  RECORD.test_doc = [S("r-doc", "doc", "این سند را خلاصه کن")];
  BY_PAGE.push(["test", [S("t-mod", "chart", "روند سندهای این ماه را نشان بده", { module: "test" }), S("t-draft", "draft", "یک سند تازه آماده کن", { draft: true })]]);

  it("prefers the record, then the page, then general questions, without duplicates", () => {
    const s = suggestionsFor(`test/docs/${UUID}`, { ...all, recordType: "test_doc" }, 4);
    expect(s[0].key).toBe("r-doc");
    expect(s).toHaveLength(4);
    expect(new Set(s.map((x) => x.key)).size).toBe(4);
    // the platform's own pages and general questions
    expect(suggestionsFor("settings/users", all, 3).map((x) => x.key)).toEqual(["us-roles", "us-managers", "us-inactive"]);
    expect(suggestionsFor("", all, 2).map((x) => x.key)).toEqual(["today", "my-access"]);
  });
  it("hides drafts without ai:edit, questions of modules the organisation does not use and of areas the person cannot see", () => {
    const s = suggestionsFor("test", { has: (m) => m !== "test", canDraft: false }, 10);
    expect(s.some((x) => x.module === "test" || x.draft)).toBe(false);
    expect(suggestionsFor("test", { has: () => true, canDraft: false }, 10).some((x) => x.draft)).toBe(false);
    expect(suggestionsFor("test", { has: () => true, canDraft: true }, 10).map((x) => x.key)).toEqual(expect.arrayContaining(["t-mod", "t-draft"]));
    expect(suggestionsFor("settings/users", { ...all, can: (a) => a !== "users" }, 10).some((x) => x.area === "users")).toBe(false);
  });
  it("names saved prompts by their first words and tells questions from page names", () => {
    expect(promptName("اعضای این ماه را با ماه پیش مقایسه کن")).toBe("اعضای این ماه را…");
    expect(looksLikeQuestion("چند عضو غیرفعال داریم؟")).toBe(true);
    expect(looksLikeQuestion("چقدر طول کشید")).toBe(true);
    expect(looksLikeQuestion("کاربران")).toBe(false);
    expect(looksLikeQuestion("چهار")).toBe(false);
  });
});

// ---------------------------------------------------------------- figures, files, threads

describe("figures", () => {
  it("formats decimal strings exactly, with Persian digits and a separate sign", () => {
    expect(decimalParts("1234567.50")).toEqual({ neg: false, text: "۱٬۲۳۴٬۵۶۷٫۵۰" });
    expect(decimalParts("-0012.3456789", 2)).toEqual({ neg: true, text: "۱۲٫۳۴" });
    expect(decimalParts("-0.00")).toEqual({ neg: false, text: "۰٫۰۰" });
    expect(figureText("-3.250")).toBe("−۳٫۲۵۰");
    expect(isNumeric(" 12.5 ")).toBe(true);
    expect(isNumeric("12a")).toBe(false);
    expect(toNumber("x")).toBe(0);
  });
});

describe("attachments", () => {
  it("accepts images and small PDFs, up to the file count", () => {
    expect(refuseFile({ name: "a.png", type: "image/png", size: 5e6 }, [])).toBeNull();
    expect(refuseFile({ name: "a.pdf", type: "application/pdf", size: MAX_PDF + 1 }, [])).toMatch(/بزرگ‌تر/);
    expect(refuseFile({ name: "a.docx", type: "application/msword", size: 10 }, [])).toMatch(/پذیرفته نیست/);
    expect(refuseFile({ name: "a.png", type: "image/png", size: 10 }, Array.from({ length: MAX_FILES }, () => ({ size: 1 })))).toMatch(/فایل/);
    expect(overTotal([{ size: 2e6 }, { size: 2e6 }])).toBe(true);
    expect(overTotal([{ size: 1e6 }])).toBe(false);
  });
});

describe("thread list", () => {
  it("groups pinned, today, yesterday, the past week and older", () => {
    const now = new Date(2026, 10, 2, 15, 0);
    const at = (d: number, h = 10) => new Date(2026, 10, 2 - d, h).toISOString();
    const g = groupThreads(
      [
        { id: "a", title: "a", updated_at: at(0), pinned: false },
        { id: "b", title: "b", updated_at: at(1), pinned: false },
        { id: "c", title: "c", updated_at: at(4), pinned: false },
        { id: "d", title: "d", updated_at: at(30), pinned: true },
        { id: "e", title: "e", updated_at: at(30), pinned: false },
        { id: "f", title: "f", updated_at: at(0, 12), pinned: false },
      ],
      now,
    );
    expect(g.map((x) => [x.label, x.items.map((t) => t.id).join("")])).toEqual([
      ["سنجاق‌شده", "d"],
      ["امروز", "fa"],
      ["دیروز", "b"],
      ["هفتهٔ گذشته", "c"],
      ["قدیمی‌تر", "e"],
    ]);
  });
});
