// /api/o/:org — the field library and the table overlays (design F §3.1, §3.3, §4.2, package F1):
//   GET  /fields/library            library fields with where each is used        process_design read | settings edit
//   GET  /fields/library/:id        one library field whole (its sheet)            process_design read | settings edit
//   POST /fields/library            a library field (as the system, for the person) process_design write | settings edit
//   PATCH /fields/library/:id       change or retire one                           idem
//   GET  /fields/types              built-in types first, then the organisation's   process_design read | settings edit
//   GET  /fields/types/:id          one organisation type whole (its sheet)        process_design read | settings edit
//   POST /fields/types, PATCH /fields/types/:id                                     process_design write | settings edit
//   GET  /fields/locked/:table      locked fields with their reasons               process_design read | settings edit
//   GET  /fields/paths/:table       creation paths and what a requirement binds    process_design read | settings edit
//   POST /fields/attach             a library field becomes a field of a table     settings edit
//   GET|PUT /forms/system/:table/overrides   the default form's overrides          settings edit
//   GET|PUT /lifecycles/:table      the lifecycle overlay                          settings view | settings full
// The service (src/server/modules/fields/service.ts) writes through the engine as the system with the person as the
// actor, so the integrity hooks hold here as on the generic API.
import { z } from "zod";
import { router, body } from "../http/hono";
import {
  attachField, libraryList, libraryRow, lifecycleOf, lockedOf, pathsFor, saveLifecycle, saveSystemOverrides, systemOverrides, typeList, writeLibrary,
} from "../modules/fields/service";
import type { LifecycleOverlay } from "@shared/model/lifecycle";

export const fieldsRoutes = router();

const record = z.record(z.string(), z.unknown());
const requiredFor = z.enum(["all", "agents"]);

fieldsRoutes.get("/fields/library", async (c) => c.json(await libraryList(c.get("ctx"))));

fieldsRoutes.get("/fields/library/:id", async (c) => c.json(await libraryRow(c.get("ctx"), "field_def", c.req.param("id"))));

fieldsRoutes.post("/fields/library", async (c) => {
  const input = await body(c, record);
  return c.json({ row: await writeLibrary(c.get("ctx"), "field_def", null, input) }, 201);
});

fieldsRoutes.patch("/fields/library/:id", async (c) => {
  const input = await body(c, record);
  return c.json({ row: await writeLibrary(c.get("ctx"), "field_def", c.req.param("id"), input) });
});

fieldsRoutes.get("/fields/types", async (c) => c.json(await typeList(c.get("ctx"))));

fieldsRoutes.get("/fields/types/:id", async (c) => c.json(await libraryRow(c.get("ctx"), "field_type", c.req.param("id"))));

fieldsRoutes.post("/fields/types", async (c) => {
  const input = await body(c, record);
  return c.json({ row: await writeLibrary(c.get("ctx"), "field_type", null, input) }, 201);
});

fieldsRoutes.patch("/fields/types/:id", async (c) => {
  const input = await body(c, record);
  return c.json({ row: await writeLibrary(c.get("ctx"), "field_type", c.req.param("id"), input) });
});

fieldsRoutes.get("/fields/locked/:table", async (c) => c.json(await lockedOf(c.get("ctx"), c.req.param("table"))));

fieldsRoutes.get("/fields/paths/:table", async (c) => c.json(await pathsFor(c.get("ctx"), c.req.param("table"), c.req.query("required_for"))));

fieldsRoutes.post("/fields/attach", async (c) => {
  const input = await body(
    c,
    z.object({
      table: z.string().min(1).max(60),
      field: z.string().min(1).max(60),
      section: z.string().max(80).nullish(),
      required: z.boolean().optional(),
      required_for: requiredFor.nullish(),
      form_hidden: z.boolean().optional(),
    }),
  );
  return c.json(await attachField(c.get("ctx"), input), 201);
});

const override = z.object({
  label: z.string().max(80).nullish(),
  help: z.string().max(300).nullish(),
  placeholder: z.string().max(120).nullish(),
  form_hidden: z.boolean().optional(),
  required: z.boolean().optional(),
  required_for: requiredFor.nullish(),
});

fieldsRoutes.get("/forms/system/:table/overrides", async (c) => c.json(await systemOverrides(c.get("ctx"), c.req.param("table"))));

fieldsRoutes.put("/forms/system/:table/overrides", async (c) => {
  const input = await body(c, z.object({ fields: z.record(z.string(), override).optional(), arrangement: z.unknown().optional() }));
  return c.json(await saveSystemOverrides(c.get("ctx"), c.req.param("table"), input));
});

fieldsRoutes.get("/lifecycles/:table", async (c) => c.json(await lifecycleOf(c.get("ctx"), c.req.param("table"))));

fieldsRoutes.put("/lifecycles/:table", async (c) => {
  const input = await body(c, z.object({ states: z.record(z.string(), z.unknown()).nullish(), transitions: z.array(z.unknown()).nullish() }).nullable());
  return c.json(await saveLifecycle(c.get("ctx"), c.req.param("table"), (input ?? null) as LifecycleOverlay | null));
});
