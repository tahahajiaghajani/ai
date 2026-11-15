// Vercel entry for /api/o/:org/ai/* — the same shared Hono app as app/api/[[...route]], in its own
// function so the assistant's streamed answers (SSE) may run up to 300 s (Vercel Hobby's maximum
// with Fluid compute). Next.js prefers this more specific route over the catch-all one; each
// request still stops starting new model turns after ~240 s and asks the client to continue.
import { handleCloud } from "../../../../../../src/server/cloud";

export const runtime = "nodejs";
export const maxDuration = 300;

async function handler(req: Request): Promise<Response> {
  return handleCloud(req);
}

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE, handler as OPTIONS, handler as HEAD };
