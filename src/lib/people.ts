import "server-only";
import { db } from "@/lib/supabase/admin";
import type { PersonLite } from "@/lib/types";

/** Active users (name, picture and unit only) for the assignee field and task lists. */
export async function activePeople(): Promise<PersonLite[]> {
  const { data } = await db().from("profiles").select("id, full_name, avatar_url, org_unit, color").eq("status", "active").order("full_name");
  return (data ?? []) as PersonLite[];
}

export async function peopleById(ids: string[]): Promise<Map<string, PersonLite>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const { data } = await db().from("profiles").select("id, full_name, avatar_url, org_unit, color").in("id", unique);
  return new Map(((data ?? []) as PersonLite[]).map((p) => [p.id, p]));
}
