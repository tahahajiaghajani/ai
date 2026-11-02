// AI features: the insights rule engine on seeded books (stable ids, per-member statuses and
// permissions), the brief and the report explanation with the template fallback and the number
// check of model text, plans, forecasts over HTTP, and the capture validators with a stubbed reader.
import { describe, it, expect, beforeAll, vi } from "vitest";
import { makeServer, Client, signupWithOrg, quietLog } from "./helpers";
import type { Db } from "@server/db";
import { makeCtx, type Ctx, type ServerConfig, type AuthUser, type OrgRow, type MemberRow } from "@server/context";
import type { Role } from "@shared/permissions";
import { D } from "@shared/money";
import { addDays, todayISO } from "@shared/jalali";
import { numberToWords } from "@shared/words";
import { AiUnavailableError } from "@server/modules/ai/errors";
import { generate } from "@server/modules/ai/engine";
import { computeInsights, insightId, listInsights, setInsightStatus } from "@server/modules/ai/features/insights";
import { extractNumbers, numbersIn, unknownNumbers } from "@server/modules/ai/features/narrative";
import { captureDocument, validateCapture, wordsToNumber } from "@server/modules/ai/features/capture";
import * as acc from "@server/modules/accounting/reports";

vi.mock("@server/modules/ai/engine", async (importOriginal) => {
  const real = await importOriginal<typeof import("@server/modules/ai/engine")>();
  return { ...real, generate: vi.fn(async () => { throw new real.AiUnavailableError("not_configured", "هوش مصنوعی هنوز راه‌اندازی نشده است"); }) };
});
const mockedGenerate = vi.mocked(generate);

const TODAY = todayISO("Asia/Tehran");
let db: Db;
let c: Client;
let org: string;
let cfg: ServerConfig;
const ids: Record<string, string> = {};

async function ctxAs(role: Role): Promise<Ctx> {
  const user = (await db.one<AuthUser>(`select id, email, full_name, mobile, is_platform_admin, disabled, prefs from tz_users limit 1`))!;
  const o = (await db.one<OrgRow>(`select * from tz_orgs where id = $1`, [org]))!;
  const m = (await db.one<MemberRow>(`select id, org_id, user_id, role, overrides, is_active from tz_org_members where org_id = $1 limit 1`, [org]))!;
  return makeCtx(cfg, user, o, { ...m, role, overrides: {} });
}

beforeAll(async () => {
  const s = await makeServer();
  db = s.db;
  c = new Client(s.app);
  org = await signupWithOrg(c);
  cfg = { mode: "cloud", db, secret: "test-secret", allowSignup: true, platformAdmins: [], origin: "cloud", log: quietLog, fetch: globalThis.fetch.bind(globalThis) } as ServerConfig;
  const o = (p: string) => `/o/${org}${p}`;
  const unit = (await db.one<{ id: string }>(`select id from tz_units where org_id = $1 and name = 'عدد'`, [org]))!.id;
  ids.item = (await c.post(o("/data/item"), { name: "هارد ۱ ترابایت", kind: "goods", unit_id: unit, vat_pct: "0", sale_price: "3000000", reorder_point: "10" })).row.id;
  ids.customer = (await c.post(o("/data/party"), { name: "شرکت آرین", roles: ["customer"], national_id: "0084575948", economic_code: "411111111111" })).row.id;
  ids.supplier = (await c.post(o("/data/party"), { name: "پخش مرکزی", roles: ["supplier"] })).row.id;
  await c.post(o("/goods/invoices"), { kind: "purchase", date: addDays(TODAY, -60), party_id: ids.supplier, lines: [{ item_id: ids.item, qty: "12", unit_price: "2000000", vat_pct: "0" }] });
  // an overdue sale (due 40 days ago) and a duplicate of it the next day
  await c.post(o("/goods/invoices"), { kind: "sale", date: addDays(TODAY, -50), due_date: addDays(TODAY, -40), party_id: ids.customer, lines: [{ item_id: ids.item, qty: "2", unit_price: "3000000", vat_pct: "0" }] });
  await c.post(o("/goods/invoices"), { kind: "sale", date: addDays(TODAY, -3), party_id: ids.customer, lines: [{ item_id: ids.item, qty: "1", unit_price: "3000000", vat_pct: "0" }] });
  await c.post(o("/goods/invoices"), { kind: "sale", date: addDays(TODAY, -2), party_id: ids.customer, lines: [{ item_id: ids.item, qty: "1", unit_price: "3000000", vat_pct: "0" }] });
  const box = (await db.one<{ id: string }>(`select id from tz_cash_boxes where org_id = $1 limit 1`, [org]))!.id;
  await c.post(o("/treasury/docs"), { kind: "receipt", date: addDays(TODAY, -30), party_id: ids.customer, lines: [{ method: "cash", cash_box_id: box, amount: "1000000" }] });
  await c.post(o("/treasury/docs"), { kind: "receipt", date: addDays(TODAY, -20), party_id: ids.customer, lines: [{ method: "cheque", amount: "2500000", cheque: { serial_no: "77", due_date: addDays(TODAY, 3) } }] });
  // 100 USD bought, then the dollar rose about 6%
  const board = await c.get(o("/fx/rates"));
  const usd = board.currencies.find((x: { code: string }) => x.code === "USD").id;
  const irr = board.currencies.find((x: { code: string }) => x.code === "IRR").id;
  await c.post(o("/fx/rates"), { at: new Date(Date.now() - 2 * 864e5).toISOString(), rates: [{ currency_id: usd, buy: "1000000", sell: "1020000" }] });
  await c.post(o("/fx/deals"), { date: addDays(TODAY, -2), in_currency_id: usd, in_amount: "100", in_method: "cash", out_currency_id: irr, out_method: "cash", rate: "1000000" });
  await c.post(o("/fx/rates"), { at: new Date(Date.now() - 3600e3).toISOString(), rates: [{ currency_id: usd, buy: "1060000", sell: "1080000" }] });
});

