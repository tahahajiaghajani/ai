// Executors of confirmed proposals (stream D). Each re-validates the stored payload, re-checks the
// permission of the document, and runs the module's normal service inside its own ctx.write — so
// the module's rules, numbering, audit entry and auto vouchers apply exactly as from its form.
// Documents that have a draft state are created as drafts; nothing is posted finally here.
import type { Ctx } from "../../../context";
import type { AiRef } from "@shared/ai/types";
import { bad } from "../../../http/errors";
import { createInvoice } from "../../goods/invoices";
import { saveVoucher } from "../../accounting/vouchers";
import { saveDoc } from "../../treasury/docs";
import { createDoc as createGoldDoc, docSchema as goldDocSchema } from "../../gold/docs";
import { KINDS as GOLD_KINDS } from "../../gold/pricing";
import { saveDeal, type DealInput } from "../../fx/deals";
import { create as createRow } from "../../data/crud";
import { fxPayload, invoicePayload, partyPayload, treasuryPayload, voucherPayload } from "./propose";
import { INVOICE_TITLE, ref } from "./common";

export type ProposalExecutor = (ctx: Ctx, payload: unknown) => Promise<AiRef>;

function parse<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: { message: string }[] } } }, payload: unknown): T {
  const r = schema.safeParse(payload);
  if (!r.success) throw bad(`دادهٔ پیشنهاد معتبر نیست: ${r.error.issues[0]?.message ?? ""}`);
  return r.data;
}

const invoice: ProposalExecutor = async (ctx, payload) => {
  const p = parse(invoicePayload, payload);
  const saved = await createInvoice(ctx, { ...p, status: "draft" });
  return ref("invoice", saved.id, `${INVOICE_TITLE[p.kind] ?? "فاکتور"} ${saved.no} (پیش‌نویس)`, { kind: p.kind });
};

const voucher: ProposalExecutor = async (ctx, payload) => {
  ctx.need("accounting", "edit");
  const p = parse(voucherPayload, payload);
  const saved = await ctx.write((tx) =>
    saveVoucher(tx, ctx.org, { date: p.date, description: p.description ?? null, kind: "normal", status: "draft", lines: p.lines as never }, { userId: ctx.user.id, origin: ctx.cfg.origin }),
  );
  return ref("voucher", saved.id, `سند ${saved.no} (پیش‌نویس)`);
};

const treasury: ProposalExecutor = async (ctx, payload) => {
  ctx.need("treasury", "edit");
  const p = parse(treasuryPayload, payload);
  const saved = await ctx.write((tx) => saveDoc(tx, ctx, { ...p, account_id: null, detail_id: null, allocs: null }));
  const title = p.kind === "receipt" ? "دریافت" : p.kind === "payment" ? "پرداخت" : "انتقال";
  return ref("treasury_doc", saved.id, `${title} ${saved.no}`);
};

const goldDoc: ProposalExecutor = async (ctx, payload) => {
  const p = parse(goldDocSchema, payload);
  const doc = (await createGoldDoc(ctx, { ...p, status: "draft" })) as { id: string; no: number; kind: string };
  return ref("gold_doc", doc.id, `${(GOLD_KINDS as Record<string, { title: string }>)[doc.kind]?.title ?? "سند طلا"} ${doc.no} (پیش‌نویس)`);
};

const fxDeal: ProposalExecutor = async (ctx, payload) => {
  const p = parse(fxPayload, payload);
  const saved = await saveDeal(ctx, { ...p, status: "draft" } as DealInput);
  const deal = saved.deal as unknown as { id: string; no: number };
  return ref("fx_deal", deal.id, `معاملهٔ ارز ${deal.no} (پیش‌نویس)`);
};

const party: ProposalExecutor = async (ctx, payload) => {
  const p = parse(partyPayload, payload);
  const row = await createRow(ctx, "party", p as Record<string, unknown>);
  return ref("party", String(row.id), String(row.name ?? p.name));
};

export const EXECUTORS: Record<string, ProposalExecutor> = {
  sales_invoice: invoice,
  purchase_invoice: invoice,
  quote: invoice,
  voucher,
  receipt: treasury,
  payment: treasury,
  transfer: treasury,
  gold_doc: goldDoc,
  fx_deal: fxDeal,
  party,
};

export async function executeProposal(ctx: Ctx, kind: string, payload: unknown): Promise<AiRef> {
  const run = EXECUTORS[kind];
  if (!run) throw bad("این نوع پیشنهاد پشتیبانی نمی‌شود");
  return run(ctx, payload);
}
