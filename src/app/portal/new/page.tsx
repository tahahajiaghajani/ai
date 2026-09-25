import { requireUser } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { TaskForm } from "@/components/tasks/task-form";
import type { RelationType, Task } from "@/lib/types";

export const metadata = { title: "ثبت تسک" };

export default async function NewTaskPage(props: PageProps<"/portal/new">) {
  const me = await requireUser();
  const sp = await props.searchParams;
  const parentId = typeof sp.parent === "string" ? sp.parent : null;
  let parent: { id: string; code: string; title: string; relation?: RelationType } | undefined;
  if (parentId) {
    const { data } = await db().from("tasks").select("*").eq("id", parentId).maybeSingle<Task>();
    if (data && (data.requester_id === me.id || me.isAdmin)) {
      parent = { id: data.id, code: data.code, title: data.title, relation: (typeof sp.relation === "string" ? sp.relation : "continuation") as RelationType };
    }
  }
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-2xl font-black">{parent ? "ثبت تسک مرتبط" : "ثبت تسک جدید"}</h1>
      <p className="mb-6 text-sm text-muted">پس از ثبت، تسک برای تایید مدیر ارسال می‌شود و وضعیت آن را همین‌جا می‌بینید.</p>
      <TaskForm userId={me.id} parent={parent} backHref={parent ? `/portal/tasks/${parent.id}` : "/portal"} />
    </div>
  );
}
