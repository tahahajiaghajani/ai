import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TicketRow } from "@/lib/tickets";

// Props each <Select> rendered with, so the tests can tell a controlled select from an uncontrolled one.
const seen = vi.hoisted(() => ({ selects: [] as { value?: unknown; defaultValue?: unknown }[] }));

vi.mock("@/components/ui/field", async (load) => {
  const real = await load<typeof import("@/components/ui/field")>();
  return {
    ...real,
    Select: (props: Parameters<typeof real.Select>[0]) => {
      seen.selects.push(props);
      return real.Select(props);
    },
  };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("@/app/actions/admin", () => ({ deleteTicket: vi.fn(), retriage: vi.fn(), staffReply: vi.fn(), updateTicket: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: async () => {} }));

const ticket: TicketRow = {
  id: "t1",
  code: "PRS-1234",
  access_hash: "",
  access_enc: null,
  name: "Sara",
  email: "sara@example.com",
  phone: "",
  organization: "",
  subject: "EPM",
  body: "help",
  lang: "fa",
  product: "epm",
  category: "support",
  priority: "normal",
  status: "resolved",
  sentiment: null,
  ai_summary: "summary",
  ai_reply: null,
  ai_triage: { confidence: 0.85 },
  source: "",
  rating: null,
  rating_note: null,
  first_response_at: null,
  due_at: null,
  last_customer_at: "2026-10-01T10:00:00Z",
  last_staff_at: null,
  created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-01T10:00:00Z",
};
vi.mock("@/lib/tickets", () => ({
  getTicket: async () => ticket,
  listMessages: async () => [],
  accessKeyOf: () => "",
  ticketLink: () => "",
}));

const { Field, Input, Select, Textarea } = await import("@/components/ui/field");
const { TicketControls } = await import("@/components/admin/ticket-admin");
const { default: TicketPage } = await import("@/app/(fa)/admin/(panel)/tickets/[code]/page");

/** Every `for`/`id` pair in the markup. */
const fors = (html: string) => [...html.matchAll(/<label[^>]* for="([^"]+)"/g)].map((m) => m[1]);
const ids = (html: string) => [...html.matchAll(/<(?:input|textarea|select|p)[^>]* id="([^"]+)"/g)].map((m) => m[1]);

describe("Field", () => {
  it("links the label to its input", () => {
    const html = renderToStaticMarkup(h(Field, { label: "مدل اصلی", hint: "اختیاری", children: h(Input, { value: "gemini", readOnly: true }) }));
    expect(fors(html)).toHaveLength(1);
    expect(ids(html)).toEqual(fors(html));
    expect(html).toContain("مدل اصلی");
    expect(html).toContain("اختیاری");
  });

  it("puts the id on the <select> inside Select, and keeps an id the control already has", () => {
    const select = renderToStaticMarkup(h(Field, { label: "کانال", children: h(Select, { value: "none", onChange: () => {}, children: h("option", { value: "none" }, "خاموش") }) }));
    expect(select).toMatch(new RegExp(`<select id="${fors(select)[0]}"`));
    const own = renderToStaticMarkup(h(Field, { label: "متن", children: h(Textarea, { id: "body", value: "", readOnly: true }) }));
    expect(fors(own)).toEqual(["body"]);
    expect(ids(own)).toEqual(["body"]);
  });

  it("gives the id only to the first element; notes after it stay as they are", () => {
    const html = renderToStaticMarkup(h(Field, { label: "آدرس پایه‌ی API", className: "sm:col-span-2", children: [h(Input, { key: "i", value: "", readOnly: true }), h("p", { key: "p" }, "note")] }));
    expect(ids(html)).toEqual(fors(html));
    expect(html).toContain("<p>note</p>");
    expect(html).toMatch(/^<div class="sm:col-span-2">/);
  });

  it("gives each field of a form its own id", () => {
    const field = (label: string) => h(Field, { key: label, label, children: h(Input, { readOnly: true }) });
    const html = renderToStaticMarkup(h("form", null, field("پیام در روز"), field("پیام در ۱۰ دقیقه")));
    const [a, b] = fors(html);
    expect(a).not.toBe(b);
    expect(ids(html)).toEqual([a, b]);
  });
});

describe("TicketControls", () => {
  beforeEach(() => {
    seen.selects = [];
  });

  it("shows the saved status, priority and category as controlled values (a reply that changes the status shows up)", () => {
    for (const status of ["new", "resolved"]) {
      seen.selects = [];
      const html = renderToStaticMarkup(h(TicketControls, { code: "PRS-1", status, priority: "high", category: "bug", link: "" }));
      expect(seen.selects.map((p) => p.value)).toEqual([status, "high", "bug"]);
      expect(seen.selects.every((p) => p.defaultValue === undefined)).toBe(true);
      expect(html).toContain(`<option value="${status}" selected="">`);
    }
  });
});

describe("admin ticket page", () => {
  it("prints Persian digits in Persian sentences", async () => {
    const html = renderToStaticMarkup(await TicketPage({ params: Promise.resolve({ code: "PRS-1234" }) }));
    expect(html).toContain("مهلت اولین پاسخ (۲۴ ساعت)");
    expect(html).toContain("اطمینان: ۸۵٪");
    expect(html).not.toMatch(/اطمینان: \d|\(\d+ ساعت\)/);
  });
});
