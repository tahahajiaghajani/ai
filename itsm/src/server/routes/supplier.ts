// HTTP API of supplier and contract management under /api/o/:org/supplier (docs/modules/supplier_FA.md «API»).
// Suppliers, contacts, contracts, lines, coverage, obligations, scorecards and reviews are served by the generic engine
// API; these routes are the renewal calendar, a contract's renewal, clause extraction (AI with a rule-based fallback)
// and the obligations made from it, the supplier 360 and the scorecards' run. Every handler works with the caller's
// context; the scorecards' run acts as the system after checking the caller's grant.
import { z } from "zod";
import type { SupplierMeta } from "@shared/financial/api";
import { router, body, query } from "../http/hono";
import { forbidden } from "../http/errors";
import { access } from "../access/provider";
import { createIn, defFor, get } from "../engine";
import { computeScorecards, extractClauses, renewals, renewContract, seedSupplierDefaultsIn, supplier360 } from "../modules/supplier";
import { hasGroup, holds, sysOf } from "../modules/itam/common";

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "شناسه معتبر نیست");
const id = (v: string | undefined) => UUID.parse(v ?? "").toLowerCase();
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ معتبر نیست");

export const supplierRoutes = router();

supplierRoutes.get("/meta", async (c) => {
  const ctx = c.get("ctx");
  const meta: SupplierMeta = {
    can_manage: (await holds(ctx, "vendor", "write", "group")) || (await holds(ctx, "contract", "write", "group")),
    contracts: await holds(ctx, "contract", "read"),
    financial: await hasGroup(ctx, "financial"),
    ai: ["contract.extract"],
  };
  return c.json(meta);
});

supplierRoutes.post("/seed", async (c) => {
  const ctx = c.get("ctx");
  if (!(await holds(ctx, "contract", "write", "all"))) throw forbidden("افزودن پیش‌فرض‌ها با مدیر قراردادها است");
  const r = await ctx.write((tx) => seedSupplierDefaultsIn(tx, ctx, { force: true }));
  return c.json({ created: r.created });
});

supplierRoutes.get("/renewals", async (c) => {
  const q = query(c, z.object({ months: z.coerce.number().int().min(1).max(36).optional() }));
  return c.json(await renewals(c.get("ctx"), q.months ?? 12));
});

supplierRoutes.post("/contracts/:id/renew", async (c) => {
  const input = await body(c, z.object({ start_date: DATE.nullish(), end_date: DATE.nullish(), value: z.string().max(40).nullish() }));
  return c.json(await renewContract(c.get("ctx"), id(c.req.param("id")), input));
});

supplierRoutes.post("/contracts/:id/extract", async (c) => c.json(await extractClauses(c.get("ctx"), id(c.req.param("id")))));

// obligations a person chose from an extraction (created as them: the contract's own write rules apply)
supplierRoutes.post("/contracts/:id/obligations", async (c) => {
  const ctx = c.get("ctx");
  const contractId = id(c.req.param("id"));
  const input = await body(c, z.object({ items: z.array(z.object({ title: z.string().min(2).max(200), party: z.enum(["supplier", "us"]), due_date: DATE.nullish(), recurrence: z.enum(["none", "monthly", "quarterly", "annual"]).optional(), description: z.string().max(4000).nullish() })).min(1).max(25) }));
  const { row } = await get(ctx, "contract", contractId);
  const { def } = await defFor(ctx, "contract");
  if (!access().canWrite(ctx, def, row)) throw forbidden("اجازهٔ تغییر این قرارداد را ندارید");
  const created = await ctx.write(async (tx) => {
    const out: string[] = [];
    for (const it of input.items) out.push(String((await createIn(tx, ctx, "contract_obligation", { contract_id: contractId, title: it.title, party: it.party, due_date: it.due_date ?? null, recurrence: it.recurrence ?? "none", description: it.description ?? null })).id));
    return out;
  });
  return c.json({ created });
});

supplierRoutes.get("/suppliers/:id/360", async (c) => c.json(await supplier360(c.get("ctx"), id(c.req.param("id")))));

supplierRoutes.post("/scorecards/run", async (c) => {
  const ctx = c.get("ctx");
  if (!(await holds(ctx, "vendor", "write", "group"))) throw forbidden("محاسبهٔ کارنامه با مدیر تأمین‌کنندگان است");
  return c.json(await computeScorecards(sysOf(ctx, ctx.user.id)));
});
