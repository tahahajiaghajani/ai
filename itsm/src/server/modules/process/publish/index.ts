// Publishing workflows (design F §3.5, §8.4, package F4c): the designer's draft and its checks, «انتشار» with its diff,
// «بازنشسته‌کردن», «نسخه‌ها» and «بازگرداندن به پیش‌نویس» (./service.ts). `installProcessPublish()` (once per process,
// src/server/routes/modules.ts) also tells F2's form module where process forms are used — a form a draft or a version
// takes is never deleted — and which step a form preview means (`<process id>:<node>` for a draft's step,
// `v:<version id>:<node>` for a published one).
import { cleanStepRights } from "@shared/forms/layout";
import { formStepOf, processNodeLabel, type ProcessGraph } from "@shared/process/graph";
import type { Ctx } from "../../../context";
import type { Queryable } from "../../../db";
import { registerFormUsage, registerStepRights, type StepOfForm } from "../../forms";
import { isId } from "../engine/store";
import { cleanDraft, graphForms } from "./draft";

export { cleanDraft, graphForms, draftRules, MAX_DRAFT_BYTES, type ProcessDraft } from "./draft";
export { versionDiff, type PublishDiff, type VersionLike } from "./diff";
export {
  processDetail, createProcess, saveDraft, publishPreview, publishProcess, retireProcess, processVersions, restoreVersion, checkDraft, designRights,
  needDesignRead, defaultDraft, PUBLISH_REFUSAL, CONNECTION_NEEDED, SEED_JOB,
  type ProcessDetail, type DesignRights, type PublishResult, type VersionRow, type DiffPreview, type NewProcess, type DraftInput,
} from "./service";

const graphOf = (raw: unknown): ProcessGraph => {
  const g = raw && typeof raw === "object" ? (raw as ProcessGraph) : null;
  return g && Array.isArray(g.nodes) ? { nodes: g.nodes, edges: Array.isArray(g.edges) ? g.edges : [] } : { nodes: [], edges: [] };
};

/** A step of a draft (`<process>:<node>`) or of a version (`v:<version>:<node>`) that uses form `formId`. */
async function stepRights(q: Queryable, ctx: Ctx, formId: string, ref: string): Promise<StepOfForm | null> {
  const m = /^(v:)?([0-9a-f-]{36}):([A-Za-z0-9_-]{1,40})$/i.exec(String(ref ?? ""));
  if (!m || !isId(m[2])) return null;
  const graph = m[1]
    ? graphOf((await q.one<{ graph: unknown }>(`select graph from sm_process_versions where org_id = $1 and id = $2 and deleted_at is null`, [ctx.org.id, m[2].toLowerCase()]))?.graph)
    : cleanDraft((await q.one<{ draft: unknown }>(`select draft from sm_processes where org_id = $1 and id = $2 and deleted_at is null`, [ctx.org.id, m[2].toLowerCase()]))?.draft).graph;
  const node = graph.nodes.find((n) => n.id === m[3] && n.type === "form_step");
  if (!node) return null;
  const step = formStepOf(node.config);
  if (!step.form || step.form.toLowerCase() !== formId.toLowerCase()) return null;
  return { label: processNodeLabel(node), rights: cleanStepRights(step.rights), action: step.action };
}

/** The processes (drafts and versions) that use each form. */
async function formUsers(q: Queryable, orgId: string, forms: readonly { id: string; name: string }[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  const wanted = new Set(forms.map((f) => f.id.toLowerCase()));
  const add = (form: string, name: string) => {
    if (wanted.has(form)) (out[form] ??= []).push(name);
  };
  for (const p of await q.query<{ name: string; draft: unknown }>(`select name, draft from sm_processes where org_id = $1 and deleted_at is null`, [orgId])) {
    for (const f of graphForms(cleanDraft(p.draft).graph)) add(f, String(p.name));
  }
  const versions = await q.query<{ name: string; forms: string[] | null }>(
    `select p.name, array(select jsonb_object_keys(coalesce(v.forms->'forms', '{}'::jsonb))) as forms
     from sm_process_versions v join sm_processes p on p.id = v.process_id and p.org_id = v.org_id
     where v.org_id = $1 and v.deleted_at is null and jsonb_typeof(v.forms->'forms') = 'object'`,
    [orgId],
  );
  for (const v of versions) for (const f of v.forms ?? []) add(String(f).toLowerCase(), String(v.name));
  return out;
}

let installed = false;

export function installProcessPublish(): void {
  if (installed) return;
  installed = true;
  registerStepRights(stepRights);
  registerFormUsage(formUsers);
}