describe("insights", () => {
  it("computes the rules on seeded books", async () => {
    const drafts = await computeInsights(await ctxAs("owner"), TODAY);
    const kinds = drafts.map((d) => d.kind);
    for (const k of ["cheques_due", "overdue_receivables", "low_stock", "stale_rate", "anomaly", "position"]) expect(kinds).toContain(k);
    const fx = drafts.find((d) => d.kind === "position" && d.module === "fx")!;
    // 100 USD × (1,070,000 − 1,010,000) = 6,000,000
    expect(fx.facts[0]).toEqual({ label: "USD", value: "۶٬۰۰۰٬۰۰۰ ریال" });
    const ch = drafts.find((d) => d.kind === "cheques_due")!;
    expect(ch.facts.find((f) => f.label === "دریافتی")?.value).toContain("۲٬۵۰۰٬۰۰۰");
    const ar = drafts.find((d) => d.kind === "overdue_receivables")!;
    // 4 sales of 3,000,000 = 12,000,000 − 1,000,000 cash − 2,500,000 cheque = 8,500,000 receivable; only the old sale is overdue
    expect(ar.facts.find((f) => f.label === "کل مطالبات")?.value).toContain("۸٬۵۰۰٬۰۰۰");
    expect(ar.facts.find((f) => f.label === "معوق")?.value).toContain("۶٬۰۰۰٬۰۰۰");
    const anomalies = drafts.filter((d) => d.kind === "anomaly").map((d) => d.title_fa);
    // the two same-day sales of the same amount, and the cash paid for the dollars beyond the box's balance
    expect(anomalies).toEqual(expect.arrayContaining(["سند تکراری محتمل", "موجودی منفی صندوق"]));
    expect(drafts.find((d) => d.title_fa === "موجودی منفی صندوق")?.severity).toBe("critical");
    expect(drafts.find((d) => d.kind === "stale_rate")?.title_fa).toBe("نرخ طلا ثبت نشده است");
    // most severe first once stored
    expect(drafts.every((d) => d.rank > 0)).toBe(true);
  });

  it("stores insights with stable ids, keeps per-member statuses and filters by permission", async () => {
    const owner = await ctxAs("owner");
    const first = await listInsights(owner);
    expect(first.enabled).toBe(true);
    const ch = first.insights.find((i) => i.kind === "cheques_due")!;
    expect(ch.id).toBe(insightId(org, "cheques_due:7d"));
    expect(ch.status).toBe("new");
    await setInsightStatus(owner, ch.id, "dismissed");
    const after = await listInsights(owner);
    expect(after.insights.find((i) => i.id === ch.id)).toBeUndefined();
    expect((await listInsights(owner, { all: true })).insights.find((i) => i.id === ch.id)?.status).toBe("dismissed");
    const snoozed = await setInsightStatus(owner, first.insights.find((i) => i.kind === "low_stock")!.id, "snoozed");
    expect(snoozed.status).toBe("snoozed");
    await expect(setInsightStatus(owner, ch.id, "snoozed", "2000-01-01")).rejects.toThrow();
    // the warehouse keeper sees stock insights, not treasury ones
    const wh = await listInsights(await ctxAs("warehouse"), { all: true });
    expect(wh.insights.some((i) => i.kind === "low_stock")).toBe(true);
    expect(wh.insights.some((i) => i.kind === "cheques_due")).toBe(false);
    await expect(setInsightStatus(await ctxAs("warehouse"), ch.id, "done")).rejects.toThrow();
    // HTTP: the same list, the status route, and the switch in the AI settings
    const res = await c.get(`/o/${org}/ai/insights?all=1`);
    expect(res.insights.length).toBe((await listInsights(owner, { all: true })).insights.length);
    await c.post(`/o/${org}/ai/insights/${ch.id}/status`, { status: "seen" });
    expect((await c.get(`/o/${org}/ai/insights`)).insights.find((i: { id: string }) => i.id === ch.id)?.status).toBe("seen");
    await c.post(`/o/${org}/ai/insights/nothex/status`, { status: "seen" }, 400);
  });
});

