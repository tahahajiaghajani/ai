// Integrity of process forms (design F §3.2, package F2) on every path — F2's routes, the generic record API and
// imports — for the system as for people:
//   · the layout is cleaned and checked against the field library (`formLayoutProblems`): library fields that exist and
//     can be used, each once; a retired field is refused where the form did not hold it already (a form that has one
//     keeps it, design F §3.1); flags, widths and caps; «نمایش وقتی…» conditions valid on the form's own fields;
//   · `fields` (the library fields of the layout) follows the layout, for F1's usage and the library's guards;
//   · status, version and the published fingerprint belong to the publish (system fields: people never set them);
//   · a form a process uses (`registerFormUsage`) is never deleted;
//   · forms change on the web version or the server edition: a Windows app's push is refused.
import { cleanFormLayout, emptyLayout, formLayoutProblems, layoutFields } from "@shared/forms/layout";
import { bad } from "../../http/errors";
import { orgSchema, registerHooks, webOnly, type WriteArgs } from "../../engine";
import { libraryFields, namedFields } from "./library";
import { formUsage } from "./usage";

const names = (xs: string[]) => (xs.length > 3 ? `${xs.slice(0, 3).map((x) => `«${x}»`).join("، ")} و ${xs.length - 3} گردش‌کار دیگر` : xs.map((x) => `«${x}»`).join("، "));

/** Why a form cannot be deleted (null when it can): processes use it. */
export async function deleteRefusal(w: Pick<WriteArgs, "tx" | "ctx">, form: { id: string; name: string }): Promise<string | null> {
  const u = await formUsage(w.tx, w.ctx.org.id, form);
  if (!u.processes.length) return null;
  return `فرم «${form.name}» در گردش‌کارهای ${names(u.processes)} به کار رفته است و حذف نمی‌شود؛ نخست آن را از مرحله‌هایشان بردارید`;
}

async function formBefore(w: WriteArgs): Promise<void> {
  const { tx, ctx, op, next, prev, changed } = w;
  if (op === "delete") {
    const refusal = await deleteRefusal(w, { id: String(prev?.id ?? next.id), name: String(prev?.name ?? next.name ?? "") });
    if (refusal) throw bad(refusal);
    return;
  }
  if (op !== "create" && op !== "update") return;
  // the layout as sent, checked against the library (only when it changes: a renamed form keeps what it holds)
  if (op === "create" || changed.has("layout") || !Array.isArray(next.fields)) {
    const raw = next.layout === null || next.layout === undefined ? emptyLayout() : next.layout;
    const lib = await libraryFields(tx, ctx.org.id, [...namedFields(raw)]);
    const kept = new Set(op === "update" ? layoutFields(cleanFormLayout(prev?.layout)) : []);
    const schema = await orgSchema(ctx, tx);
    const problems = formLayoutProblems(raw, {
      field: (n) => lib.get(n)?.def ?? null,
      retired: (n) => !!lib.get(n)?.retired,
      kept,
      lookup: schema.lookup,
    });
    if (problems.length) throw bad(problems[0], { problems });
    const layout = cleanFormLayout(raw);
    next.layout = layout;
    next.fields = layoutFields(layout);
  }
}

let installed = false;

export function installFormHooks(): void {
  if (installed) return;
  installed = true;
  registerHooks("form", {
    beforeWrite: formBefore,
    ...webOnly("فرم"),
  });
}
