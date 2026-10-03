import { requireUser } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { activePeople } from "@/lib/people";
import { TaskForm } from "@/components/tasks/task-form";
import type { RelationType, Task } from "@/lib/types";

export const metadata = { title: "تسک جدید" };

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
      <h1 className="mb-5 text-[22px] font-black tracking-tight">{parent ? "تسک مرتبط" : "تسک جدید"}</h1>
      <TaskForm userId={me.id} parent={parent} backHref={parent ? `/t/${parent.id}` : me.mode === "full" ? "/dashboard" : "/portal"} people={people} defaultAssignee={defaultAssignee} />
    </div>
  );
}
