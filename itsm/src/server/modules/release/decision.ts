// The go/no-go decision of a release (REL-014). A release manager (the release area's approve right) records it on a
// release in readiness — the checks are evaluated again first, «اجرا» needs every blocking check passed or waived,
// «توقف» sends the release back to test or build — or the approvals service decides it: the seeded approval rule asks
// the release managers and the service owner when a major or emergency release reaches readiness, and the settled
// round becomes the decision (`onApprovalSettled`). Each decision is a row of `release_decision` with a snapshot of
// the readiness at that moment, a note on the release and the custom event `release.go_no_go` for the notification
// rule.
import { readinessOf } from "@shared/release/logic";
import { GO_DECISIONS } from "@shared/tables/release";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { addJournalIn, createIn, emitEvent, get, orgSchema, transitionIn, updateIn } from "../../engine";
import { bad, conflict, forbidden, notFound } from "../../http/errors";
import { onApprovalSettled, settledVerdict } from "../sla";
import { copyOf, evaluateChecksIn } from "./checks";
import { ids, liveRow, managesReleases, sysOf, type Row } from "./common";

export type Decision = "go" | "go_with_conditions" | "no_go";

const label = (d: string) => GO_DECISIONS.find((o) => o.value === d)?.label ?? d;

/** People told about a decision: the release's manager, coordinator and stakeholders. */
export const releasePeople = (r: Row): string[] => ids([r.release_manager_id, r.assigned_to, ...(Array.isArray(r.stakeholders) ? r.stakeholders : [])]);

/** Record a decision inside `tx` (the checks were just evaluated by the caller). */
export async function recordDecisionIn(
  tx: Tx,
  ctx: Ctx,
  release: Row,
  input: { decision: Decision; conditions?: string | null; rationale: string; via: "manual" | "approval"; by: string | null; return_to?: "test" | "build" },
): Promise<Row> {
  const sys = sysOf(ctx);
  const outcome = await evaluateChecksIn(tx, ctx, String(release.id));
  const r = outcome.readiness;
  if (input.decision !== "no_go" && !r.ready) {
    throw conflict(`پیش از «${label(input.decision)}» این بررسی‌های بازدارنده باید قبول یا با دلیل چشم‌پوشی شوند: ${r.blockers.join("، ")}`);
  }
  const fresh = (await liveRow(tx, sys, "release", release.id)) ?? release;
  const at = new Date().toISOString();
  const row = await createIn(tx, sys, "release_decision", {
    release_id: release.id, decision: input.decision, conditions: input.conditions ?? null, rationale: input.rationale, decided_by: input.by, decided_at: at, via: input.via,
    snapshot: {
      readiness: { total: r.total, passed: r.passed, failed: r.failed, waived: r.waived, pending: r.pending, pct: r.pct },
      risk: { score: fresh.risk_score ?? null, band: fresh.risk_band ?? null },
      checks: outcome.results.map((x) => ({ name: x.name, status: x.status, blocking: x.blocking !== false })),
    },
    ...copyOf(fresh),
  }, { trusted: true });
  await updateIn(tx, sys, "release", String(release.id), { go_no_go: input.decision, go_no_go_at: at, go_conditions: input.conditions ?? null }, { trusted: true, keepVersion: true });
  const schema = await orgSchema(sys, tx);
  const def = schema.def("release")!;
  const body = [`**تصمیم اجرا: ${label(input.decision)}**`, input.conditions ? `شرط‌ها: ${input.conditions}` : "", `دلیل: ${input.rationale}`, `آمادگی: ${r.pct.toLocaleString("fa-IR")}٪`].filter(Boolean).join("\n\n");
  await addJournalIn(tx, sys, def, fresh, { kind: "work_note", body }, { trusted: true, author: input.by });
  await emitEvent(tx, sys, { kind: "record.release.go_no_go", table: "release", id: String(release.id), number: fresh.number ?? null, actor: input.by, data: { users: releasePeople(fresh), decision: input.decision } });
  if (input.decision === "no_go" && fresh.state === "readiness") {
    await transitionIn(tx, input.by ? sysOf(ctx, input.by) : sys, "release", String(release.id), input.return_to ?? "test", {}, { trusted: true });
  }
  return row;
}

/** A release manager's decision on a release in readiness. */
export async function decideRelease(ctx: Ctx, id: string, input: { decision: Decision; conditions?: string | null; rationale: string; return_to?: "test" | "build" }): Promise<Row> {
  const { row } = await get(ctx, "release", id);
  if (!(await managesReleases(ctx.db, ctx))) throw forbidden("تصمیم اجرا یا توقف با مدیر انتشار است");
  if (row.state !== "readiness") throw conflict("تصمیم اجرا فقط برای انتشاری است که در مرحلهٔ «آمادگی و تصمیم» است");
  if (!input.rationale.trim()) throw bad("دلیل تصمیم را بنویسید");
  if (input.decision === "go_with_conditions" && !String(input.conditions ?? "").trim()) throw bad("شرط‌های اجرا را بنویسید");
  return ctx.write(async (tx) => {
    const current = await liveRow(tx, sysOf(ctx), "release", id);
    if (!current) throw notFound("انتشار پیدا نشد");
    return recordDecisionIn(tx, ctx, current, { ...input, via: "manual", by: ctx.user.id });
  });
}

/** The readiness of a release as stored (for the board), without evaluating. */
export const readinessOfRows = readinessOf;

/** Settled approval rounds of a release in readiness become its decision. */
export function installDecisionHooks(): (() => void)[] {
  return [
    onApprovalSettled("release", async (s) => {
      const { tx, ctx, record, by } = s;
      // the release's approvals as a whole (a re-run that left nothing open is `replanned`, never a rejection; a
      // withdrawal never approves)
      const verdict = settledVerdict(s);
      if (record.state !== "readiness" || !verdict) return;
      if (verdict === "approved") {
        // a Go only when nothing blocks; otherwise the approvers' yes is noted and the manager decides
        const r = await evaluateChecksIn(tx, ctx, String(record.id));
        if (!r.readiness.ready) {
          const schema = await orgSchema(ctx, tx);
          await addJournalIn(tx, ctx, schema.def("release")!, record, { kind: "work_note", body: `تأییدکنندگان موافقت کردند، اما این بررسی‌های بازدارنده هنوز قبول نشده‌اند: ${r.readiness.blockers.join("، ")}. تصمیم اجرا پس از رفع آن‌ها ثبت شود.` }, { trusted: true });
          return;
        }
        await recordDecisionIn(tx, ctx, record, { decision: "go", rationale: "تأییدکنندگان انتشار موافقت کردند", via: "approval", by });
      } else {
        await recordDecisionIn(tx, ctx, record, { decision: "no_go", rationale: "تأیید انتشار رد شد", via: "approval", by, return_to: "test" });
      }
    }),
  ];
}
