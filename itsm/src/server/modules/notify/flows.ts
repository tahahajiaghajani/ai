// The notification service's part in flows (docs/spec/services/flows.md §8, docs/spec/SERVICES.md), installed with
// the service (`installNotify()` → `installNotifyFlowStep()`): «ارسال اعلان» queues a notification to each recipient
// with `notifyPeople`, inside the step's transaction (the delivery jobs exist exactly when the step committed).
// Recipients come from the flow's helpers — people, user fields of the record, groups (members, leads and observers,
// as the service's own rules count them). Each one is rendered and delivered under their own access when the job
// runs: a recipient who cannot read the record gets nothing (logged `no_access`), hidden fields read «(محدود)».
import { aboutRecord, groupMembers, recipients, registerFlowStepHandler, type FlowStepHandler } from "../flows";
import { notifyPeople } from "./deliver";

/** «ارسال اعلان» through the notification service. */
export const notifyStep: FlowStepHandler = {
  transactional: true,
  async run(s) {
    const about = aboutRecord(s);
    if (!about) return { error: "اعلان دربارهٔ یک رکورد فرستاده می‌شود؛ «دربارهٔ رکورد» را تعیین کنید" };
    const to = await recipients(s, s.node.config.to);
    const users = [...new Set([...to.users, ...(await groupMembers(s, to.groups, ["member", "lead", "observer"]))])];
    const subject = s.text(s.node.config.subject).trim().slice(0, 300) || s.run.flowName;
    const body = s.text(s.node.config.body).slice(0, 20_000);
    const count = await notifyPeople(s.tx!, s.orgId, {
      table: about.table,
      id: about.id,
      users,
      event: "custom",
      label: s.run.flowName,
      subject,
      body,
      channels: ["in_app", "email"],
      actor: s.run.actorId,
      source: `گردش‌کار «${s.run.flowName}»`,
    });
    return { output: { recipients: users, groups: to.groups, subject, body, record: about, sent: count > 0, count } };
  },
};

/** Plug «ارسال اعلان» into flows (once per process, from `installNotify`). */
export function installNotifyFlowStep(): void {
  registerFlowStepHandler("notify", notifyStep);
}
