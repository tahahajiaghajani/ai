// The workflows' notifications (design F §3.5 «Notifications», §5, package F4c): seeded rules of the notification
// service, editable as usual (switch one off, change its channels or its template), with their templates:
//   · «مرحله‌ای منتظر شماست» — a step opened for you (`record.process_waiting`, people named by the event);
//   · «پرونده برای اصلاح به شما بازگشت» — a «بازگشت» reopened a step for you (`record.process_returned`);
//   · «مرحلهٔ بی‌انجام‌دهنده» — a step found nobody; the process managers (or the administrators) are told, with the
//     resolver's reasons (`record.process_unassigned`, `event.reason`) — exactly those the opening named (`told`: who
//     of them may be told, already readers of the case, engine/waiting.ts `managersNotice`);
//   · «گردش‌کار شما به پایان رسید / رد شد / لغو شد» — the requester, when the case closes (`record.updated`).
// The events come from the engine's `record.process_step_opened` (a subscriber here turns each opening into the notice
// it means) and from a manager's reassign. Recipients are access-filtered on delivery, as for every rule. The timers'
// reminders and escalations, delegation moves and a stopped run keep their direct notices (F4b).
// Seeds are written once per organisation by the job `process.seed` — queued for a new organisation, and by the first
// publish of an organisation that existed before (a marker in sm_kv: a rule the administrator deletes stays deleted).
// Only where cases advance (a linked Windows app never seeds: it pulls the authority's rules).
import type { Cond } from "@shared/model/conditions";
import type { Ctx, ServerConfig } from "../../../context";
import type { Queryable, Tx } from "../../../db";
import { createIn, emitOrgEvent, onRecordEvent, systemCtx, updateIn, type RecordEvent } from "../../../engine";
import { registerJobHandler, enqueue } from "../../../jobs";
import { registerOrgSeed } from "../../orgs/service";
import { SEED_DELAY_MS } from "../../sla";
import { processesRunHere, STEP_OPENED } from "../engine";
import { isId } from "../engine/store";
import { caseManagers } from "../timers/timer";
import { SEED_JOB } from "../publish/service";
import { orgAdmins } from "./common";

export const EVENT_WAITING = "record.process_waiting";
export const EVENT_RETURNED = "record.process_returned";
export const EVENT_UNASSIGNED = "record.process_unassigned";
/** 2 (1.1.5): «مرحلهٔ بی‌انجام‌دهنده» says why nobody was found (`{{event.reason}}`). */
export const NOTICES_VERSION = 2;
const MARKER = (orgId: string) => `process.notices:${orgId}`;

const ids = (v: unknown): string[] => [...new Set((Array.isArray(v) ? v : []).filter(isId).map((x) => x.toLowerCase()))];

/** Tell people a step waits for them (a manager's reassign; the subscriber below for openings). */
export async function emitWaiting(q: Queryable, orgId: string, c: { id: string; number: string | null }, users: string[], label: string, returned = false, actor: string | null = null): Promise<void> {
  const people = ids(users);
  if (!people.length) return;
  await emitOrgEvent(q, orgId, { kind: returned ? EVENT_RETURNED : EVENT_WAITING, table: "process_case", id: c.id, number: c.number, actor, data: { users: people, label } });
}

/** A step opened: the notice it means. */
export async function stepOpenedNotice(e: RecordEvent, q: Queryable): Promise<void> {
  const d = e.data ?? {};
  const label = String(d.label ?? "");
  const people = ids(d.people);
  if (people.length) return emitWaiting(q, e.org_id, { id: e.id, number: e.number ?? null }, people, label, d.returned === true);
  if (d.status !== "nobody" && d.status !== "too_many" && d.status !== "managers") return;
  let users: string[];
  if (Array.isArray(d.told)) {
    // 1.1.5: the opening chose whom the notice tells — those of the managers (or administrators) who may be told,
    // made readers of the case in its transaction (engine/readers.ts) — and its journal names them: exactly them
    users = ids(d.told);
  } else {
    // an event written before 1.1.5
    const kase = await q.one<{ org_id: string; managers: string[] | null; manager_groups: string[] | null }>(`select org_id, managers, manager_groups from sm_process_cases where org_id = $1 and id = $2 and deleted_at is null`, [e.org_id, e.id]);
    if (!kase) return;
    const named = ids(kase.managers).length || ids(kase.manager_groups).length;
    users = named ? await caseManagers(q, kase) : await orgAdmins(q, e.org_id);
    if (!users.length) return;
  }
  // the resolver's reasons, one line for the template (`{{event.reason}}`) and the list for whoever reads the event
  const notes = (Array.isArray(d.notes) ? d.notes : []).map(String).filter(Boolean).slice(0, 20);
  await emitOrgEvent(q, e.org_id, {
    kind: EVENT_UNASSIGNED, table: "process_case", id: e.id, number: e.number ?? null, actor: null,
    data: { users, label, message: d.message ?? null, notes, reason: notes.join("؛ ").slice(0, 1000) || null },
  });
}

