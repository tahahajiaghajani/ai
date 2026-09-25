import { after, NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { db } from "@/lib/supabase/admin";
import { buildNotebookPack } from "@/lib/ai/notebook";
import { commitFiles, getFileText, repoRef } from "@/lib/github/client";
import type { ProviderState } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Daily maintenance: expired model blocks and the NotebookLM knowledge pack in GitHub. */
async function daily() {
  const { data: providers } = await db().from("provider_state").select("*");
  for (const p of (providers ?? []) as ProviderState[]) {
    const models = Object.fromEntries(
      Object.entries(p.models ?? {}).filter(([, v]) => v.blocked_until && new Date(v.blocked_until).getTime() > Date.now()),
    );
    if (Object.keys(models).length !== Object.keys(p.models ?? {}).length) {
      await db().from("provider_state").update({ models }).eq("provider", p.provider);
    }
  }

  if (env.githubToken) {
    const pack = await buildNotebookPack();
    const ref = await repoRef("workspace");
    const changed = [];
    for (const f of pack) {
      const path = `knowledge/notebooklm/${f.name}`;
      const existing = await getFileText(ref, path).catch(() => null);
      // INDEX.md carries a timestamp; only rewrite it when another file changed.
      if (f.name !== "INDEX.md" && existing === f.content) continue;
      changed.push({ path, content: f.content });
    }
    if (changed.length > 1 || (changed.length === 1 && !changed[0].path.endsWith("INDEX.md"))) {
      await commitFiles(ref, changed, "[TaskFlow] به‌روزرسانی بسته‌ی NotebookLM");
      await db().from("knowledge_items").update({ exported_at: new Date().toISOString() }).is("exported_at", null);
    }
  }
}

async function handle(req: NextRequest) {
  if (!env.cronSecret || req.headers.get("authorization") !== `Bearer ${env.cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  after(async () => {
    try {
      await daily();
    } catch (err) {
      console.error("daily failed", err);
    }
  });
  return NextResponse.json({ accepted: true }, { status: 202 });
}

export const GET = handle;
export const POST = handle;
