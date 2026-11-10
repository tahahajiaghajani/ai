// Executors of confirmed proposals. A tool of kind "propose" prepares a write as a proposal (its `kind` names the
// executor); nothing happens until a permitted person confirms it (POST /ai/actions/:id/confirm, ../actions.ts),
// which calls the executor here with the stored payload. An executor re-validates the payload, re-checks the
// permission of the record it writes and runs the module's normal service (inside its own ctx.write) — so the
// module's rules, numbering and audit entry apply exactly as from its form. Records that have a draft state are
// created as drafts. The platform itself proposes nothing; modules register their executors with
// `registerProposalExecutor`.
import type { Ctx } from "../../../context";
import type { AiProposalOutcome, AiRef } from "@shared/ai/types";
import { bad } from "../../../http/errors";

/** What a batch executor returns: the reference to show and each row's result (a failed row never stops the others). */
export interface ProposalOutcome {
  ref: AiRef;
  outcome: AiProposalOutcome;
}

export type ProposalExecutor = (ctx: Ctx, payload: unknown) => Promise<AiRef | ProposalOutcome>;

export const isOutcome = (v: AiRef | ProposalOutcome): v is ProposalOutcome => !!v && typeof v === "object" && "outcome" in v && "ref" in v;

/** Executors by proposal kind. */
export const EXECUTORS: Record<string, ProposalExecutor> = {};

/** Registers the executor of a proposal kind (a later one replaces it). Returns its removal. */
export function registerProposalExecutor(kind: string, run: ProposalExecutor): () => void {
  EXECUTORS[kind] = run;
  return () => {
    if (EXECUTORS[kind] === run) delete EXECUTORS[kind];
  };
}

/** Validate a stored payload with a zod schema (or any safeParse) and fail with a Persian message. */
export function parsePayload<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: { message: string }[] } } }, payload: unknown): T {
  const r = schema.safeParse(payload);
  if (!r.success) throw bad(`دادهٔ پیشنهاد معتبر نیست: ${r.error.issues[0]?.message ?? ""}`);
  return r.data;
}

/** Run a confirmed proposal; a batch's per-row outcome comes with its reference (see `executeProposal` for the ref only). */
export async function executeProposalFull(ctx: Ctx, kind: string, payload: unknown): Promise<AiRef | ProposalOutcome> {
  const run = Object.prototype.hasOwnProperty.call(EXECUTORS, kind) ? EXECUTORS[kind] : undefined;
  if (!run) throw bad("این نوع پیشنهاد پشتیبانی نمی‌شود");
  return run(ctx, payload);
}

export async function executeProposal(ctx: Ctx, kind: string, payload: unknown): Promise<AiRef> {
  const r = await executeProposalFull(ctx, kind, payload);
  return isOutcome(r) ? r.ref : r;
}
