// Cloud (Vercel) wiring: one Hono app per server instance, Supabase through DATABASE_URL.
// Environment is read lazily so `next build` passes without any variables.
import { Hono } from "hono";
import { after } from "next/server";
import { createApp } from "./app";
import { createPostgresDb } from "./db/postgres";
import { migrate } from "./db/migrate";
import { consoleLogger } from "./context";
import { createHash } from "node:crypto";

type FetchApp = { fetch: (req: Request) => Response | Promise<Response> };
let appPromise: Promise<FetchApp> | null = null;

function notConfigured(message: string): FetchApp {
  const app = new Hono().basePath("/api");
  app.all("*", (c) => c.json({ error: { code: "not_configured", message } }, 503));
  return app;
}

async function build(): Promise<FetchApp> {
  const url = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL;
  if (!url) return notConfigured("پایگاه داده تنظیم نشده است: متغیر DATABASE_URL را در Vercel بگذارید (راهنما: docs/SETUP_FA.md)");
  const db = createPostgresDb({
    url,
    max: Number(process.env.DATABASE_POOL_MAX ?? 3),
    ssl: process.env.DATABASE_SSL !== "disable",
  });
  if (process.env.AUTO_MIGRATE !== "false") {
    try {
      await migrate(db, (m) => consoleLogger.info(m));
    } catch (e) {
      consoleLogger.error("migration failed", String((e as Error)?.message ?? e));
    }
  }
  const secret = process.env.APP_SECRET || createHash("sha256").update(`itsm:${url}`).digest("hex");
  return createApp({
    mode: "cloud",
    db,
    secret,
    // keys of AI connections are refused while the secret is only derived from the database URL
    secretSource: process.env.APP_SECRET ? "env" : "derived",
    allowSignup: process.env.ALLOW_SIGNUP !== "false",
    platformAdmins: (process.env.PLATFORM_ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    origin: "cloud",
    publicUrl: process.env.PUBLIC_URL,
    log: consoleLogger,
    fetch: globalThis.fetch.bind(globalThis),
    // background work after the response (Next.js `after` keeps the Vercel function alive for it)
    waitUntil: (work) => {
      try {
        after(work);
      } catch {
        void work().catch(() => undefined);
      }
    },
  });
}

export function cloudApp(): Promise<FetchApp> {
  if (!appPromise) {
    appPromise = build().catch((e) => {
      appPromise = null;
      consoleLogger.error("startup failed", String(e));
      return notConfigured("راه‌اندازی سرور ناموفق بود؛ گزارش خطا را در Vercel ← Logs ببینید");
    });
  }
  return appPromise;
}
