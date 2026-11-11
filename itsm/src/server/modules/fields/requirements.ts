// An organisation's requirements bind people's writes only (design F §3.3, §4.2, package F1):
//   · a field requirement (`custom_field.required` + `required_for` → FieldDef.formRequired): «همه» binds every
//     person, «فقط کارشناسان» the writers whose roles have the agent or admin persona. A `*` beforeWrite asks it of
//     the API and imports; the same check answers a Windows app's push (`validatePush`). The system (e-mail, event
//     rules, flows run as the system, jobs) and trusted server code are never asked. A create needs the value; an
//     update is refused only when it empties the field; a field the person cannot fill (hidden by a field group, not
//     writable for them) is not asked, as for UI policies; a yes/no field must be ticked.
//   · a transition's organisation fields (`needs`) and condition (`when`, `_states`): a `*` validateTransition hook,
//     which the engine's writes and the push path (`checkPushedChange`) both run; never for the system or trusted code.
// Module requirements stay FieldDef.required and `Transition.requires`, which bind every write.
import type { FieldDef, TableDef } from "@shared/model/types";
import { missingNeeds, transitionBlocked, type EffectiveTransition } from "@shared/model/lifecycle";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { access } from "../../access/provider";
import { prepareSubject, snapshotFor, catalogOf, accessSettings } from "../../access/subject";
import { isLocked, isSystemCtx, orgSchema, pushGuard, registerHooks, validationError, type WriteArgs } from "../../engine";
import { bindsRequirement, requirementScope, setRequirementAudience } from "../../engine/schema";
import type { Row } from "../../engine/hooks";
import { isEmpty } from "../../engine/values";

const personas = new WeakMap<Ctx, Promise<"agent" | "requester">>();

/**
 * The caller's persona for requirements: "agent" when one of their roles (containment resolved) has the agent or
 * admin persona, else "requester". A platform support session counts as an agent. Memoised per request.
 */
export function personaOf(ctx: Ctx, q: Queryable = ctx.db): Promise<"agent" | "requester"> {
  if (ctx.actor === "support") return Promise.resolve("agent");
  let p = personas.get(ctx);
  if (!p) {
    p = (async () => {
      const built = await prepareSubject(ctx, q);
      const catalog = catalogOf(await snapshotFor(ctx, q), accessSettings(ctx.org));
      const agent = built.subject.eff.roles.some((k) => {
        const persona = catalog.get(k)?.persona;
        return persona === "agent" || persona === "admin";
      });
      return agent ? "agent" : "requester";
    })();
    personas.set(ctx, p);
    p.catch(() => personas.delete(ctx));
  }
  return p;
}

/** The organisation's requirements a person's write leaves unmet (field → Persian message). */
export async function unmetRequirements(q: Queryable, ctx: Ctx, def: TableDef, prev: Row | null, next: Row, changed: ReadonlySet<string>): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (isSystemCtx(ctx) || def.virtual) return out;
  const fields = def.fields.filter((f) => f.formRequired && !f.base && !f.system && !f.readonly);
  if (!fields.length) return out;
  const scope = await requirementScope(ctx, q);
  const bound = fields.filter((f) => bindsRequirement(f, scope));
  if (!bound.length) return out;
  // a closed record takes transitions out of it only: nothing to fill there
  if (prev && isLocked(def, prev) && !changed.has(def.states?.field ?? "state")) return out;
  const visible = access().visibleFields(ctx, def);
  const writable = access().writableFields(ctx, def, prev);
  for (const f of bound) {
    if ((visible && !visible.has(f.name)) || (writable && !writable.has(f.name))) continue;
    // an update is held to it only when it empties the field (older records may lack the value)
    if (prev && !changed.has(f.name)) continue;
    if (!unfilled(f, next[f.name])) continue;
    out[f.name] = f.type === "bool" ? `«${f.label}» باید تیک بخورد` : `«${f.label}» را وارد کنید`;
  }
  return out;
}

const unfilled = (f: FieldDef, v: unknown): boolean => (f.type === "bool" ? v !== true : isEmpty(v));

async function requirementsBefore(w: WriteArgs): Promise<void> {
  if ((w.op !== "create" && w.op !== "update" && w.op !== "transition") || w.trusted || isSystemCtx(w.ctx)) return;
  const out = await unmetRequirements(w.tx, w.ctx, w.def, w.prev, w.next, w.changed);
  if (Object.keys(out).length) throw validationError(out);
}

/** The organisation's fields and condition of the transition being taken (people's writes only). */
async function transitionRules(w: WriteArgs & { transition: NonNullable<WriteArgs["transition"]> }): Promise<string | null> {
  const t = w.transition as EffectiveTransition;
  if (w.trusted || isSystemCtx(w.ctx) || (!t.needs?.length && !t.when)) return null;
  // a pushed row carries the organisation's fields in `custom`: judge the values the push brings
  const row: Row = { ...w.next };
  if (w.via === "sync" && row.custom && typeof row.custom === "object") for (const f of w.def.fields) if (f.custom) row[f.name] = (row.custom as Row)[f.name] ?? null;
  const missing = missingNeeds(t, row);
  if (missing.length) {
    const label = (n: string) => w.def.fields.find((f) => f.name === n)?.label ?? n;
    return `برای «${t.label}»، «${missing.map(label).join("» و «")}» را وارد کنید`;
  }
  const schema = await orgSchema(w.ctx, w.tx);
  return transitionBlocked(t, row, w.env, w.def, schema.lookup);
}

let installed = false;

export function installRequirementHooks(): void {
  if (installed) return;
  installed = true;
  setRequirementAudience((ctx, q) => personaOf(ctx, q));
  registerHooks("*", {
    beforeWrite: requirementsBefore,
    // a Windows app's push runs no beforeWrite: the same rule is asked of the pushed row
    validatePush: pushGuard(requirementsBefore),
    validateTransition: transitionRules,
  });
}
