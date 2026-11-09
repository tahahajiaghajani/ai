// Tools the AI layer registers over the modules' own services (docs/spec/AI.md §11.8): the risk of a change, the impact
// of configuration items, and ordering a catalogue item for someone (a proposal). Each calls the module's service with
// the CALLER's context — the service's checks are the route's checks — and returns bounded data; the order is a
// proposal that the person confirms, placed then through the request module's ordering route with their access (the
// entitlement, the on-behalf rules and the answers are checked again). A table that is not installed has no tool.
import { z } from "zod";
import type { Ctx } from "../../../context";
import { tableDef } from "@shared/tables";
import { formatNumber } from "@shared/format";
import { list } from "../../../engine";
import { bad, notFound } from "../../../http/errors";
import { riskView } from "../../change/actions";
import { impactAnalysis } from "../../cmdb/impact";
import { browse, checkItem, itemForm, placeOrder } from "../../request/ordering";
import { faNorm, pathOf } from "./common";
import { parsePayload, registerProposalExecutor } from "./proposals";
import { defineTool, type AiToolDef } from "./registry";
import { registerTool } from "./index";

const UUID = /^[0-9a-f-]{36}$/i;

/** A record id from an id or a number, read with the caller's access. */
async function idOf(ctx: Ctx, table: string, idOrNumber: string): Promise<string> {
  const v = idOrNumber.trim();
  if (UUID.test(v)) return v.toLowerCase();
  const r = await list(ctx, table, { filter: { f: "number", op: "eq", v: v.toUpperCase() }, size: 1, total: false, fields: ["id"] });
  if (!r.rows.length) throw notFound(`«${v}» پیدا نشد یا در دسترس شما نیست`);
  return String(r.rows[0].id);
}

const changeRisk = defineTool({
  name: "change_risk",
  title_fa: "خطر تغییر",
  description:
    "The calculated risk of one change request (by id or number, e.g. CHG0000123) as its risk panel shows it: level, score, the factors that raised it, the questionnaire's answers, the lead time it needs and whether the risk was set by hand. Only changes the person may read.",
  input: z.object({ change: z.string().max(40).describe("The change's id or number") }),
  kind: "read",
  area: "ai",
  level: "view",
  async run(ctx, p) {
    const id = await idOf(ctx, "change_request", p.change);
    const v = await riskView(ctx, id);
    const r = v.result as { level?: string; score?: unknown; factors?: unknown[] } | undefined;
    return {
      data: {
        risk: v.risk ?? r?.level ?? null,
        source: v.risk_source,
        calculated: r ? { level: r.level, score: r.score, factors: (r.factors ?? []).slice(0, 12) } : null,
        explanation: v.explanation,
        lead: v.lead,
        answered: Object.keys((v.answers as Record<string, unknown>) ?? {}).length,
        questions: Array.isArray(v.questions) ? v.questions.length : 0,
      },
      summary_fa: `خطر تغییر: ${String(v.risk ?? r?.level ?? "—")}`,
    };
  },
});

const cmdbImpact = defineTool({
  name: "cmdb_impact",
  title_fa: "اثر پیکربندی",
  description:
    "What depends on configuration items (by id or number): the impacted CIs, services and offerings with their criticality, through the relationship map, and the counts of users and subscribers. Items the person may not read appear only as counts (restricted).",
  input: z.object({ cis: z.array(z.string().max(40)).min(1).max(10).describe("CI ids or numbers"), depth: z.number().int().min(1).max(8).optional() }),
  kind: "read",
  area: "ai",
  level: "view",
  async run(ctx, p) {
    const ids = [];
    for (const c of p.cis) ids.push(await idOf(ctx, "ci", c));
    const r = await impactAnalysis(ctx, { ci_ids: ids, depth: p.depth ?? 4 });
    return {
      data: {
        sources: r.sources.map((s) => ({ number: s.number, name: s.name, class: s.class })),
        services: r.services.slice(0, 20),
        cis: r.cis.slice(0, 30),
        counts: r.counts,
        truncated: r.services.length > 20 || r.cis.length > 30,
      },
      summary_fa: `${formatNumber(r.counts.services)} خدمت و ${formatNumber(r.counts.cis)} پیکربندی اثر می‌پذیرند`,
    };
  },
});

const orderPayload = z.object({ item_id: z.string().regex(UUID), answers: z.record(z.string(), z.unknown()), quantity: z.number().int().min(1).max(1000), requested_for: z.string().regex(UUID).nullable() });

/** A person the caller may read, by id, e-mail or name (one match). */
async function personOf(ctx: Ctx, who: string): Promise<{ id: string; name: string }> {
  const v = who.trim();
  const r = await list(ctx, "user", UUID.test(v) ? { ids: [v.toLowerCase()], size: 1, total: false } : { q: v, size: 5, total: false }).catch(() => null);
  const rows = r?.rows ?? [];
  const exact = rows.filter((x) => faNorm(String(x.full_name ?? "")) === faNorm(v) || String(x.email ?? "").toLowerCase() === v.toLowerCase());
  const pick = exact.length === 1 ? exact[0] : rows.length === 1 ? rows[0] : null;
  if (!pick) throw bad(rows.length ? `چند نفر با «${v}» جور است؛ نام کامل یا نشانی ایمیل را بدهید` : `«${v}» پیدا نشد`);
  return { id: String(pick.id), name: String(r!.display[String(pick.id)] ?? pick.full_name ?? v) };
}

