import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { getFileBytes, repoRef } from "@/lib/github/client";
import { guessMime } from "@/lib/ai/files";
import { GITHUB_PREFIX } from "@/lib/tasks/outputs";
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
  if (file.storage_path.startsWith(GITHUB_PREFIX)) return fromGithub(file, inline);
  const { data, error } = await db().storage.from("task-files").createSignedUrl(file.storage_path, 120, inline ? undefined : { download: file.name });
  if (error || !data) return NextResponse.json({ error: error?.message ?? "failed" }, { status: 500 });
  return NextResponse.redirect(data.signedUrl);
}

const TEXTUAL = /^(text\/|application\/(json|xml|javascript))/;

/** AI outputs live in the private workspace repo: stream them through the app. */
async function fromGithub(file: TaskFile, inline: boolean) {
  const bytes = await getFileBytes(await repoRef("workspace"), file.storage_path.slice(GITHUB_PREFIX.length));
  if (!bytes) return NextResponse.json({ error: "not found" }, { status: 404 });
  const mime = guessMime(file.name, file.mime);
  const isHtml = /\.html?$/i.test(file.name);
  const headers = new Headers({
    "Content-Length": String(bytes.length),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  });
  if (inline) {
    headers.set("Content-Type", isHtml ? "text/html; charset=utf-8" : TEXTUAL.test(mime) || mime === "text/plain" ? "text/plain; charset=utf-8" : mime);
    headers.set("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    // Rendered in an isolated origin: the page can run its own scripts but never touches the app session.
    headers.set("Content-Security-Policy", "sandbox allow-scripts allow-popups allow-forms");
  } else {
    headers.set("Content-Type", mime);
    headers.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);
  }
  return new NextResponse(new Uint8Array(bytes), { headers });
}
