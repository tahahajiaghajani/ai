// The built-in node types (docs/spec/services/flows.md §6). Control nodes — «شروع», «اجرای موازی», «پیوستن شاخه‌ها»,
// «برای هر مورد», «پایان» — live in the executor; everything else is a step handler registered here. Steps that
// change records are transactional (their writes commit with the step); «فراخوانی HTTP» is in http.ts. «ارسال اعلان»,
// «درخواست تأیید» and «مهارت هوش مصنوعی» are stand-ins until the notification, approval and AI services register
// their own handlers (registry.ts).
import { pgArray } from "../../db";
import { addJournalIn, condEnv, createIn, defFor, requireReadable, updateIn } from "../../engine";
import { FLOW_LIMITS, compareData, nodeTable, type TriggerConfig } from "@shared/flows";
import { faDigits } from "@shared/format";
import { businessClock, flowSkill, registerBuiltinStepHandler, type StepContext, type StepOutcome, type WaitInfo } from "./registry";
import { matchesRecord, parseInstant, readRecord, recordIdOf, storedOutput } from "./records";
import { startRun } from "./executor";
import { loadVersion } from "./store";
import { resolveRunAs } from "./triggers";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNIT_MS: Record<string, number> = { minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 7 * 86_400_000 };

/** Milliseconds of a { amount, unit } setting (0 when invalid). */
export function durationMs(d: unknown): number {
  if (!d || typeof d !== "object") return 0;
  const amount = Number((d as { amount?: unknown }).amount);
  const unit = UNIT_MS[String((d as { unit?: unknown }).unit ?? "")];
  return Number.isFinite(amount) && amount > 0 && unit ? Math.round(amount * unit) : 0;
}

const triggerOf = (s: StepContext): Partial<TriggerConfig> => ({ table: typeof s.data.trigger?.table === "string" ? (s.data.trigger.table as string) : null });

/** The table and record a record step works on. */
function target(s: StepContext): { table: string; id: string } {
  const table = nodeTable(s.node.config, triggerOf(s));
  if (!table) throw new Error("جدول این گام مشخص نیست");
  return { table, id: recordIdOf(s.render, s.node.config) };
}

/** Field values with their pills filled (a pill naming nothing clears the field). */
function values(s: StepContext): Record<string, unknown> {
  const raw = s.node.config.values;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("«مقدارها» معتبر نیست");
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const r = s.render(v);
    out[k] = r === undefined ? null : r;
  }
  return out;
}

function assignments(s: StepContext, key: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const a of Array.isArray(s.node.config[key]) ? (s.node.config[key] as { name?: unknown; value?: unknown }[]) : []) {
    const name = String(a?.name ?? "").trim();
    if (!name) continue;
    const v = s.render(a.value);
    out[name] = v === undefined ? null : v;
  }
  return out;
}

const ids = (v: unknown): string[] => {
  const flat = (Array.isArray(v) ? v : [v]).flat(2);
  return [...new Set(flat.map((x) => (x && typeof x === "object" && "id" in (x as object) ? String((x as { id: unknown }).id) : String(x ?? "").trim())).filter((x) => UUID.test(x)).map((x) => x.toLowerCase()))];
};

/**
 * People and groups of a «گیرندگان» / «تأییدکنندگان» setting: members (ids or pills), user fields of the record the
 * step is about (read as the run's identity), groups (ids or pills).
 */
export async function recipients(s: StepContext, spec: unknown): Promise<{ users: string[]; groups: string[] }> {
  const r = (spec && typeof spec === "object" ? spec : {}) as { users?: unknown[]; fields?: unknown[]; groups?: unknown[] };
  const users = ids((r.users ?? []).map((u) => s.render(u)));
  const groups = ids((r.groups ?? []).map((g) => s.render(g)));
  const fields = (r.fields ?? []).map((f) => String(f)).filter(Boolean);
  if (fields.length) {
    const t = target(s);
    const rec = await readRecord(s.ctx, t.table, t.id);
    for (const f of fields) for (const id of ids(rec[f])) if (!users.includes(id)) users.push(id);
  }
  return { users, groups };
}

/** The record a notification or an approval is about (null when the step names none and the run has none). */
function aboutRecord(s: StepContext): { table: string; id: string } | null {
  try {
    return target(s);
  } catch {
    return null;
  }
}

// ----- records ----------------------------------------------------------------------------------------------------

registerBuiltinStepHandler("update_record", {
  transactional: true,
  async run(s) {
    const t = target(s);
    const stored = await updateIn(s.tx!, s.ctx, t.table, t.id, values(s));
    return { output: { id: t.id, record: await storedOutput(s.tx!, s.ctx, t.table, stored) } };
  },
});

registerBuiltinStepHandler("create_record", {
  transactional: true,
  async run(s) {
    const table = String(s.node.config.table ?? "").trim() || String(s.data.trigger?.table ?? "");
    if (!table) return { error: "جدول را انتخاب کنید" };
    const stored = await createIn(s.tx!, s.ctx, table, values(s));
    const record = await storedOutput(s.tx!, s.ctx, table, stored);
    return { output: { id: String(stored.id), number: record.number ?? null, record } };
  },
});