const orderItem = defineTool({
  name: "draft_order_catalog_item",
  title_fa: "پیش‌نویس سفارش از کاتالوگ",
  description:
    "Drafts an order of one catalogue item for the person or for someone else (the catalogue as the person — or the one it is for — is entitled to it), with the item's answers by question name; nothing is ordered until the person confirms the card. The answers are checked exactly like the order form; fix the reported problems and call again. Secret answers (passwords) are never taken here: such items must be ordered on their form.",
  input: z.object({
    item: z.string().max(200).describe("The item's id or name"),
    requested_for: z.string().max(200).optional().describe("Whom it is for (name, e-mail or id); default the person"),
    answers: z.record(z.string(), z.unknown()).optional(),
    quantity: z.number().int().min(1).max(1000).optional(),
  }),
  kind: "propose",
  area: "ai",
  level: "view",
  async run(ctx, p) {
    const forUser = p.requested_for ? await personOf(ctx, p.requested_for) : null;
    const catalogue = await browse(ctx, { for: forUser?.id ?? null });
    const q = faNorm(p.item);
    const item = catalogue.items.find((i) => i.id === p.item.toLowerCase()) ?? catalogue.items.find((i) => faNorm(i.name) === q) ?? catalogue.items.find((i) => faNorm(i.name).includes(q));
    if (!item) throw bad(`قلم «${p.item}» در کاتالوگی که ${forUser ? `برای ${forUser.name}` : "برای شما"} در دسترس است پیدا نشد`);
    const form = await itemForm(ctx, item.id, { for: forUser?.id ?? null });
    if (form.schema.variables.some((v) => v.type === "secret" || v.field_class === "secret")) throw bad(`«${item.name}» پرسش محرمانه دارد؛ آن را در فرم سفارش ثبت کنید`);
    const answers = (p.answers ?? {}) as Record<string, unknown>;
    const quantity = p.quantity ?? 1;
    const check = await checkItem(ctx, item.id, { answers, quantity, for: forUser?.id ?? null });
    const errs = Object.entries(check.errors);
    if (errs.length) throw bad(errs.slice(0, 6).map(([k, m]) => `${form.schema.variables.find((v) => v.name === k)?.label ?? k}: ${m}`).join("؛ "));
    const rows = form.schema.variables
      .filter((v) => answers[v.name] !== undefined && answers[v.name] !== null && answers[v.name] !== "" && v.field_class !== "sensitive")
      .slice(0, 12)
      .map((v) => ({ label: v.label, value: String(Array.isArray(answers[v.name]) ? (answers[v.name] as unknown[]).join("، ") : (v.choices?.find((c) => c.value === String(answers[v.name]))?.label ?? answers[v.name])) }));
    return {
      data: { status: "draft", item: item.name, for: forUser?.name ?? "خود شخص", title: check.title, price: check.price ?? null },
      summary_fa: `پیش‌نویس سفارش ${item.name}`,
      proposal: {
        kind: "request.order",
        title_fa: `سفارش «${item.name}»${forUser ? ` برای ${forUser.name}` : ""}`,
        summary_fa: String(check.title ?? item.name).slice(0, 300),
        payload: { item_id: item.id, answers, quantity, requested_for: forUser?.id ?? null },
        preview: [{ label: "قلم", value: item.name }, { label: "برای", value: forUser?.name ?? "خود شما" }, { label: "تعداد", value: formatNumber(quantity) }, ...rows],
        warnings: ["پیش‌نویس هوش مصنوعی — پیش از تأیید بازبینی کنید"],
        edit_path: `catalog?item=${item.id}`,
        area: "ai",
        level: "view",
      },
    };
  },
});

let installed = false;

/** Register the module tools whose tables are installed, and the order's executor. */
export function installModuleTools(): void {
  if (installed) return;
  installed = true;
  if (tableDef("change_request")) registerTool(changeRisk as AiToolDef);
  if (tableDef("ci")) registerTool(cmdbImpact as AiToolDef);
  if (tableDef("catalog_item")) {
    registerTool(orderItem as AiToolDef);
    registerProposalExecutor("request.order", async (ctx, payload) => {
      const p = parsePayload(orderPayload, payload);
      const r = await placeOrder(ctx, { lines: [{ item_id: p.item_id, answers: p.answers, quantity: p.quantity, requested_for: p.requested_for }], requested_for: p.requested_for, channel: "assistant" });
      const it = r.items[0];
      if (it) return { type: "request_item", id: it.id, label: it.number ?? it.title, path: pathOf("request_item", it.id) ?? `r/request_item/${it.id}` };
      return { type: "request", id: r.request?.id ?? "", label: r.request?.number ?? "سفارش", path: r.request ? (pathOf("request", r.request.id) ?? `r/request/${r.request.id}`) : "catalog" };
    });
  }
}
