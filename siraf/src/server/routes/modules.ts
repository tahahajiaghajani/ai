// Business modules mounted under /api/o/:org. Each module owns its routes file.
import { router } from "../http/hono";
import { dashboard } from "../modules/dashboard";
import { treasuryRoutes } from "./treasury";
import { goodsRoutes } from "./goods";
import { goldRoutes } from "./gold";
import { fxRoutes } from "./fx";

export const moduleRoutes = router();

moduleRoutes.get("/dashboard", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("reports", "view");
  return c.json(await dashboard(ctx));
});

moduleRoutes.route("/treasury", treasuryRoutes);
moduleRoutes.route("/goods", goodsRoutes);
moduleRoutes.route("/gold", goldRoutes);
moduleRoutes.route("/fx", fxRoutes);
