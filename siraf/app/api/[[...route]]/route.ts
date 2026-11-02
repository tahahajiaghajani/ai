// Vercel entry: every /api/* request goes to the shared Hono app (src/server/app.ts).
import { cloudApp } from "../../../src/server/cloud";

export const runtime = "nodejs";
export const maxDuration = 60;

async function handler(req: Request): Promise<Response> {
  const app = await cloudApp();
  return app.fetch(req);
}

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE, handler as OPTIONS, handler as HEAD };
