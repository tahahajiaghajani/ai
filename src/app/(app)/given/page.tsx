import { requireFull } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { peopleById } from "@/lib/people";
import { GivenClient } from "./given-client";
import type { Task } from "@/lib/types";

export const metadata = { title: "تسک‌های داده‌شده" };

/** Tasks I gave to other people: follow their progress, confirm or reject closure. */
export default async function GivenPage() {
  const me = await requireFull();
  const { data } = await db().from("tasks").select("*").eq("requester_id", me.id).neq("assignee_id", me.id).order("status_changed_at", { ascending: false }).limit(500);
  const tasks = (data ?? []) as Task[];
  const people = await peopleById(tasks.map((t) => t.assignee_id));
  return <GivenClient userId={me.id} initial={tasks} people={[...people.values()]} />;
}
