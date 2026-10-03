import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import type { Task } from "@/lib/types";

/**
 * One link for a task in notifications: the assignee (in the full app) gets the full task page with
 * the AI tools; everyone else gets the simple tracking page.
 */
export default async function TaskLink(props: PageProps<"/t/[id]">) {
  const me = await requireUser();
  const { id } = await props.params;
  const { data: task } = await db().from("tasks").select("id, requester_id, assignee_id").eq("id", id).maybeSingle<Pick<Task, "id" | "requester_id" | "assignee_id">>();
  if (!task || (task.requester_id !== me.id && task.assignee_id !== me.id && !me.isOwner)) notFound();
  // the owner watching someone else's task (not as its giver) also gets the full page
  if (me.mode === "full" && (task.assignee_id === me.id || (me.isOwner && task.requester_id !== me.id))) redirect(`/tasks/${id}`);
  redirect(`/portal/tasks/${id}`);
}
