// /api/o/:org/treasury — receipts, payments and transfers, the cheque register and its
// lifecycle, the cash & bank book and the dashboard summary (see src/server/modules/treasury/).
import { router, body, type C } from "../http/hono";
import { bad } from "../http/errors";
import { isUuid } from "@shared/id";
import { saveDoc, deleteDoc, getDoc, listDocs, allocations, openInvoices } from "../modules/treasury/docs";
import { chequeAction, chequeByOp, getCheque, listCheques, nextSerial } from "../modules/treasury/cheques";
import { balances, cashBankBook, chequesDue, partyBalance, summary } from "../modules/treasury/reports";
import { chequeActionSchema, docSchema } from "../modules/treasury/schema";
import { ISO_DATE, type DocKind } from "../modules/treasury/common";

export const treasuryRoutes = router();

const date = (v: string | undefined) => (v && ISO_DATE.test(v) ? v : undefined);
const uuid = (v: string | undefined) => (v && isUuid(v) ? v : undefined);
const idParam = (c: C, name = "id") => {
  const id = c.req.param(name) ?? "";
  if (!isUuid(id)) throw bad("شناسه معتبر نیست");
  return id;
};

// ---------------------------------------------------------------- documents

treasuryRoutes.get("/docs", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("treasury", "view");
  const q = c.req.query();
  const kind = ["receipt", "payment", "transfer"].includes(q.kind ?? "") ? q.kind : undefined;
  return c.json(
    await listDocs(ctx.db, ctx.org.id, {
      kind,
      from: date(q.from),
      to: date(q.to),
      party_id: uuid(q.party_id),
      fiscal_year_id: uuid(q.fiscal_year_id),
      q: q.q,
      page: Number(q.page) || 1,
      size: Number(q.size) || 50,
      sort: q.sort,
      dir: q.dir,
    }),
  );
});

treasuryRoutes.get("/docs/:id", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("treasury", "view");
  return c.json({ doc: await getDoc(ctx.db, ctx.org.id, idParam(c)) });
});

treasuryRoutes.post("/docs", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("treasury", "edit");
  const input = await body(c, docSchema);
  const saved = await ctx.write((tx) => saveDoc(tx, ctx, input));
  return c.json({ doc: saved });
});

treasuryRoutes.put("/docs/:id", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("treasury", "edit");
  const id = idParam(c);
  const input = await body(c, docSchema);
  const saved = await ctx.write((tx) => saveDoc(tx, ctx, input, id));
  return c.json({ doc: saved });
});

treasuryRoutes.delete("/docs/:id", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("treasury", "full");
  const id = idParam(c);
  await ctx.write((tx) => deleteDoc(tx, ctx, id));
  return c.json({ ok: true });
});

/** Allocations of receipts/payments to invoices: ?invoice_id= or ?invoice_ids=a,b */
treasuryRoutes.get("/allocations", async (c) => {
  const ctx = c.get("ctx");
  if (!ctx.can("treasury", "view") && !ctx.can("sales", "view") && !ctx.can("purchases", "view")) ctx.need("treasury", "view");
  const q = c.req.query();
  const ids = [q.invoice_id, ...(q.invoice_ids ?? "").split(",")].map((s) => (s ?? "").trim()).filter(isUuid);
  if (!ids.length) throw bad("فاکتور را مشخص کنید");
  return c.json(await allocations(ctx.db, ctx.org.id, Array.from(new Set(ids)).slice(0, 500)));
});

/** The party's invoices a receipt (kind=receipt) or payment (kind=payment) can settle. */
treasuryRoutes.get("/invoices", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("treasury", "view");
  const q = c.req.query();
  const partyId = uuid(q.party_id);
  if (!partyId) throw bad("شخص را انتخاب کنید");
  const kind = (q.kind === "payment" ? "payment" : "receipt") as DocKind;
  return c.json({ rows: await openInvoices(ctx.db, ctx.org.id, { partyId, kind, docId: uuid(q.doc_id) ?? null }) });
});

treasuryRoutes.get("/party-balance/:id", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("treasury", "view");
  return c.json(await partyBalance(ctx.db, ctx, idParam(c)));
});

// ---------------------------------------------------------------- cheques

treasuryRoutes.get("/cheques", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("treasury", "view");
  const q = c.req.query();
  return c.json(
    await listCheques(ctx.db, ctx, {
      direction: q.direction === "received" || q.direction === "issued" ? q.direction : undefined,
      status: q.status,
      from: date(q.from),
      to: date(q.to),
      party_id: uuid(q.party_id),
      bank_account_id: uuid(q.bank_account_id),
      q: q.q,
      overdue: q.overdue,
      open: q.open,
      page: Number(q.page) || 1,
      size: Number(q.size) || 50,
      sort: q.sort,
      dir: q.dir,
    }),
  );
});

treasuryRoutes.get("/cheques/by-op/:opId", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("treasury", "view");
  return c.json({ cheque: await chequeByOp(ctx.db, ctx.org.id, idParam(c, "opId")) });
});

treasuryRoutes.get("/cheques/:id", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("treasury", "view");
  return c.json({ cheque: await getCheque(ctx.db, ctx, idParam(c)) });
});

treasuryRoutes.post("/cheques/:id/action", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("treasury", "edit");
  const id = idParam(c);
  const input = await body(c, chequeActionSchema);
  const r = await ctx.write((tx) => chequeAction(tx, ctx, id, input));
  return c.json({ ok: true, ...r });
});

treasuryRoutes.get("/cheque-books/:id/next-serial", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("treasury", "view");
  return c.json(await nextSerial(ctx.db, ctx.org.id, idParam(c)));
});

// ---------------------------------------------------------------- reports

/** Cash & bank book: ?cash_box_id= or ?bank_account_id=, &from=&to=&drafts=1 */
treasuryRoutes.get("/book", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("treasury", "view");
  const q = c.req.query();
  const box = uuid(q.cash_box_id);
  const bank = uuid(q.bank_account_id);
  if (!box && !bank) throw bad("صندوق یا حساب بانکی را انتخاب کنید");
  return c.json(await cashBankBook(ctx.db, ctx, { kind: box ? "cash" : "bank", id: (box ?? bank)!, from: date(q.from), to: date(q.to), drafts: q.drafts === "1" }));
});

treasuryRoutes.get("/balances", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("treasury", "view");
  return c.json(await balances(ctx.db, ctx));
});

treasuryRoutes.get("/reports/cheques-due", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("treasury", "view");
  const q = c.req.query();
  return c.json(
    await chequesDue(ctx.db, ctx, {
      direction: q.direction === "received" || q.direction === "issued" ? q.direction : null,
      from: date(q.from) ?? null,
      to: date(q.to) ?? null,
    }),
  );
});

treasuryRoutes.get("/summary", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("treasury", "view");
  return c.json(await summary(ctx.db, ctx));
});