describe("narratives", () => {
  it("extracts numbers in any digits and rejects unknown ones", () => {
    expect(extractNumbers("فروش ۱۲٬۵۰۰٬۰۰۰ ریال و 3,000 و ۲٫۵٪")).toEqual(["12500000", "3000", "2.5"]);
    const allowed = numbersIn({ a: "12500000", b: "۲٫۵٪", c: [{ d: 3000 }] });
    expect(unknownNumbers("مبلغ ۱۲٬۵۰۰٬۰۰۰ ریال در ۵ روز (۲٫۵٪)", allowed)).toEqual([]);
    expect(unknownNumbers("مبلغ ۱۳٬۰۰۰٬۰۰۰ ریال", allowed)).toEqual(["13000000"]);
    expect(unknownNumbers("سال ۱۴۰۵", allowed)).toEqual([]);
  });

  it("the brief falls back to a template and is cached per day", async () => {
    mockedGenerate.mockClear();
    const r = await c.get(`/o/${org}/ai/brief?refresh=1`);
    expect(r.brief.source).toBe("template");
    // the template lists what needs attention; the numbers are the facts
    expect(r.brief.markdown).toContain("چک");
    expect(r.brief.facts.find((f: { key: string }) => f.key === "cash_bank").label).toBe("موجودی صندوق و بانک");
    expect(r.brief.facts.map((f: { key: string }) => f.key)).toEqual(expect.arrayContaining(["sales_today", "sales_mtd", "cash_bank", "cheques_in_7d", "overdue"]));
    expect(mockedGenerate).toHaveBeenCalledTimes(1);
    const again = await c.get(`/o/${org}/ai/brief`);
    expect(again.brief.generated_at).toBe(r.brief.generated_at);
    expect(mockedGenerate).toHaveBeenCalledTimes(1);
  });

  it("accepts a model brief only when its numbers are the facts'", async () => {
    const facts = (await c.get(`/o/${org}/ai/brief`)).brief.facts as { key: string; value: string }[];
    const cash = facts.find((f) => f.key === "cash_bank")!.value;
    mockedGenerate.mockImplementationOnce(async () => ({ text: "", object: { markdown: `- موجودی صندوق و بانک ${cash} است.` }, model: "test-model", connection: "t", usage: { input: 1, output: 1, cache_read: 0, cache_write: 0, cost_usd: null } }) as never);
    const ok = await c.get(`/o/${org}/ai/brief?refresh=1`);
    expect(ok.brief.source).toBe("ai");
    expect(ok.brief.model).toBe("test-model");
    mockedGenerate.mockImplementationOnce(async () => ({ text: "", object: { markdown: "- موجودی صندوق و بانک ۹۹٬۹۹۹٬۹۹۹ ریال است." }, model: "test-model", connection: "t", usage: { input: 1, output: 1, cache_read: 0, cache_write: 0, cost_usd: null } }) as never);
    const bad = await c.get(`/o/${org}/ai/brief?refresh=1`);
    expect(bad.brief.source).toBe("template");
    expect(bad.brief.note_fa).toMatch(/عدد/);
  });

  it("explains a report with the template when AI is unavailable, from the report's own numbers", async () => {
    const r = await c.post(`/o/${org}/ai/explain`, { report: "income_statement", period: { preset: "fiscal_year" } });
    const e = r.explanation;
    expect(e.source).toBe("template");
    const fy = (await db.one<{ start_date: string; end_date: string }>(`select start_date, end_date from tz_fiscal_years where org_id = $1 and start_date <= $2 and end_date >= $2`, [org, TODAY]))!;
    const is = await acc.incomeStatement(db, org, { from: fy.start_date, to: fy.end_date });
    expect(numbersIn(e.key_points).has(D(is.total_income).toFixed())).toBe(true);
    expect(e.questions.length).toBeGreaterThan(0);
    await c.post(`/o/${org}/ai/explain`, { report: "no_such_report" }, 400);
  });

  it("makes, lists and deletes plans; serves forecasts", async () => {
    const p = (await c.post(`/o/${org}/ai/plan`, { horizon: "month", focus: "وصول مطالبات" })).plan;
    expect(p.source).toBe("template");
    expect(p.content.sections.map((s: { key: string }) => s.key)).toEqual(expect.arrayContaining(["cash", "collections", "reorder"]));
    expect(p.content.steps.length).toBeGreaterThan(0);
    expect(p.markdown).toContain("### گام‌ها");
    expect((await c.get(`/o/${org}/ai/plans`)).plans[0].id).toBe(p.id);
    expect((await c.get(`/o/${org}/ai/plans/${p.id}`)).plan.title).toBe(p.title);
    await c.del(`/o/${org}/ai/plans/${p.id}`);
    await c.get(`/o/${org}/ai/plans/${p.id}`, 404);
    const cf = await c.get(`/o/${org}/ai/forecast/cashflow`);
    expect(cf.series.forecast).toHaveLength(13);
    const n = await c.post(`/o/${org}/ai/forecast/cashflow/narrative`, {});
    expect(n.source).toBe("template");
    await c.get(`/o/${org}/ai/forecast/weather`, 400);
  });

  it("answers the forecast page's contract: cash weeks with items, rates, reorder and dead stock", async () => {
    const cf = await c.get(`/o/${org}/ai/forecast/cashflow`);
    const w = cf.details.weeks;
    expect(w).toHaveLength(13);
    expect(Object.keys(w[0])).toEqual(expect.arrayContaining(["week_start", "week_end", "inflow", "outflow", "closing_p50", "closing_p10", "closing_p90", "items"]));
    // the received cheque due in 3 days is an item of its week, linked to the cheque
    const items = w.flatMap((x: { items: { kind: string; amount: string; label: string; ref?: { type: string } }[] }) => x.items);
    const ch = items.find((i: { kind: string }) => i.kind === "cheque_in")!;
    expect(D(ch.amount).toFixed()).toBe("2500000");
    expect(ch.label).toContain("شرکت آرین");
    expect(ch.ref?.type).toBe("cheque");
    for (const x of w) expect(D(x.inflow).toFixed()).toBe(D(x.cheques_in).plus(D(x.invoices_in)).toFixed());
    const rates = (await c.get(`/o/${org}/ai/forecast/rates`)).rates;
    const usd = rates.find((r: { key: string }) => r.key === "fx:USD");
    // two closes only: refused, with the reason
    expect(usd).toMatchObject({ unit: expect.stringContaining("USD"), horizons: [], observations: 2, thin: false });
    expect(usd.refused_reason_fa).toMatch(/۲۰|20/);
    expect(usd.history.length).toBeGreaterThan(0);
    const reorder = (await c.get(`/o/${org}/ai/forecast/reorder`)).items;
    expect(reorder[0]).toMatchObject({ item_id: ids.item, name: "هارد ۱ ترابایت", unit: "عدد" });
    expect(Array.isArray((await c.get(`/o/${org}/ai/forecast/dead_stock`)).items)).toBe(true);
    // the sales tab sends item/category ids; the narrative takes the same query
    const sales = await c.get(`/o/${org}/ai/forecast/sales?grain=month&horizon=6&item=${ids.item}`);
    expect(sales.series.title_fa).toContain("هارد");
    expect((await c.post(`/o/${org}/ai/forecast/rate/narrative`, { rate: "fx:USD" })).series.key).toBe("rate:fx:USD");
  });

  it("explains a report from the page's own parameters and aliases", async () => {
    const tb = (await c.post(`/o/${org}/ai/explain`, { report: "trial_balance", params: { from: addDays(TODAY, -90), to: TODAY, level: 2, drafts: 0, fiscal_year_id: null } })).explanation;
    expect(tb.report).toBe("trial_balance");
    const sales = (await c.post(`/o/${org}/ai/explain`, { report: "goods_sales", params: { group: "item", from: addDays(TODAY, -90), to: TODAY, party_id: ids.customer } })).explanation;
    expect(sales.report).toBe("sales_report");
    expect(sales.markdown).toContain("هارد");
    const kx = (await c.post(`/o/${org}/ai/explain`, { report: "kardex", params: { item_id: ids.item, warehouse_id: null } })).explanation;
    expect(kx.title_fa).toBe("کاردکس کالا");
    const box = (await db.one<{ id: string }>(`select id from tz_cash_boxes where org_id = $1 limit 1`, [org]))!.id;
    expect((await c.post(`/o/${org}/ai/explain`, { report: "cash_book", params: { cash_box_id: box, from: addDays(TODAY, -90), to: TODAY } })).explanation.report).toBe("cash_bank_book");
  });

  it("takes the insight snooze time the dashboard sends and links the brief's facts", async () => {
    const list = (await c.get(`/o/${org}/ai/insights`)).insights;
    const one = list[0];
    const r = await c.post(`/o/${org}/ai/insights/${one.id}/status`, { status: "snoozed", snooze_until: addDays(TODAY, 7) });
    expect(r.insight.status).toBe("snoozed");
    expect((await c.get(`/o/${org}/ai/insights`)).insights.some((i: { id: string }) => i.id === one.id)).toBe(false);
    const b = (await c.get(`/o/${org}/ai/brief?refresh=1`)).brief;
    expect(b.facts.find((f: { key: string }) => f.key === "cheques_in_7d")).toMatchObject({ path: "treasury/cheques/due", tone: "in" });
  });

  it("answers AI-unavailable and switched-off features with the kind", async () => {
    const file = Buffer.from("%PDF-1.4 something").toString("base64");
    const r = await c.post(`/o/${org}/ai/capture`, { kind: "purchase_invoice", mime: "application/pdf", file }, 403);
    expect(r.error).toMatchObject({ code: "ai_not_configured", details: { kind: "not_configured" } });
    await c.put(`/o/${org}/ai/settings`, { features: { forecast: false } });
    const off = await c.get(`/o/${org}/ai/forecast/rates`, 403);
    expect(off.error).toMatchObject({ code: "ai_disabled", details: { kind: "disabled" } });
    await c.put(`/o/${org}/ai/settings`, { features: { forecast: true } });
  });
});

