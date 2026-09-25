import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

let cached: SupabaseClient | null = null;

/**
 * Service-role client. Bypasses RLS — only use on the server after checking permissions.
 */
export function db(): SupabaseClient {
  if (cached) return cached;
  if (!env.supabaseUrl || !env.supabaseServiceKey) {
    throw new Error("متغیرهای NEXT_PUBLIC_SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY تنظیم نشده‌اند");
  }
  cached = createClient(env.supabaseUrl, env.supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-client-info": "taskflow-ai-server" } },
  });
  return cached;
}

/** Throw on Supabase errors with a readable message. */
export function must<T>(res: { data: T | null; error: { message: string } | null }, what = "عملیات دیتابیس"): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  if (res.data === null) throw new Error(`${what}: داده‌ای برنگشت`);
  return res.data;
}