registerBuiltinStepHandler("add_comment", {
  transactional: true,
  async run(s) {
    const t = target(s);
    const body = s.text(s.node.config.body).trim();
    if (!body) return { error: "متن یادداشت خالی است" };
    const { def } = await defFor(s.ctx, t.table, s.tx!);
    const row = await requireReadable(s.ctx, def, t.id, await condEnv(s.ctx), s.tx!);
    const entry = await addJournalIn(s.tx!, s.ctx, def, row, { kind: s.node.config.kind === "comment" ? "comment" : "work_note", body: body.slice(0, 100_000) });
    return { output: { entry_id: entry.id } };
  },
});

// ----- logic ------------------------------------------------------------------------------------------------------

registerBuiltinStepHandler("branch", {
  async run(s) {
    const c = s.node.config;
    if (c.mode === "data") {
      const rules = Array.isArray(c.rules) ? (c.rules as { left?: unknown; op?: unknown; right?: unknown }[]) : [];
      const results = rules.map((r) => compareData(s.render(r.left), String(r.op ?? ""), s.render(r.right)));
      const ok = results.length > 0 && (c.match === "any" ? results.some(Boolean) : results.every(Boolean));
      return { port: ok ? "yes" : "no", output: { result: ok } };
    }
    const t = target(s);
    const ok = await matchesRecord(s.ctx, t.table, t.id, s.render(c.condition));
    return { port: ok ? "yes" : "no", output: { result: ok } };
  },
});

registerBuiltinStepHandler("set_vars", {
  async run(s) {
    const vars = assignments(s, "vars");
    return { vars, output: vars };
  },
});

// ----- waits ------------------------------------------------------------------------------------------------------

registerBuiltinStepHandler("wait_duration", {
  async run(s) {
    const c = s.node.config;
    const now = Date.now();
    let due: number;
    if (c.mode === "until") {
      const at = parseInstant(s.render(c.until), s.tz);
      if (at === null) return { error: "زمانِ «تا» معتبر نیست" };
      due = at;
    } else {
      const ms = durationMs(c.duration);
      if (!ms) return { error: "مدت انتظار معتبر نیست" };
      const clock = c.business ? businessClock() : null;
      if (c.business && !clock) s.log("تقویم کاری هنوز نصب نیست؛ مدت به وقت تقویمی شمرده شد");
      due = clock ? await clock.add({ cfg: s.cfg, orgId: s.orgId, from: now, ms }) : now + ms;
    }
    const output = { due_at: new Date(due).toISOString() };
    if (due <= now) return { output };
    return { wait: { kind: "timer", dueAt: due, data: output }, output };
  },
  async resume(s, w) {
    const due = w.dueAt ?? 0;
    if (due > Date.now() + 1000) return { wait: { kind: "timer", dueAt: due, data: w.data } };
    return { output: { due_at: new Date(due).toISOString() } };
  },
});

async function conditionCheck(s: StepContext, w: WaitInfo | null): Promise<StepOutcome> {
  const c = s.node.config;
  const t = target(s);
  if (await matchesRecord(s.ctx, t.table, t.id, s.render(c.condition))) return { output: { matched: true, timed_out: false } };
  const now = Date.now();
  const timeout = w ? (typeof w.data.timeout_at === "number" ? w.data.timeout_at : null) : durationMs(c.timeout) ? now + durationMs(c.timeout) : null;
  if (timeout !== null && now >= timeout) return { port: "timeout", output: { matched: false, timed_out: true } };
  const poll = Math.min(Math.max(Number(c.poll ?? 60) || 60, 1), 7 * 24 * 60) * 60_000;
  const dueAt = timeout !== null ? Math.min(timeout, now + poll) : now + poll;
  return { wait: { kind: "condition", key: `record:${t.table}:${t.id}`, dueAt, data: { table: t.table, id: t.id, timeout_at: timeout } } };
}

registerBuiltinStepHandler("wait_condition", {
  run: (s) => conditionCheck(s, null),
  resume: (s, w) => conditionCheck(s, w),
});

// ----- subflows ---------------------------------------------------------------------------------------------------

