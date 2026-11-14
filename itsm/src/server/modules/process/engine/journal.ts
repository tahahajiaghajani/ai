// Journal entries the workflow engine writes on a case (design F §3.6.4 step 6, §3.6.7): decisions («علی احمدی
// "تأیید رئیس شعبه" را تأیید کرد: …»), the start, a cancel, and system notes («برای "…" کسی پیدا نشد…»). They sync
// with the case, so a replica shows the history offline.
import type { Ctx } from "../../../context";
import type { Tx } from "../../../db";
import { addJournalIn, orgSchema } from "../../../engine";
import type { CaseRow } from "./store";

export async function caseJournal(
  tx: Tx,
  sys: Ctx,
  kase: Pick<CaseRow, "id" | "org_id" | "number">,
  body: string,
  opts: { kind?: "system" | "approval"; author?: string | null; data?: Record<string, unknown> } = {},
): Promise<void> {
  const def = (await orgSchema(sys, tx)).def("process_case");
  if (!def) return;
  await addJournalIn(tx, sys, def, kase as unknown as Record<string, unknown>, { kind: opts.kind ?? "system", body: body.slice(0, 4000), data: opts.data ?? null }, { trusted: true, author: opts.author ?? null });
}
