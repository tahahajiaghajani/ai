import { NextResponse } from "next/server";
import { zipSync, strToU8 } from "fflate";
import { getSessionUser } from "@/lib/auth";
import { buildNotebookPack } from "@/lib/ai/notebook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Download the knowledge base as a NotebookLM-ready zip of Markdown sources. */
export async function GET() {
  const user = await getSessionUser();
  if (!user?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const pack = await buildNotebookPack();
  const zip = zipSync(Object.fromEntries(pack.map((f) => [f.name, strToU8(f.content)])), { level: 6 });
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(Buffer.from(zip), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="taskflow-notebooklm-${date}.zip"`,
    },
  });
}
