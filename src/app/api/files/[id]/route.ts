import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import type { Task, TaskFile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Short-lived signed link (download, or inline preview with ?inline=1) for an attachment, after a permission check. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/files/[id]">) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const { data: file } = await db().from("task_files").select("*").eq("id", id).maybeSingle<TaskFile>();
  if (!file) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!user.isAdmin) {
    const { data: task } = await db().from("tasks").select("requester_id").eq("id", file.task_id).maybeSingle<Pick<Task, "requester_id">>();
    if (!task || task.requester_id !== user.id || file.context !== "request") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  // ?inline=1 opens the file in the browser (preview); otherwise it downloads with its original name.
  const inline = req.nextUrl.searchParams.get("inline") === "1";
  const { data, error } = await db().storage.from("task-files").createSignedUrl(file.storage_path, 120, inline ? undefined : { download: file.name });
  if (error || !data) return NextResponse.json({ error: error?.message ?? "failed" }, { status: 500 });
  return NextResponse.redirect(data.signedUrl);
}