// ----- the seeds --------------------------------------------------------------------------------------------------

interface Seed {
  name: string;
  event: "custom" | "updated";
  custom_event?: string;
  condition?: Cond;
  recipients: Record<string, unknown>;
  subject: string;
  body: string;
  description: string;
  /** earlier bodies of this seed: a template still exactly one of them takes the new body on the next seeding */
  was?: string[];
}

const LINK = "\n\n[دیدن پرونده]({{link}})";
/** The template of «مرحلهٔ بی‌انجام‌دهنده» before 1.1.5 (replaced where the administrator left it as it was). */
const UNASSIGNED_BODY_V1 = `برای مرحلهٔ «{{event.label}}» از پروندهٔ {{record.number}} «{{record.title}}» کسی پیدا نشد؛ مرحله را به کسی بسپارید.${LINK}`;
const UNASSIGNED_BODY = `برای مرحلهٔ «{{event.label}}» از پروندهٔ {{record.number}} «{{record.title}}» کسی پیدا نشد{{#if event.reason}} ({{event.reason}}){{/if}}؛ مرحله را به کسی بسپارید یا «دوباره پیدا کردن انجام‌دهنده» را بزنید.${LINK}`;

export const NOTICE_SEEDS: Seed[] = [
  {
    name: "مرحله‌ای منتظر شماست", event: "custom", custom_event: "process_waiting", recipients: { event_users: true },
    subject: "مرحله‌ای منتظر شماست: «{{event.label}}»", body: `مرحلهٔ «{{event.label}}» از پروندهٔ {{record.number}} «{{record.title}}» به شما سپرده شد.${LINK}`,
    description: "به کسانی که مرحله‌ای از یک گردش‌کار به آن‌ها سپرده شد",
  },
  {
    name: "پرونده برای اصلاح به شما بازگشت", event: "custom", custom_event: "process_returned", recipients: { event_users: true },
    subject: "پروندهٔ {{record.number}} برای اصلاح به شما بازگشت", body: `پروندهٔ {{record.number}} «{{record.title}}» برای اصلاح در مرحلهٔ «{{event.label}}» به شما بازگشت.${LINK}`,
    description: "به کسی که پرونده با «بازگشت برای اصلاح» دوباره به او رسید",
  },
  {
    name: "مرحلهٔ بی‌انجام‌دهنده", event: "custom", custom_event: "process_unassigned", recipients: { event_users: true },
    subject: "برای «{{event.label}}» کسی پیدا نشد", body: UNASSIGNED_BODY,
    description: "به مسئولان گردش‌کار (یا مدیران سازمان) وقتی مرحله‌ای کسی را برای انجام ندارد",
    was: [UNASSIGNED_BODY_V1],
  },
  {
    name: "گردش‌کار شما به پایان رسید", event: "updated", condition: { f: "state", op: "changes_to", v: "completed" }, recipients: { requester: true },
    subject: "پروندهٔ {{record.number}} به پایان رسید", body: `پروندهٔ {{record.number}} «{{record.title}}» با موفقیت به پایان رسید.${LINK}`,
    description: "به درخواست‌دهنده، وقتی پرونده انجام می‌شود",
  },
  {
    name: "گردش‌کار شما رد شد", event: "updated", condition: { f: "state", op: "changes_to", v: "rejected" }, recipients: { requester: true },
    subject: "پروندهٔ {{record.number}} رد شد", body: `پروندهٔ {{record.number}} «{{record.title}}» رد شد. دلیل را در تاریخچهٔ پرونده ببینید.${LINK}`,
    description: "به درخواست‌دهنده، وقتی پرونده رد می‌شود",
  },
  {
    name: "گردش‌کار شما لغو شد", event: "updated", condition: { f: "state", op: "changes_to", v: "canceled" }, recipients: { requester: true },
    subject: "پروندهٔ {{record.number}} لغو شد", body: `پروندهٔ {{record.number}} «{{record.title}}» لغو شد.${LINK}`,
    description: "به درخواست‌دهنده، وقتی مسئولان گردش‌کار پرونده را لغو می‌کنند",
  },
];