describe("capture", () => {
  const read = (fields: Record<string, string | null>, lines?: Record<string, string>[]) => ({
    fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { value: v, confidence: 0.9 }])),
    lines: lines?.map((l) => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, { value: v, confidence: 0.9 }]))) ?? null,
  });

  it("reads numbers in Persian words", () => {
    expect(wordsToNumber("یک میلیون و دویست هزار ریال")).toBe("1200000");
    expect(wordsToNumber("فقط دو میلیارد و پانصد میلیون تومان")).toBe("2500000000");
    for (const n of ["7", "1001", "215000", "47350000", "1200345678"]) expect(wordsToNumber(numberToWords(n))).toBe(n);
    expect(wordsToNumber("سلام دنیا")).toBeNull();
  });

  it("validates national ids, dates, line totals and cheque amounts", () => {
    const inv = validateCapture("purchase_invoice", read(
      { seller_name: "پخش مرکزی", seller_national_id: "۰۰۸۴۵۷۵۹۴۹", invoice_no: "۱۲", date: "۱۴۰۵/۰۸/۰۱", subtotal: "۵٬۰۰۰٬۰۰۰", discount: "0", tax: "450,000", total: "5450000" },
      [{ description: "هارد", qty: "2", unit_price: "1000000", total: "2000000" }, { description: "کابل", qty: "3", unit_price: "1000000", total: "2000000" }],
    ), TODAY);
    expect(inv.fields.seller_national_id.note_fa).toMatch(/رقم کنترل/);
    expect(inv.fields.seller_national_id.confidence).toBeLessThanOrEqual(0.3);
    expect(inv.fields.date_iso.value).toBe("2026-10-23");
    expect(inv.warnings.some((w) => w.includes("ردیف 2"))).toBe(true);
    expect(inv.warnings.some((w) => w.includes("جمع ردیف‌ها"))).toBe(true);
    const good = validateCapture("purchase_invoice", read({ seller_national_id: "0084575948", subtotal: "2000000", tax: "180000", total: "2180000" }, [{ qty: "2", unit_price: "1000000", total: "2000000" }]), TODAY);
    expect(good.warnings).toEqual([]);
    const cheque = validateCapture("cheque", read({ sayad_id: "۱۲۳۴", amount: "1,200,000", amount_words: "یک میلیون و سیصد هزار ریال", due_date: "2026-12-01" }), TODAY);
    expect(cheque.fields.sayad_id.note_fa).toMatch(/۱۶ رقم/);
    expect(cheque.warnings.some((w) => w.includes("به حروف"))).toBe(true);
    const chequeOk = validateCapture("cheque", read({ sayad_id: "1234567890123456", amount: "1200000", amount_words: "یک میلیون و دویست هزار ریال" }), TODAY);
    expect(chequeOk.warnings).toEqual([]);
    expect(chequeOk.fields.amount.confidence).toBeGreaterThanOrEqual(0.95);
    const card = validateCapture("id_card", read({ national_id: "0084575948", birth_date: "1370/01/15" }), TODAY);
    expect(card.fields.birth_date_iso.value).toBe("1991-04-04");
    expect(card.warnings).toEqual([]);
  });

  it("reads a document with a stubbed reader, matches the party exactly, stores only the hash and reuses it", async () => {
    const owner = await ctxAs("owner");
    const reader = vi.fn(async () => ({
      text: "", model: "vision-test", connection: "t", usage: { input: 1, output: 1, cache_read: 0, cache_write: 0, cost_usd: null },
      object: read({ seller_name: "شرکت آرین", seller_national_id: "0084575948", seller_economic_code: "411111111111", subtotal: "2000000", tax: "0", total: "2000000" }, [{ description: "هارد", qty: "1", unit_price: "2000000", total: "2000000" }]),
    }));
    const file = Buffer.from("fake image bytes for the test").toString("base64");
    const r = await captureDocument(owner, { kind: "purchase_invoice", mime: "image/png", file }, { read: reader as never });
    expect(r.cached).toBe(false);
    expect(r.fields.party_id.value).toBe(ids.customer);
    expect(r.model).toBe("vision-test");
    const stored = await db.one<{ sha256: string; result: unknown }>(`select sha256, result from tz_ai_captures where id = $1`, [r.id]);
    expect(stored!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored!.result)).not.toContain(file);
    const again = await captureDocument(owner, { kind: "purchase_invoice", mime: "image/png", file }, { read: reader as never });
    expect(again.cached).toBe(true);
    expect(reader).toHaveBeenCalledTimes(1);
    await expect(captureDocument(await ctxAs("viewer"), { kind: "purchase_invoice", mime: "image/png", file }, { read: reader as never })).rejects.toThrow();
  });

  it("refuses capture when AI is unavailable or the input is not a file", async () => {
    const file = Buffer.from("another document").toString("base64");
    const r = await c.post(`/o/${org}/ai/capture`, { kind: "receipt", mime: "image/jpeg", file }, 403);
    expect(JSON.stringify(r)).toMatch(/هوش مصنوعی/);
    await c.post(`/o/${org}/ai/capture`, { kind: "receipt", mime: "text/html", file }, 400);
    expect(AiUnavailableError).toBeTruthy();
  });
});
