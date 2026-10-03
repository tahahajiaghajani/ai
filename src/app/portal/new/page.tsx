import { requireUser } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { activePeople } from "@/lib/people";
import { TaskForm } from "@/components/tasks/task-form";
import type { RelationType, Task } from "@/lib/types";

export const metadata = { title: "ثبت تسک" };

export default async function NewTaskPage(props: PageProps<"/portal/new">) {
  const me = await requireUser();
  const sp = await props.searchParams;
  const parentId = typeof sp.parent === "string" ? sp.parent : null;
  let parent: { id: string; code: string; title: string; relation?: RelationType } | undefined;
  let parentAssignee: string | null = null;
  if (parentId) {
    const { data } = await db().from("tasks").select("*").eq("id", parentId).maybeSingle<Task>();
    if (data && (data.requester_id === me.id || data.assignee_id === me.id || me.isOwner)) {
      parent = { id: data.id, code: data.code, title: data.title, relation: (typeof sp.relation === "string" ? sp.relation : "continuation") as RelationType };
      parentAssignee = data.assignee_id;
    }
  }
  const people = await activePeople();
  const wanted = typeof sp.assignee === "string" && people.some((p) => p.id === sp.assignee) ? sp.assignee : null;
  // full mode: your own task by default; simple mode: pick who should do it
  const defaultAssignee = wanted ?? parentAssignee ?? (me.mode === "full" ? me.id : null);
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-2xl font-black">{parent ? "ثبت تسک مرتبط" : "ثبت تسک جدید"}</h1>
      <p className="mb-6 text-sm text-muted">برای هر کسی (یا خودتان) تسک ثبت کنید؛ مسئول آن را می‌پذیرد و وضعیتش را همین‌جا زنده دنبال می‌کنید.</p>
      <TaskForm userId={me.id} parent={parent} backHref={parent ? `/t/${parent.id}` : "/portal"} people={people} defaultAssignee={defaultAssignee} />
    </div>
  );
}