registerBuiltinStepHandler("subflow", {
  transactional: true,
  async run(s) {
    const flowId = ids([s.render(s.node.config.flow)])[0];
    if (!flowId) return { error: "گردش‌کار این گام مشخص نیست" };
    if (s.run.depth + 1 > FLOW_LIMITS.depth) return { error: `گردش‌کارها بیش از ${faDigits(FLOW_LIMITS.depth)} لایه یکدیگر را اجرا کرده‌اند` };
    const flow = await s.tx!.one<{ id: string; name: string; version_id: string | null }>(
      `select id, name, version_id from sm_flows where org_id = $1 and id = $2 and deleted_at is null`,
      [s.orgId, flowId],
    );
    if (!flow) return { error: "گردش‌کار این گام پیدا نشد" };
    const version = flow.version_id ? await loadVersion(s.tx!, s.orgId, flow.version_id) : null;
    if (!version) return { error: `گردش‌کار «${flow.name}» هنوز منتشر نشده است` };
    const publisher = await s.tx!.one<{ created_by: string | null }>(`select created_by from sm_flow_versions where id = $1`, [version.id]);
    const wait = s.node.config.wait !== false;
    const parent = s.triggerRecord;
    const child = await startRun(s.tx!, {
      orgId: s.orgId,
      flow: { id: flow.id, name: flow.name },
      version: { id: version.id, no: version.version_no },
      trigger: { kind: "subflow", table: parent?.table ?? null, id: parent?.id ?? null, inputs: assignments(s, "inputs"), parent: { run: s.run.id, flow: s.run.flowId } },
      actorId: s.run.actorId,
      runAs: resolveRunAs(version.trigger ?? { run_as: "trigger_user" }, s.run.runAsId, publisher?.created_by ?? null),
      depth: s.run.depth + 1,
      parentRunId: wait ? s.run.id : null,
    });
    if (!wait) return { output: { run_id: child, state: "running" } };
    return { wait: { kind: "subflow", key: `run:${child}`, data: { run_id: child } }, output: { run_id: child } };
  },
  async resume(_s, w) {
    const r = w.result ?? {};
    const runId = w.data.run_id ?? null;
    if (r.state === "completed") return { output: { run_id: runId, state: "completed", outputs: r.outputs ?? {} } };
    return { error: `زیرگردش‌کار ${r.state === "canceled" ? "لغو شد" : "ناموفق بود"}${r.error ? `: ${String(r.error)}` : ""}`, output: { run_id: runId, state: r.state ?? "failed" } };
  },
});

// ----- stand-ins for the services built next to the engine -----------------------------------------------------

/** «ارسال اعلان» until the notification service registers its handler: the message goes to the step log only. */
registerBuiltinStepHandler("notify", {
  async run(s) {
    const to = await recipients(s, s.node.config.to);
    const subject = s.text(s.node.config.subject);
    const body = s.text(s.node.config.body);
    s.log("سرویس اعلان هنوز نصب نیست؛ پیام فقط در گزارش اجرا ثبت شد");
    return { output: { recipients: to.users, groups: to.groups, subject, body, record: aboutRecord(s), sent: false } };
  },
});

/** Members of groups (members and leads) — approvers of the built-in approval. */
async function groupMembers(s: StepContext, groups: string[]): Promise<string[]> {
  if (!groups.length) return [];
  const rows = await s.cfg.db.query<{ user_id: string }>(
    `select distinct user_id from sm_group_members where org_id = $1 and group_id = any($2::uuid[]) and deleted_at is null and coalesce(kind, 'member') in ('member', 'lead')`,
    [s.orgId, pgArray(groups)],
  );
  return rows.map((r) => r.user_id);
}

/**
 * «درخواست تأیید» until the approvals service registers its handler: a built-in approval the approvers decide on the
 * run's page (POST /flows/waits/:id/decide). Rule «any»: the first decision counts; «all»: every approver must
 * approve, one rejection rejects.
 */
registerBuiltinStepHandler("approval", {
  async run(s) {
    const r = await recipients(s, s.node.config.approvers);
    const approvers = [...new Set([...r.users, ...(await groupMembers(s, r.groups))])];
    if (!approvers.length) return { error: "تأییدکننده‌ای پیدا نشد" };
    const title = s.text(s.node.config.title).slice(0, 300) || "درخواست تأیید";
    return {
      wait: {
        kind: "approval",
        key: `approval:flow:${s.run.id}:${s.stepKey}`,
        data: { approvers, rule: s.node.config.rule === "all" ? "all" : "any", title, message: s.text(s.node.config.message).slice(0, 4000), record: aboutRecord(s), decisions: [] },
      },
      output: { approvers },
    };
  },
  async resume(_s, w) {
    const r = w.result ?? {};
    const decision = r.decision === "approved" ? "approved" : "rejected";
    return { port: decision, output: { decision, by: r.by ?? null, comment: r.comment ?? "", decisions: r.decisions ?? [] } };
  },
});

/** «مهارت هوش مصنوعی»: a skill the AI layer registered (registerFlowSkill); without it the step does nothing. */
registerBuiltinStepHandler("ai_skill", {
  async run(s) {
    const key = String(s.render(s.node.config.skill) ?? "").trim();
    const skill = flowSkill(key);
    if (!skill) {
      s.log(`مهارت «${key || "—"}» هنوز نصب نیست؛ این گام کاری نکرد`);
      return { output: { skipped: true } };
    }
    const out = await skill.run(s, assignments(s, "inputs"));
    return { output: { ...(out ?? {}) } };
  },
});
