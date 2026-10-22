import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: { message: string } | null };
type Call = { table: string; method: string; args: unknown[] };

// A fake Supabase client: records every builder call, answers with `results["<table>.<op>"]`.
const h = vi.hoisted(() => ({ calls: [] as Call[], results: {} as Record<string, Result> }));

vi.mock("@/lib/db", () => {
  const client = {
    from: (table: string) => {
      let op = "select";
      const q: Record<string, unknown> = {};
      for (const method of ["select", "insert", "update", "delete", "eq", "lt", "in", "not", "single", "maybeSingle", "order"]) {
        q[method] = (...args: unknown[]) => {
          if (method === "insert" || method === "update" || method === "delete") op = method;
          h.calls.push({ table, method, args });
          return q;
        };
      }
      q.then = (ok: (r: Result) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve(h.results[`${table}.${op}`] ?? { data: null, error: null }).then(ok, fail);
      return q;
    },
  };
  return { db: () => client, requireDb: () => client };
});
vi.mock("@/lib/admin-auth", () => ({ assertAdmin: async () => {}, checkPassword: () => false, endSession: async () => {}, startSession: async () => {} }));
vi.mock("@/lib/settings", async () => {
  const { DEFAULT_SETTINGS } = await import("@/lib/settings-types");
  return {
    getSettingsFresh: vi.fn(async () => ({ ...DEFAULT_SETTINGS, notify: { channel: "telegram", chatId: "-100", emailCustomers: false, botTokenEnc: "enc" } })),
    saveSettings: vi.fn(async () => {}),
  };
});
vi.mock("@/lib/tickets", () => ({ getTicket: vi.fn(), triageTicket: vi.fn(), addMessage: vi.fn(), noticeStaffReply: vi.fn(), setStatus: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notifyTeam: vi.fn() }));
vi.mock("@/lib/knowledge", () => ({ getKnowledge: async () => ({ entries: [] }) }));
vi.mock("@/lib/ai/runtime", () => ({ chatSystemPrompt: () => "", complete: vi.fn(), runtimeFrom: () => null }));
vi.mock("@/lib/request", () => ({ clientIp: async () => "127.0.0.1" }));
vi.mock("@/lib/rate-limit", () => ({ allow: async () => true }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));

import { importKnowledge, retriage, saveSite, staffReply, testNotify, updateTicket, upsertKnowledge } from "@/app/actions/admin";
import { saveSettings } from "@/lib/settings";
import { DEFAULT_SETTINGS, type SiteContent } from "@/lib/settings-types";
import { addMessage, getTicket, noticeStaffReply, setStatus, triageTicket, type TicketRow } from "@/lib/tickets";
import { after } from "next/server";
import { notifyTeam } from "@/lib/notify";

const calls = (table: string, method: string) => h.calls.filter((c) => c.table === table && c.method === method);

beforeEach(() => {
  h.calls = [];
  h.results = {};
  vi.mocked(saveSettings).mockClear();
});

describe("importKnowledge", () => {
  it("refuses a file without valid entries and leaves the knowledge base alone", async () => {
    const r = await importKnowledge({ mode: "json", json: JSON.stringify([{ question: "q", answer: "a" }, { title: "  ", body: "x" }]), replace: true });
    expect(r.ok).toBe(false);
    expect(h.calls).toHaveLength(0);
  });

  it("inserts the cleaned entries first, then deletes only the older rows", async () => {
    h.results["pars_knowledge.insert"] = { data: [{ created_at: "2026-10-22T12:00:00.123456+00:00" }], error: null };
    const json = JSON.stringify([
      { title: "First\u0000", body: "Body\u0000 one", sort: 0, tags: ["a", "", "b"] },
      { title: "Second", body: "Body two", sort: 15.5 },
      { title: "Third", body: "Body three", sort: 1e12 },
      { title: "Fourth", body: "Body four" },
    ]);
    const r = await importKnowledge({ mode: "json", json, replace: true });
    expect(r).toMatchObject({ ok: true, count: 4 });
    const rows = calls("pars_knowledge", "insert")[0].args[0] as { title: string; body: string; tags: string[]; sort: number }[];
    expect(rows.map((x) => x.title)).toEqual(["First", "Second", "Third", "Fourth"]);
    expect(rows[0]).toMatchObject({ body: "Body one", tags: ["a", "b"], sort: 0 });
    expect(rows.map((x) => x.sort)).toEqual([0, 16, 2147483647, 40]);
    expect(calls("pars_knowledge", "lt")[0].args).toEqual(["created_at", "2026-10-22T12:00:00.123456+00:00"]);
    const order = h.calls.filter((c) => c.method === "insert" || c.method === "delete").map((c) => c.method);
    expect(order).toEqual(["insert", "delete"]);
  });

  it("keeps the current entries when the insert fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.results["pars_knowledge.insert"] = { data: null, error: { message: "invalid input syntax" } };
    const r = await importKnowledge({ mode: "json", json: JSON.stringify([{ title: "A", body: "B" }]), replace: true });
    expect(r.ok).toBe(false);
    expect(calls("pars_knowledge", "delete")).toHaveLength(0);
  });

  it("adds without deleting when not replacing", async () => {
    h.results["pars_knowledge.insert"] = { data: [{ created_at: "2026-10-22T12:00:00Z" }], error: null };
    const r = await importKnowledge({ mode: "json", json: JSON.stringify([{ title: "A", body: "B" }]) });
    expect(r.ok).toBe(true);
    expect(calls("pars_knowledge", "delete")).toHaveLength(0);
  });
});

