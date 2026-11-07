// /api/o/:org/data/:entity — generic master data CRUD and searchable select options.
import { z } from "zod";
import { router, body } from "../http/hono";
import * as crud from "../modules/data/crud";

export const dataRoutes = router();

dataRoutes.get("/:entity", async (c) => {
  const ctx = c.get("ctx");
  const q = c.req.query();
  const filters: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) if (k.startsWith("f.")) filters[k.slice(2)] = v;
  const r = await crud.list(ctx, c.req.param("entity"), {
    q: q.q,
    page: q.page ? Number(q.page) : 1,
    size: q.size ? Number(q.size) : 50,
    sort: q.sort,
    dir: q.dir === "desc" ? "desc" : "asc",
    filters,
  });
  return c.json(r);
});

/** Options for selects: ?q=…&f.kind=… or ?ids=a,b */
dataRoutes.get("/:entity/options", async (c) => {
  const ctx = c.get("ctx");
  const entity = c.req.param("entity");
  const q = c.req.query();
  const ids = (q.ids ?? "").split(",").filter(Boolean);
  const filters: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) if (k.startsWith("f.")) filters[k.slice(2)] = v;
  return c.json({ options: await crud.options(ctx, entity, q.q ?? "", filters, ids) });
});

/** Bulk import from a spreadsheet: { rows: [{field: cell}], update_existing, dry_run } */
dataRoutes.post("/:entity/import", async (c) => {
  const input = await body(
    c,
    z.object({
      rows: z.array(z.record(z.string(), z.unknown())).max(1000, "در هر بار حداکثر ۱۰۰۰ ردیف"),
      update_existing: z.boolean().optional(),
      dry_run: z.boolean().optional(),
      offset: z.number().int().min(0).optional(),
    }),
  );
  return c.json(await crud.importRows(c.get("ctx"), c.req.param("entity"), input.rows, { updateExisting: input.update_existing, dryRun: input.dry_run, offset: input.offset }));
});

dataRoutes.get("/:entity/:id", async (c) => c.json({ row: await crud.get(c.get("ctx"), c.req.param("entity"), c.req.param("id")) }));

dataRoutes.post("/:entity", async (c) => {
  const data = await body(c, z.record(z.string(), z.unknown()));
  return c.json({ row: await crud.create(c.get("ctx"), c.req.param("entity"), data) });
});

dataRoutes.patch("/:entity/:id", async (c) => {
  const data = await body(c, z.record(z.string(), z.unknown()));
  return c.json({ row: await crud.update(c.get("ctx"), c.req.param("entity"), c.req.param("id"), data) });
});

dataRoutes.delete("/:entity/:id", async (c) => c.json(await crud.remove(c.get("ctx"), c.req.param("entity"), c.req.param("id"))));
