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
