// The bank's sample workflow (docs/DEMO_FA.md, design F): «درخواست دسترسی به سامانه (نمونه)», made the way an
// administrator makes one — library fields, one form whose rights each step sets, a process drawn on them — and
// published by the publish service (F4c), so its version, form snapshot and the workflows' notices are the product's own:
//   «ثبت درخواست» (the requester) → «تأیید امنیت اطلاعات» (approve: the bank's security operations group; «رد» ends the
//   case, «بازگشت برای اصلاح» sends it back) → «اعطای دسترسی» (fill: the service desk) → «پایان».
// Every member may start it, so the people's «گردش‌کارها» offers «شروع» at once; the Windows app's end-to-end test starts
// it as a member (scripts/desktop-e2e.mjs). Written inside the demo scope like every step: the fields, the form, the
// process and its version — and the cases the pack's people start of it, their steps and runs — go with the pack
// (tests/demo-purge.test.ts). A real member's case of it is real work, like any real record naming demo data: the purge
// keeps it and reports its reference. A real workflow, form or field of the same key or name is never touched: the
// part is refused and recorded with the pack's status instead.
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { publishProcess } from "../process/publish";
import { DEMO_WORKFLOW as W } from "./bank";
import { bump, put, refuse, type StepArgs } from "./load";

type Node = { id: string; type: string; config: Record<string, unknown>; label?: string };
const node = (id: string, type: string, config: Record<string, unknown> = {}, label?: string): Node => ({ id, type, config, ...(label ? { label } : {}) });
const edge = (source: string, target: string, port?: string) => ({ id: `${source}.${port ?? "out"}.${target}`, source, target, ...(port ? { port } : {}) });

/** The pack's workflow as a designer's draft: `form` the form's id, `soc` and `desk` the pack's groups. */
export function demoWorkflowDraft(form: string, groups: { soc: string; desk: string }, manager: string | null) {
  const F = W.fields;
  return {
    graph: {
      nodes: [
        node("start", "trigger"),
        node("request", "form_step", { action: "fill", start: true, form, rights: { default: "edit", fields: { [F.system.name]: "required", [F.reason.name]: "required", [F.note.name]: "hidden" } } }, W.steps.start),
        node("approve", "form_step", { action: "approve", form, quorum: "any", rights: { default: "read", fields: { [F.note.name]: "edit" } }, assignees: [{ kind: "group", group: groups.soc }] }, W.steps.approve),
        node("grant", "form_step", { action: "fill", form, rights: { default: "read", fields: { [F.note.name]: "required" } }, assignees: [{ kind: "group", group: groups.desk }] }, W.steps.grant),
        node("done", "end", { outcome: "completed" }, "پایان (انجام‌شده)"),
        node("refused", "end", { outcome: "rejected" }, "پایان (ردشده)"),
      ],
      edges: [
        edge("start", "request"),
        edge("request", "approve"),
        edge("approve", "grant", "approved"),
        edge("approve", "refused", "rejected"),
        edge("approve", "request", "returned"),
        edge("grant", "done"),
      ],
    },
    starters: [],
    title_template: `دسترسی به {{case.${F.system.name}}}`,
    requester_view: [],
    managers: manager ? [manager] : [],
    manager_groups: [],
    confidential: false,
  };
}

/** The form: what the requester asks for, then what the reviewers write. */
function layout() {
  const F = W.fields;
  return {
    tabs: [
      {
        label: "درخواست",
        sections: [
          { label: null, items: [{ field: F.system.name }, { field: F.access.name }, { field: F.reason.name }] },
          { label: "بررسی و اقدام", items: [{ field: F.note.name }] },
        ],
      },
    ],
  };
}

/** A live row of `table` by `col` = `value`, and whether it is the pack's own (recorded in sm_demo_rows). */
async function existing(tx: Tx, orgId: string, table: string, col: string, value: string): Promise<{ id: string; demo: boolean; status?: string } | null> {
  return tx.one<{ id: string; demo: boolean; status?: string }>(
    `select x.id, exists (select 1 from sm_demo_rows d where d.org_id = $1 and d.row_id = x.id) as demo${table === "sm_processes" ? ", x.status" : ""}
     from ${table} x where x.org_id = $1 and x.${col} = $2 and x.deleted_at is null limit 1`,
    [orgId, value],
  );
}

/** The step (load.ts STEPS): fields, form and process in one transaction, then «انتشار». Runs again safely. */
export async function stepWorkflow({ orgId, memo }: StepArgs, sys: Ctx): Promise<boolean> {
  const soc = memo.groups.soc;
  const desk = memo.groups.desk;
  if (!soc || !desk) {
    refuse(orgId, "process", new Error("گروه‌های بانک نمایشی ساخته نشده‌اند؛ گردش‌کار نمونه ساخته نشد"));
    return true;
  }
  try {
    const made = await sys.write(async (tx) => {
      // a real workflow, form or field with the pack's key or names: the part is refused, nothing real is changed
      const clash = (what: string) => {
        throw new Error(`${what} با همین نام در سازمان هست؛ گردش‌کار نمونه ساخته نشد`);
      };
      const proc = await existing(tx, orgId, "sm_processes", "key", W.key);
      if (proc && !proc.demo) clash(`گردش‌کار «${W.key}»`);
      if (proc) return { id: proc.id, published: proc.status === "published" };
      for (const f of Object.values(W.fields)) {
        const row = await existing(tx, orgId, "sm_field_defs", "name", f.name);
        if (row && !row.demo) clash(`فیلد «${f.name}»`);
        if (row) continue;
        await put(tx, sys, "field_def", {
          name: f.name, label: f.label, type: f.type, help: "help" in f ? f.help : null, status: "active",
          ...(f.name === W.fields.access.name ? { options: W.access.map((o) => ({ ...o })), default_value: "read" } : {}),
        });
        bump(memo, "field_def");
      }
      const known = await existing(tx, orgId, "sm_forms", "name", W.form);
      if (known && !known.demo) clash(`فرم «${W.form}»`);
      const form = known?.id ?? String((await put(tx, sys, "form", { name: W.form, description: "فرم نمونهٔ بانک برای گردش‌کار درخواست دسترسی", layout: layout() })).id);
      if (!known) bump(memo, "form");
      const row = await put(tx, sys, "process", {
        key: W.key, name: W.name, category: W.category, description: W.description,
        draft: demoWorkflowDraft(form, { soc, desk }, memo.people.personas.manager ?? null),
      });
      bump(memo, "process");
      return { id: String(row.id), published: false };
    });
    // «انتشار» through the publish service, as the system (inside the demo scope: the version and the forms' publish
    // marks are the pack's too)
    if (!made.published) await publishProcess(sys, made.id, { note: "نسخهٔ نمایشی بانک نمونه" });
  } catch (e) {
    refuse(orgId, "process", e);
  }
  return true;
}
