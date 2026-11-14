// /api/o/:org — process forms and the list of every form (design F §3.2, §8.2, package F2):
//   GET    /forms                        every form: system, process, catalogue, portal report, surveys, change risk
//                                        (?kind=)                                                   process_design read | settings edit
//   POST   /forms                        a process form (as the system, for the person)              process_design write | settings edit
//   GET    /forms/:id                    a process form, its fields and where it is used              process_design read | settings edit
//   PATCH  /forms/:id                    its name, description or layout                              process_design write | settings edit
//   DELETE /forms/:id                    only while no process uses it                                process_design write | settings edit
//   GET    /forms/:id/usage              the processes that use it                                    process_design read | settings edit
//   GET    /forms/:id/preview            at a step, for a viewpoint (?step=&as=&rights=&values=)      process_design read | settings edit
//   POST   /forms/:id/preview            the same, with the designer's unsaved rights and sample values in the body
//   GET    /forms/system/:table/preview  a table's default form for a viewpoint (?as=requester|agent|<member id>)
// F1's GET|PUT /forms/system/:table/overrides is the system form designer's store (src/server/routes/fields.ts).
// The services are src/server/modules/forms/*.
import { z } from "zod";
import { router, body, query } from "../http/hono";
import { formsList, type FormKind } from "../modules/forms/list";
import { createForm, deleteForm, getForm, updateForm, usageOf } from "../modules/forms/service";
import { formPreview, jsonParam, systemPreview } from "../modules/forms/preview";

export const formsRoutes = router();

const KINDS = ["system", "process", "catalog", "portal_report", "survey", "risk"] as const satisfies readonly FormKind[];

const formInput = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(2000).nullish(),
  layout: z.unknown().optional(),
});

formsRoutes.get("/forms", async (c) => {
  const q = query(c, z.object({ kind: z.enum(KINDS).optional() }));
  return c.json(await formsList(c.get("ctx"), { kind: q.kind ?? null }));
});

formsRoutes.post("/forms", async (c) => {
  const input = await body(c, formInput.extend({ name: z.string().trim().min(1).max(120) }));
  return c.json({ form: await createForm(c.get("ctx"), input) }, 201);
});

formsRoutes.get("/forms/system/:table/preview", async (c) => c.json(await systemPreview(c.get("ctx"), c.req.param("table"), c.req.query("as"))));

formsRoutes.get("/forms/:id", async (c) => c.json(await getForm(c.get("ctx"), c.req.param("id"))));

formsRoutes.patch("/forms/:id", async (c) => {
  const input = await body(c, formInput);
  return c.json({ form: await updateForm(c.get("ctx"), c.req.param("id"), input) });
});

formsRoutes.delete("/forms/:id", async (c) => c.json(await deleteForm(c.get("ctx"), c.req.param("id"))));

formsRoutes.get("/forms/:id/usage", async (c) => c.json(await usageOf(c.get("ctx"), c.req.param("id"))));

formsRoutes.get("/forms/:id/preview", async (c) => {
  const p = query(c, z.object({ step: z.string().max(200).optional(), as: z.string().max(60).optional(), rights: z.string().max(50_000).optional(), values: z.string().max(200_000).optional() }));
  const values = jsonParam(p.values, "مقدارهای نمونه");
  return c.json(
    await formPreview(c.get("ctx"), c.req.param("id"), {
      step: p.step ?? null,
      as: p.as ?? null,
      rights: jsonParam(p.rights, "حق‌های مرحله"),
      values: values && typeof values === "object" && !Array.isArray(values) ? (values as Record<string, unknown>) : null,
    }),
  );
});

formsRoutes.post("/forms/:id/preview", async (c) => {
  const p = await body(c, z.object({ step: z.string().max(200).nullish(), as: z.string().max(60).nullish(), rights: z.unknown().optional(), values: z.record(z.string(), z.unknown()).nullish() }));
  return c.json(await formPreview(c.get("ctx"), c.req.param("id"), { step: p.step ?? null, as: p.as ?? null, rights: p.rights, values: p.values ?? null }));
});
