import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

let client: SupabaseClient | null | undefined;

/** Service-role client (server only). `null` when Supabase is not configured yet. */
export function db(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = env.supabaseUrl;
  const key = env.supabaseKey;
  client = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  return client;
}

export class UserError extends Error {}

export function requireDb(): SupabaseClient {
  const c = db();
  if (!c) throw new UserError("پایگاه داده هنوز تنظیم نشده است (SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY).");
  return c;
}

/** PostgREST "table not found" (PGRST205, or 42P01 on older versions): the migration has not run yet. */
export function isMissingTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === "PGRST205" || error?.code === "42P01";
}

const PAGE = 1000; // Supabase returns at most this many rows per request

/** All rows of a query, page by page (up to `max`). */
export async function allRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>,
  max = 20000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    const rows = (data as T[] | null) ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}
