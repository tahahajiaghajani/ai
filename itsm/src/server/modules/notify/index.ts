// The notification service (docs/spec/services/notify.md): rules on record events → recipients → per-recipient
// rendering under their own access → channels (in-app inbox, e-mail, SMS, messengers and webhooks) with a delivery
// log; e-mail to record (IMAP); the person's inbox and preferences. `installNotify()` registers the record-event
// subscriber, the job handlers and the validation hooks of the service's tables (once per process; the app does it
// when it is created, src/server/routes/modules.ts).
import { cleanPrefs, cleanRecipients } from "@shared/notify";
import { NOTIFY_TABLE_KEYS } from "@shared/tables/notify";
import { tableDef } from "@shared/tables";
import { onRecordEvent, registerHooks, validationError, type RecordEvent } from "../../engine";
import type { JobContext } from "../../jobs";
import { actsHere, isUuid, sysCtx, systemRows } from "./common";
import { dispatchEvent, registerDeliveryJobs, scheduleCleanup } from "./deliver";
import { ensurePoller, registerInboundJobs } from "./inbound";
import { invalidateRules, ruleProblems, templateProblem } from "./rules";
import { channelProblems } from "./channels";
import { installNotifyFlowStep } from "./flows";

export { dispatchEvent, notifyPeople, prefsOf, type DirectNotify, type SendPayload } from "./deliver";
export { registerOnCallSource, type OnCallSource } from "./recipients";
export { setTransportFactory, markdownToHtml, markdownToText, emailLayout, type TransportFactory } from "./mail";
export { setMailboxOpener, ingestMessage, pollChannel, stripQuoted, loopReason, type MailboxOpener, type MailboxSession } from "./inbound";
export { renderFor, type EventSnap, type Rendered } from "./render";
export { BUILTINS, candidateRules, invalidateRules } from "./rules";
export { outsideRequest, smsRequest } from "./channels";
export { actsHere } from "./common";
export { notifyStep, installNotifyFlowStep } from "./flows";

/** The record-event subscriber: service tables keep their caches and pollers; every other event may notify. */
async function onEvent(e: RecordEvent, jctx: JobContext): Promise<void> {
  // not about a stored record of an organisation (a synthetic or malformed event): nothing to notify, nothing to retry
  if (!isUuid(e.org_id) || !isUuid(e.id)) return;
  if (NOTIFY_TABLE_KEYS.has(e.table)) {
    if (e.table === "notification_rule") invalidateRules(e.org_id);
    if (e.table === "email_channel" && e.kind !== "record.deleted" && actsHere(jctx.cfg)) {
      const sys = await sysCtx(jctx.cfg, e.org_id);
      const [ch] = await systemRows<{ active: boolean; inbound: boolean }>(sys, "email_channel", "t.id = $1", [e.id]);
      if (ch?.active && ch.inbound) await ensurePoller(jctx.db, e.org_id, e.id);
    }
    return;
  }
  if (!actsHere(jctx.cfg)) return;
  await scheduleCleanup(jctx.db, e.org_id);
  await dispatchEvent(e, jctx);
}

let installed = false;

export function installNotify(): void {
  if (installed) return;
  installed = true;
  onRecordEvent("notify", onEvent);
  registerDeliveryJobs();
  registerInboundJobs();
  // flows' «ارسال اعلان» (docs/spec/SERVICES.md)
  installNotifyFlowStep();

  registerHooks("notification_rule", {
    beforeWrite(w) {
      if (w.op === "delete") return;
      const problems = ruleProblems(w.next);
      if (Object.keys(problems).length) throw validationError(problems);
      w.next.recipients = cleanRecipients(w.next.recipients);
      if (w.next.builtin) w.next.table_key = "*";
      if (w.next.event !== "custom") w.next.custom_event = null;
    },
  });
  registerHooks("notification_template", {
    beforeWrite(w) {
      if (w.op === "delete") return;
      const problems = templateProblem(w.next);
      if (Object.keys(problems).length) throw validationError(problems);
    },
  });
  registerHooks("notification_channel", {
    beforeWrite(w) {
      if (w.op === "delete") return;
      const problems = channelProblems(w.next);
      if (Object.keys(problems).length) throw validationError(problems);
    },
  });
  registerHooks("email_channel", {
    beforeWrite(w) {
      if (w.op === "delete") return;
      const problems: Record<string, string> = {};
      const n = w.next;
      if (n.inbound) {
        if (!String(n.imap_host ?? "").trim()) problems.imap_host = "برای دریافت ایمیل، سرور IMAP را وارد کنید";
        if (!String(n.imap_user ?? "").trim()) problems.imap_user = "نام کاربری IMAP را وارد کنید";
        const target = tableDef(String(n.target_table ?? "todo"));
        if (!target || target.virtual || NOTIFY_TABLE_KEYS.has(target.key)) problems.target_table = `جدول «${n.target_table ?? ""}» برای رکوردهای ایمیل مناسب نیست`;
      }
      for (const f of ["smtp_host", "imap_host"] as const) {
        const h = String(n[f] ?? "").trim();
        if (h && !/^[a-z0-9.-]+$|^\[[0-9a-f:]+\]$/i.test(h)) problems[f] = "نام سرور معتبر نیست (مثلاً mail.example.com)";
      }
      if (Object.keys(problems).length) throw validationError(problems);
    },
  });
  registerHooks("notification_pref", {
    beforeWrite(w) {
      if (w.op === "delete") return;
      const p = cleanPrefs(w.next);
      w.next.optouts = p.optouts;
      w.next.quiet_from = p.quiet_from;
      w.next.quiet_to = p.quiet_to;
      w.next.digest = p.digest;
    },
  });
}
