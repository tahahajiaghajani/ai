import "server-only";
import { db } from "@/lib/db";

export interface DemoLink {
  id: string;
  title_fa: string;
  title_en: string;
  description_fa: string;
  description_en: string;
  url: string;
  tag: string;
  enabled: boolean;
  sort: number;
}

export async function listDemos(): Promise<DemoLink[]> {
  const c = db();
  if (!c) return [];
  const { data, error } = await c.from("pars_demos").select("*").order("sort").order("created_at");
  if (error || !data) return [];
  return data as DemoLink[];
}
