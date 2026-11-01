// Online-shop webhooks (/api/hooks), the key-authenticated public API (/api/v1) and
// integration management (/api/o/:org/integrations).
import { router } from "../http/hono";

export const hookRoutes = router();
export const publicApiRoutes = router();
export const integrationRoutes = router();
