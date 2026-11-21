// /api/o/:org/positions — organisational roles «نقش‌های سازمانی» (design F §3.4, package F3). Positions and holders
// themselves are engine tables (the generic API /r/position, /r/position_holder: read with `org` read, written with
// `org` write); this router adds what a table cannot:
//   POST /positions/resolve          the people of a step for a sample requester (the runtime's resolver)
//                                    process_design write | org write (unit, domain or all)
//   POST /positions/estimate         static counts, the explanation line and pool warnings of a step     idem
//   GET  /positions/overview         positions with current holders, units, vacancies, sources         org read
//   GET  /positions/demo-people      the organisation's demo pack people (1.1.5)            process_design read | org read
//   POST /positions/holders/import   holders from an import set's spreadsheet (or parsed rows); dry run first   org write
import { z } from "zod";
import { router, body } from "../http/hono";
import { STEP_ACTIONS, QUORUMS } from "@shared/process/assignees";
import { demoPeopleOf, estimateStep, importHolders, positionsOverview, previewResolve } from "../modules/positions";

export const positionsRoutes = router();

const uuid = z.string().uuid("شناسه معتبر نیست");
const action = z.enum(STEP_ACTIONS);
const quorum = z.enum(QUORUMS).nullish();
// the step's people settings are cleaned and checked by the shared rules (Persian problems), not by zod
const step = z.record(z.string(), z.unknown());

positionsRoutes.post("/resolve", async (c) => {
  const input = await body(
    c,
    z.object({
      step,
      action,
      quorum,
      label: z.string().max(120).nullish(),
      requester: uuid,
      requested_for: uuid.nullish(),
      values: z.record(z.string(), z.unknown()).optional(),
      fields: z.record(z.string(), z.object({ type: z.string().max(20), ref: z.string().max(60).nullish(), label: z.string().max(120).nullish() })).optional(),
      step_actors: z.record(z.string(), z.array(uuid).max(200)).optional(),
      previous_actor: uuid.nullish(),
      managers: z.array(uuid).max(100).optional(),
      manager_groups: z.array(uuid).max(20).optional(),
      at: z.string().max(40).nullish(),
    }),
  );
  return c.json(await previewResolve(c.get("ctx"), input));
});

positionsRoutes.post("/estimate", async (c) => {
  const input = await body(c, z.object({ step, action, quorum }));
  return c.json(await estimateStep(c.get("ctx"), input));
});

positionsRoutes.get("/overview", async (c) => c.json(await positionsOverview(c.get("ctx"))));

positionsRoutes.get("/demo-people", async (c) => c.json(await demoPeopleOf(c.get("ctx"))));

positionsRoutes.post("/holders/import", async (c) => {
  const input = await body(
    c,
    z.object({
      import_set_id: uuid.nullish(),
      rows: z.array(z.record(z.string(), z.unknown())).max(5000).nullish(),
      mode: z.enum(["merge", "replace"]).default("merge"),
      dry_run: z.boolean().default(true),
    }),
  );
  return c.json(await importHolders(c.get("ctx"), input));
});