export interface SeedResult {
  skipped: boolean;
  created: { templates: number; rules: number };
}

/** Write the seeds into the organisation inside `tx` (as the system), once — unless forced. */
export async function seedNoticesIn(tx: Tx, sys: Ctx, opts: { force?: boolean } = {}): Promise<SeedResult> {
  const orgId = sys.org.id;
  const out: SeedResult = { skipped: false, created: { templates: 0, rules: 0 } };
  const marker = await tx.one<{ value: { version?: number } | null }>(`select value from sm_kv where key = $1`, [MARKER(orgId)]);
  const before = Number(marker?.value?.version ?? 0);
  if (!opts.force && before >= NOTICES_VERSION) return { ...out, skipped: true };
  // an organisation seeded before (an earlier version) gets the newer templates only: what its administrator deleted
  // stays deleted, and a template they edited stays theirs
  const fresh = opts.force === true || before < 1;
  for (const s of NOTICE_SEEDS) {
    const name = `گردش‌کارها — ${s.name}`;
    let tpl = await tx.one<{ id: string; body: string | null }>(`select id, body from sm_notification_templates where org_id = $1 and name = $2 and deleted_at is null`, [orgId, name]);
    if (!tpl) {
      if (!fresh) continue;
      tpl = (await createIn(tx, sys, "notification_template", { name, event: s.event, table_key: "process_case", subject: s.subject, body: s.body, active: true, description: s.description }, { trusted: true })) as { id: string; body: string | null };
      out.created.templates++;
    } else if (s.was?.includes(String(tpl.body ?? ""))) {
      // an earlier seed's body nobody edited: the new one
      await updateIn(tx, sys, "notification_template", tpl.id, { body: s.body }, { trusted: true });
    }
    const rule = await tx.one(`select id from sm_notification_rules where org_id = $1 and table_key = 'process_case' and name = $2 and deleted_at is null`, [orgId, s.name]);
    if (rule || !fresh) continue;
    await createIn(
      tx,
      sys,
      "notification_rule",
      {
        name: s.name, table_key: "process_case", event: s.event, custom_event: s.custom_event ?? null, condition: s.condition ?? null, recipients: s.recipients,
        channels: ["in_app", "email"], template_id: tpl.id, active: true, notify_actor: false, digest: false, mandatory: false, description: s.description,
      },
      { trusted: true },
    );
    out.created.rules++;
  }
  await tx.query(
    `insert into sm_kv (key, value, updated_at) values ($1, $2::jsonb, now()) on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [MARKER(orgId), JSON.stringify({ version: NOTICES_VERSION, at: new Date().toISOString() })],
  );
  return out;
}

/** The seeding job's work: the organisation's seeds, where cases advance. */
export async function seedNotices(cfg: ServerConfig, orgId: string, opts: { force?: boolean } = {}): Promise<SeedResult> {
  if (!(await processesRunHere(cfg, orgId))) return { skipped: true, created: { templates: 0, rules: 0 } };
  const sys = await systemCtx(cfg, orgId);
  return sys.write((tx) => seedNoticesIn(tx, sys, opts));
}

let installed = false;

export function installProcessNotices(): void {
  if (installed) return;
  installed = true;
  onRecordEvent("process.notices", (e, jctx) => stepOpenedNotice(e, jctx.db), { tables: ["process_case"], kinds: [STEP_OPENED] });
  registerJobHandler(SEED_JOB, async (job, jctx) => {
    if (!job.org_id) return;
    await seedNotices(jctx.cfg as ServerConfig, job.org_id);
  });
  registerOrgSeed((tx, orgId) => enqueue(tx, { kind: SEED_JOB, orgId, delayMs: SEED_DELAY_MS + 150_000, dedupeKey: SEED_JOB, maxAttempts: 5 }).then(() => undefined));
}
