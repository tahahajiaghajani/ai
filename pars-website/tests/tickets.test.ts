import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: { message: string } | null };
type Call = { table: string; method: string; args: unknown[] };

// A fake Supabase client: records every builder call, answers with `results["<table>.<op>"]`.
const h = vi.hoisted(() => ({
  calls: [] as Call[],
  results: {} as Record<string, Result>,
  settings: { support: { triage: true, deflection: true }, notify: { emailCustomers: true } },
  canEmail: false,
  rt: { provider: "google", apiKey: "k", baseUrl: "", models: ["m"], temperature: 0.4, maxTokens: 900, instructions: "" } as unknown,
  aiAllowed: true,
  complete: null as unknown as (...a: unknown[]) => Promise<{ text: string; model: string }>,
}));

vi.mock("@/lib/db", () => {
  const client = {
    from: (table: string) => {
      let op = "select";
      const q: Record<string, unknown> = {};
      for (const method of ["select", "insert", "update", "delete", "eq", "lt", "single", "maybeSingle", "order"]) {
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
vi.mock("@/lib/settings", () => ({ getSettings: async () => h.settings }));
vi.mock("@/lib/knowledge", () => ({ getKnowledge: async () => ({ entries: [] }) }));
vi.mock("@/lib/rate-limit", () => ({ allowAi: vi.fn(async () => h.aiAllowed) }));
vi.mock("@/lib/notify", () => ({ canEmail: () => h.canEmail, emailCustomer: vi.fn(async () => {}), notifyTeam: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/ai/runtime", () => ({
  getRuntime: async () => h.rt,
  complete: (...a: unknown[]) => h.complete(...a),
  knowledgeBlock: () => "",
  noteAi: async () => {},
  parseJsonObject: (text: string) => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  },
}));

import { allowAi } from "@/lib/rate-limit";
import { emailCustomer } from "@/lib/notify";
import { encrypt } from "@/lib/crypto";
import { addMessage, noticeStaffReply, suggestFromKnowledge, ticketLink, ticketPath, triageTicket, type TicketRow } from "@/lib/tickets";

const ticket = (over: Partial<TicketRow> = {}): TicketRow =>
  ({
    id: "t1",
    code: "PP-ABC234",
    name: "Sara",
    email: "s@example.com",
    organization: "",
    subject: "Login fails",
    body: "I cannot log in since this morning.",
    lang: "fa",
    product: "epm",
    category: "support",
    priority: "normal",
    status: "new",
    first_response_at: null,
    created_at: "2026-10-01T08:00:00.000Z",
    ...over,
  }) as TicketRow;

const updates = () => h.calls.filter((c) => c.table === "pars_tickets" && c.method === "update").map((c) => c.args[0] as Record<string, unknown>);

beforeEach(() => {
  h.calls = [];
  h.results = {};
  h.settings = { support: { triage: true, deflection: true }, notify: { emailCustomers: true } };
  h.canEmail = false;
  h.aiAllowed = true;
  h.complete = vi.fn(async () => ({ text: '{"priority":"urgent","summary":"x","reply":"y"}', model: "m" }));
  vi.mocked(allowAi).mockClear();
});

describe("ticket links", () => {
  it("navigates with a same-origin path and keeps absolute links for e-mails", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://pars.example.com/";
    expect(ticketPath("PP-ABC234", "a/b+c", "fa")).toBe("/support/t/PP-ABC234?k=a%2Fb%2Bc");
    expect(ticketPath("PP-ABC234", "k", "en")).toBe("/en/support/t/PP-ABC234?k=k");
    expect(ticketLink("PP-ABC234", "k", "en")).toBe("https://pars.example.com/en/support/t/PP-ABC234?k=k");
    delete process.env.NEXT_PUBLIC_SITE_URL;
  });
});

describe("addMessage", () => {
  it("keeps a closed ticket closed when staff reply", async () => {
    await addMessage(ticket({ status: "closed" }), "staff", "Thanks, closing this.");
    expect(updates()[0]).toMatchObject({ status: "closed", last_staff_at: expect.any(String), first_response_at: expect.any(String) });
  });
  it("marks an open ticket answered when staff reply", async () => {
    expect(await addMessage(ticket({ status: "in_progress" }), "staff", "Here is the fix.")).toBe("answered");
    expect(updates()[0]).toMatchObject({ status: "answered" });
  });
  it("returns the status it stored, or the current one for an internal note", async () => {
    expect(await addMessage(ticket({ status: "closed" }), "staff", "Thanks, closing this.")).toBe("closed");
    expect(await addMessage(ticket({ status: "answered" }), "customer", "One more question.")).toBe("in_progress");
    expect(await addMessage(ticket({ status: "resolved" }), "staff", "Note for the team.", true)).toBe("resolved");
  });
});

describe("noticeStaffReply", () => {
  beforeEach(() => {
    process.env.APP_SECRET = "test-secret";
    h.canEmail = true;
    vi.mocked(emailCustomer).mockClear();
  });
  afterEach(() => {
    delete process.env.APP_SECRET;
  });
  const html = () => vi.mocked(emailCustomer).mock.calls[0][2];

  it("offers a reply and names the status while the ticket is open", async () => {
    await noticeStaffReply(ticket({ lang: "en", access_enc: encrypt("k1") }), "Here is the fix.", "answered");
    expect(html()).toContain("View and reply");
    expect(html()).toContain("Answered");
    expect(html()).toContain("/en/support/t/PP-ABC234?k=k1");
  });

  it("does not promise a reply on a closed ticket", async () => {
    await noticeStaffReply(ticket({ lang: "en", access_enc: encrypt("k1") }), "Thanks, closing this.", "closed");
    expect(html()).toContain("View the reply");
    expect(html()).not.toContain("View and reply");
    expect(html()).toContain("Closed");
    expect(html()).not.toContain("Answered");
  });

  it("names the status staff chose with the reply", async () => {
    await noticeStaffReply(ticket({ access_enc: encrypt("k1") }), "حل شد.", "resolved");
    expect(html()).toContain("مشاهده و پاسخ");
    expect(html()).toContain("حل شد</p>");
  });

  it("sends nothing when customer e-mails are off", async () => {
    h.settings = { ...h.settings, notify: { emailCustomers: false } };
    await noticeStaffReply(ticket({ access_enc: encrypt("k1") }), "Hi", "answered");
    expect(emailCustomer).not.toHaveBeenCalled();
  });
});

describe("triageTicket", () => {
  beforeEach(() => {
    h.results["pars_tickets.select"] = { data: ticket(), error: null };
  });

  it("reports a disabled switch without calling the model", async () => {
    h.settings = { ...h.settings, support: { triage: false, deflection: true } };
    expect(await triageTicket("t1")).toBe("disabled");
    expect(h.complete).not.toHaveBeenCalled();
  });

  it("reports no AI when no runtime is configured", async () => {
    const rt = h.rt;
    h.rt = null;
    expect(await triageTicket("t1")).toBe("no_ai");
    h.rt = rt;
  });

  it("is skipped once the shared daily AI budget is used up", async () => {
    h.aiAllowed = false;
    expect(await triageTicket("t1")).toBe("limit");
    expect(h.complete).not.toHaveBeenCalled();
    expect(updates()).toHaveLength(0);
  });

  it("a manual run skips the switch and the visitors' budget", async () => {
    h.settings = { ...h.settings, support: { triage: false, deflection: true } };
    h.aiAllowed = false;
    expect(await triageTicket("t1", { manual: true })).toBe("ok");
    expect(allowAi).not.toHaveBeenCalled();
  });

  it("stores the result and moves the deadline with the new priority", async () => {
    expect(await triageTicket("t1")).toBe("ok");
    expect(updates()[0]).toMatchObject({ priority: "urgent", ai_summary: "x", ai_reply: "y", due_at: "2026-10-01T10:00:00.000Z" });
  });

  it("reports a failure for a reply without JSON, a provider error or a failed update", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.complete = vi.fn(async () => ({ text: "sorry", model: "m" }));
    expect(await triageTicket("t1")).toBe("failed");
    h.complete = vi.fn(async () => {
      throw new Error("quota");
    });
    expect(await triageTicket("t1")).toBe("failed");
    h.complete = vi.fn(async () => ({ text: '{"priority":"low"}', model: "m" }));
    h.results["pars_tickets.update"] = { data: null, error: { message: "boom" } };
    expect(await triageTicket("t1")).toBe("failed");
  });
});

describe("suggestFromKnowledge", () => {
  it("returns no suggestion once the shared daily AI budget is used up", async () => {
    h.aiAllowed = false;
    expect(await suggestFromKnowledge("Login", "I cannot log in", "fa")).toBeNull();
    expect(h.complete).not.toHaveBeenCalled();
  });
  it("answers from the knowledge base while the budget lasts", async () => {
    h.complete = vi.fn(async () => ({ text: "Reset the password from the login page, then sign in again.", model: "m" }));
    expect(await suggestFromKnowledge("Login", "I cannot log in", "en")).toMatch(/^Reset/);
  });
});
