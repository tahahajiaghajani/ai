import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { TaskForm } from "@/components/tasks/task-form";
import { REQUESTER_EDITABLE } from "@/lib/status";
import type { Task } from "@/lib/types";

export const metadata = { title: "ویرایش تسک" };

export default async function EditTaskPage(props: PageProps<"/portal/tasks/[id]/edit">) {
  const me = await requireUser();
  const { id } = await props.params;
  const { data: task } = await db().from("tasks").select("*").eq("id", id).maybeSingle<Task>();
  if (!task || (task.requester_id !== me.id && !me.isAdmin)) notFound();
  if (!REQUESTER_EDITABLE.includes(task.status)) redirect(`/portal/tasks/${id}`);
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-black">ویرایش {task.code}</h1>
      <TaskForm userId={me.id} task={task} backHref={`/portal/tasks/${id}`} />
    </div>
  );
}
