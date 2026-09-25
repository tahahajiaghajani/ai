import { NextResponse, type NextRequest } from "next/server";
import { runnerAuthorized } from "@/lib/runner-auth";
import { formatKnowledgeContext, searchKnowledge } from "@/lib/ai/knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Semantic search used by Claude inside the runner: `node .github/scripts/taskflow.mjs kb "query"` */
export async function GET(req: NextRequest) {
  if (!runnerAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = req.nextUrl.searchParams.get("q")?.trim();
  const k = Math.min(Number(req.nextUrl.searchParams.get("k") ?? "6"), 15);
  if (!q) return NextResponse.json({ error: "q required" }, { status: 400 });
  try {
    const hits = await searchKnowledge(q, k);
    return new NextResponse(formatKnowledgeContext(hits, 30_000) || "موردی یافت نشد.", {
      headers: { "content-type": "text/markdown; charset=utf-8" },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