describe("sort order", () => {
  it("keeps 0 and falls back only for a missing value", async () => {
    h.results["pars_knowledge.update"] = { data: { id: "k1" }, error: null };
    h.results["pars_knowledge.insert"] = { data: { id: "k2" }, error: null };
    await upsertKnowledge({ id: "k1", title: "T", body: "B", tags: [], pinned: false, enabled: true, sort: 0 });
    await upsertKnowledge({ title: "T", body: "B", tags: [], pinned: false, enabled: true, sort: "" as unknown as number });
    expect((calls("pars_knowledge", "update")[0].args[0] as { sort: number }).sort).toBe(0);
    expect((calls("pars_knowledge", "insert")[0].args[0] as { sort: number }).sort).toBe(100);
  });
});

describe("saveSite", () => {
  it("stores phones, years and stat values with ASCII digits", async () => {
    const d = DEFAULT_SETTINGS.site;
    const input: SiteContent = {
      ...d,
      ceo: { ...d.ceo, years: "۲۵+" },
      contact: { ...d.contact, phones: ["۰۲۱-۸۸۷۳۱۶۰۱", "٠٩١٢ ١٢٣ ٤٥٦٧"] },
      stats: [{ value: "۹۸٪", labelFa: "رضایت", labelEn: "Satisfaction" }],
    };
    expect((await saveSite(input)).ok).toBe(true);
    const saved = vi.mocked(saveSettings).mock.calls[0][1] as SiteContent;
    expect(saved.contact.phones).toEqual(["021-88731601", "0912 123 4567"]);
    expect(saved.ceo.years).toBe("25+");
    expect(saved.stats[0]).toEqual({ value: "98%", labelFa: "رضایت", labelEn: "Satisfaction" });
  });
});

describe("updateTicket", () => {
  const t = { id: "t1", code: "PP-ABC234", created_at: "2026-10-01T08:00:00.000Z", first_response_at: null, priority: "normal", status: "new" } as TicketRow;

  it("moves the SLA deadline with the priority", async () => {
    vi.mocked(getTicket).mockResolvedValue(t);
    expect((await updateTicket({ code: t.code, priority: "urgent" })).ok).toBe(true);
    const patch = calls("pars_tickets", "update")[0].args[0];
    expect(patch).toMatchObject({ priority: "urgent", due_at: "2026-10-01T10:00:00.000Z" });
    expect(calls("pars_tickets", "eq")[0].args).toEqual(["id", "t1"]);
  });

  it("records the first response when a ticket is marked answered by hand", async () => {
    vi.mocked(getTicket).mockResolvedValue(t);
    await updateTicket({ code: t.code, status: "answered" });
    expect(calls("pars_tickets", "update")[0].args[0]).toMatchObject({ status: "answered", first_response_at: expect.any(String) });
  });

  it("reports a missing ticket", async () => {
    vi.mocked(getTicket).mockResolvedValue(null);
    expect(await updateTicket({ code: "PP-NOPE22", priority: "low" })).toMatchObject({ ok: false });
  });
});

describe("staffReply", () => {
  const t = { id: "t1", code: "PP-ABC234", status: "closed" } as TicketRow;
  // runs the e-mail notice queued with after()
  const notice = async () => {
    for (const [fn] of vi.mocked(after).mock.calls) await (fn as () => Promise<void>)();
  };

  beforeEach(() => {
    vi.mocked(getTicket).mockResolvedValue(t);
    vi.mocked(addMessage).mockResolvedValue("closed");
    vi.mocked(after).mockClear();
    vi.mocked(setStatus).mockClear();
    vi.mocked(noticeStaffReply).mockClear();
  });

  it("e-mails the status the ticket keeps: a closed ticket stays closed by default", async () => {
    expect((await staffReply({ code: t.code, body: "Thanks, all done.", internal: false, status: "answered" })).ok).toBe(true);
    await notice();
    expect(setStatus).not.toHaveBeenCalled();
    expect(noticeStaffReply).toHaveBeenCalledWith(t, "Thanks, all done.", "closed");
  });

  it("e-mails the status chosen with the reply", async () => {
    await staffReply({ code: t.code, body: "Reopening this.", internal: false, status: "in_progress" });
    await notice();
    expect(setStatus).toHaveBeenCalledWith(t, "in_progress");
    expect(noticeStaffReply).toHaveBeenCalledWith(t, "Reopening this.", "in_progress");
  });

  it("does not e-mail an internal note", async () => {
    await staffReply({ code: t.code, body: "Internal only.", internal: true, status: "resolved" });
    await notice();
    expect(setStatus).not.toHaveBeenCalled();
    expect(noticeStaffReply).not.toHaveBeenCalled();
  });
});

describe("retriage and testNotify", () => {
  it("reports a triage that did not run", async () => {
    vi.mocked(getTicket).mockResolvedValue({ id: "t1" } as TicketRow);
    vi.mocked(triageTicket).mockResolvedValue("no_ai");
    expect(await retriage("PP-ABC234")).toMatchObject({ ok: false });
    vi.mocked(triageTicket).mockResolvedValue("failed");
    expect(await retriage("PP-ABC234")).toMatchObject({ ok: false });
    vi.mocked(triageTicket).mockResolvedValue("ok");
    expect(await retriage("PP-ABC234")).toMatchObject({ ok: true });
    expect(vi.mocked(triageTicket)).toHaveBeenLastCalledWith("t1", { manual: true });
  });

  it("reports a message the Bot API rejected", async () => {
    vi.mocked(notifyTeam).mockResolvedValue({ ok: false, error: "Bad Request: chat not found" });
    const r = await testNotify();
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("chat not found");
    vi.mocked(notifyTeam).mockResolvedValue({ ok: true });
    expect((await testNotify()).ok).toBe(true);
  });
});
