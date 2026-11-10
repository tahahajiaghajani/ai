// First-run web setup of the server edition (/setup?token=…). The installer creates a one-time token
// (`karizctl setup-token`: only its SHA-256 is kept in kariz.json, the URL is printed once and written to
// <data>\setup-url.txt for the administrator). Until the first account exists every other API route answers
// «راه‌اندازی نخست انجام نشده» (front.ts), so nobody on the intranet can claim the platform first. The setup creates the
// organisation and its first owner (the platform administrator) through the application's own routes, confirms the
// public address, installs the bank's certificate (until then a generated self-signed one), the bank's SMTP (Exchange)
// as the organisation's e-mail channel, local AI servers (added to the air-gap allowlist), the backup folder, and links
// to the Active Directory settings (DIRECTORY_SETTINGS_PATH). The token is consumed when the setup completes.
import { Hono } from "hono";
import { z } from "zod";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "@server/db";
import type { Logger } from "@server/context";
import { allowEntryProblem } from "@server/net";
import { DIRECTORY_SETTINGS_PATH } from "./names";
import { loadServerConfig, patchServerConfig, publicHost, type ServerEditionConfig } from "./config";
import { certCovers, inspectCredentials, type CertInfo } from "./tls";

export const SETUP_TTL_DAYS = 14;
export const SETUP_URL_FILE = "setup-url.txt";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Create a new one-time setup token (installer, `karizctl setup-token`); returns the URL to open. */
export function issueSetupToken(file: string, now = new Date()): { token: string; url: string; expires_at: string } {
  const token = randomBytes(24).toString("base64url");
  const expires = new Date(now.getTime() + SETUP_TTL_DAYS * 86400_000).toISOString();
  const c = patchServerConfig(file, (cfg) => {
    cfg.setup = { token_hash: sha256(token), expires_at: expires, completed_at: null };
  });
  const url = `${c.public_url}/setup?token=${token}`;
  try {
    mkdirSync(c.dirs.data, { recursive: true });
    writeFileSync(join(c.dirs.data, SETUP_URL_FILE), `${url}\r\n`, { mode: 0o600 });
  } catch {
    /* printed anyway */
  }
  return { token, url, expires_at: expires };
}

/** Is `token` the live setup token of this configuration? */
export function tokenValid(c: ServerEditionConfig, token: string | null | undefined, now = Date.now()): boolean {
  if (!token || !c.setup.token_hash || c.setup.completed_at) return false;
  if (c.setup.expires_at && Date.parse(c.setup.expires_at) < now) return false;
  const a = Buffer.from(sha256(token), "hex");
  const b = Buffer.from(c.setup.token_hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface SetupDeps {
  /** the configuration file (kariz.json) */
  file: string;
  config(): ServerEditionConfig;
  /** re-read the file in every worker (platform admins, allowlist, public URL) */
  reload(): void;
  /** restart the workers one by one (a new certificate or host name) */
  restart(reason: string): void;
  /** the application's own API (internal requests) */
  api: { fetch(req: Request, env?: unknown): Response | Promise<Response> };
  db: Db;
  log: Logger;
}

/** Has the platform its first account (then the setup is over, whatever the token)? */
export function createUsersProbe(db: Db) {
  let has = false;
  return async (): Promise<boolean> => {
    if (has) return true;
    const r = await db.one<{ n: number }>(`select count(*)::int as n from sm_users`).catch(() => null);
    has = (r?.n ?? 0) > 0;
    return has;
  };
}

const host = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .refine((h) => !allowEntryProblem(h), "نام میزبان معتبر نیست");

export const completeSchema = z.object({
  token: z.string().min(10).max(200),
  org: z.object({ name: z.string().trim().min(2, "نام سازمان را کامل وارد کنید").max(120), timezone: z.string().max(60).optional() }),
  admin: z.object({
    full_name: z.string().trim().min(2, "نام را کامل وارد کنید").max(120),
    email: z.string().trim().toLowerCase().email("ایمیل معتبر نیست"),
    password: z.string().min(1, "رمز عبور را وارد کنید").max(200),
    mobile: z.string().trim().max(20).optional(),
  }),
  public_url: z.string().trim().url("نشانی کامل را وارد کنید، مثلاً https://kariz.bank.local"),
  smtp: z
    .object({
      host,
      port: z.coerce.number().int().min(1).max(65535).default(587),
      security: z.enum(["starttls", "tls", "none"]).default("starttls"),
      user: z.string().trim().max(255).optional(),
      password: z.string().max(500).optional(),
      from_address: z.string().trim().email("نشانی فرستنده معتبر نیست"),
      from_name: z.string().trim().max(120).optional(),
    })
    .nullish(),
  ai: z
    .array(
      z.object({
        label: z.string().trim().max(80).optional(),
        base_url: z.string().trim().url("نشانی سرور مدل را کامل وارد کنید، مثلاً http://ollama.bank.local:11434/v1"),
        kind: z.enum(["ollama", "openai"]).default("ollama"),
      }),
    )
    .max(10)
    .default([]),
  allow: z.array(host).max(100).default([]),
  backup_dir: z.string().trim().max(500).nullish(),
});

export type CompleteInput = z.infer<typeof completeSchema>;

const fail = (status: number, code: string, message: string) => ({ error: { code, message } }) as const;

/** Certificate information for the setup screen (null while none can be read). */
function currentCert(c: ServerEditionConfig): CertInfo | null {
  try {
    if (c.tls.pfx || (c.tls.cert && c.tls.key)) {
      return inspectCredentials({
        pfx: c.tls.pfx ? readFileSync(c.tls.pfx) : null,
        passphrase: c.tls.passphrase,
        cert: c.tls.cert ? readFileSync(c.tls.cert, "utf8") : null,
        key: c.tls.key ? readFileSync(c.tls.key, "utf8") : null,
      }).info;
    }
  } catch {
    return null;
  }
  return null;
}

export function setupRoutes(d: SetupDeps, hasUsers: () => Promise<boolean>) {
  const r = new Hono();
  // the token is read from the file every time: `karizctl setup-token` may issue a new one while the server runs
  const fresh = () => loadServerConfig(d.file).config;
  // guesses at the token are pointless (24 random bytes) but still slowed down
  const attempts = new Map<string, { n: number; at: number }>();
  const limited = (ip: string) => {
    const now = Date.now();
    const a = attempts.get(ip);
    if (!a || now - a.at > 600_000) {
      attempts.set(ip, { n: 1, at: now });
      return false;
    }
    a.n++;
    return a.n > 30;
  };
  const ipOf = (h: Headers) => h.get("x-real-ip") ?? "local";

  r.get("/state", async (c) => {
    const cfg = fresh();
    const token = c.req.query("token");
    const done = await hasUsers();
    if (!done && token && limited(ipOf(c.req.raw.headers))) return c.json(fail(429, "rate_limited", "تلاش‌های زیاد؛ چند دقیقه بعد دوباره امتحان کنید"), 429);
    const valid = !done && tokenValid(cfg, token);
    return c.json({
      required: !done,
      valid,
      expired: !done && !!cfg.setup.expires_at && Date.parse(cfg.setup.expires_at) < Date.now(),
      public_url: cfg.public_url,
      directory_path: DIRECTORY_SETTINGS_PATH,
      air_gapped: cfg.network.air_gapped,
      // the rest only for the holder of the token
      ...(valid
        ? {
            allow: cfg.network.allow,
            backup_dir: cfg.backup.dir ?? cfg.dirs.backups,
            cert: currentCert(cfg),
            self_signed: !(cfg.tls.pfx || (cfg.tls.cert && cfg.tls.key)),
            tls: cfg.tls.enabled,
          }
        : {}),
    });
  });

  r.post("/certificate", async (c) => {
    const form = await c.req.parseBody().catch(() => null);
    if (!form) return c.json(fail(400, "bad_request", "فایل گواهی دریافت نشد"), 400);
    const token = typeof form.token === "string" ? form.token : null;
    if (limited(ipOf(c.req.raw.headers))) return c.json(fail(429, "rate_limited", "تلاش‌های زیاد؛ چند دقیقه بعد دوباره امتحان کنید"), 429);
    if ((await hasUsers()) || !tokenValid(fresh(), token)) return c.json(fail(403, "setup_token", "نشانی راه‌اندازی معتبر نیست یا پیش‌تر به کار رفته است"), 403);
    const file = (k: string) => (form[k] && typeof form[k] !== "string" ? (form[k] as File) : null);
    const pfx = file("pfx");
    const cert = file("cert");
    const key = file("key");
    const passphrase = typeof form.passphrase === "string" ? form.passphrase : "";
    if (!pfx && !(cert && key)) return c.json(fail(400, "bad_request", "فایل ‎.pfx‎ یا جفت گواهی و کلید (PEM) را بفرستید"), 400);
    const size = (f: File | null) => (f ? f.size : 0);
    if (size(pfx) + size(cert) + size(key) > 512 * 1024) return c.json(fail(413, "too_large", "فایل گواهی بیش از اندازه بزرگ است"), 413);
    try {
      const pfxData = pfx ? Buffer.from(await pfx.arrayBuffer()) : null;
      const pem = pfx ? null : { cert: Buffer.from(await cert!.arrayBuffer()).toString("utf8"), key: Buffer.from(await key!.arrayBuffer()).toString("utf8") };
      const creds = inspectCredentials(pfxData ? { pfx: pfxData, passphrase } : pem!);
      const cfg = d.config();
      const warning = certCovers(creds.info, publicHost(cfg)) ? null : `گواهی نام «${publicHost(cfg)}» را ندارد (${creds.info.names.join("، ") || "بدون نام"})؛ مرورگرها هشدار می‌دهند`;
      mkdirSync(cfg.dirs.tls, { recursive: true });
      patchServerConfig(d.file, (x) => {
        if (pfxData) {
          const p = join(x.dirs.tls, "server.pfx");
          writeFileSync(p, pfxData, { mode: 0o600 });
          x.tls = { ...x.tls, pfx: p, passphrase, cert: null, key: null };
        } else {
          const cp = join(x.dirs.tls, "server.crt");
          const kp = join(x.dirs.tls, "server.key");
          writeFileSync(cp, pem!.cert);
          writeFileSync(kp, pem!.key, { mode: 0o600 });
          x.tls = { ...x.tls, pfx: null, passphrase: null, cert: cp, key: kp };
        }
      });
      d.reload();
      d.log.info("setup: certificate installed", { subject: creds.info.subject, valid_to: creds.info.valid_to });
      d.restart("certificate");
      return c.json({ ok: true, cert: creds.info, warning, restarting: true });
    } catch (e) {
      return c.json(fail(400, "bad_certificate", String((e as Error).message ?? e)), 400);
    }
  });

  r.post("/complete", async (c) => {
    if (limited(ipOf(c.req.raw.headers))) return c.json(fail(429, "rate_limited", "تلاش‌های زیاد؛ چند دقیقه بعد دوباره امتحان کنید"), 429);
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json(fail(400, "bad_request", "بدنهٔ درخواست JSON معتبر نیست"), 400);
    }
    const parsed = completeSchema.safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return c.json({ error: { code: "validation", message: first?.message ?? "ورودی معتبر نیست", details: { path: first?.path?.join(".") } } }, 400);
    }
    const input = parsed.data;
    if (await hasUsers()) return c.json(fail(409, "setup_done", "راه‌اندازی نخست پیش‌تر انجام شده است؛ وارد شوید"), 409);
    if (!tokenValid(fresh(), input.token)) return c.json(fail(403, "setup_token", "نشانی راه‌اندازی معتبر نیست یا منقضی شده است؛ با karizctl setup-token نشانی تازه بسازید"), 403);
    let publicUrl: string;
    try {
      const u = new URL(input.public_url);
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
      publicUrl = `${u.protocol}//${u.host}`;
    } catch {
      return c.json(fail(400, "validation", "نشانی سامانه معتبر نیست"), 400);
    }
    const before = d.config();
    const aiHosts = input.ai.map((a) => new URL(a.base_url).hostname.toLowerCase());
    const allow = [...new Set([...before.network.allow, ...input.allow.map((h) => h.toLowerCase()), ...aiHosts, ...(input.smtp ? [input.smtp.host.toLowerCase()] : [])])];
    const backupDir = input.backup_dir?.trim() || null;
    if (backupDir) {
      try {
        mkdirSync(backupDir, { recursive: true });
      } catch (e) {
        return c.json(fail(400, "backup_dir", `پوشهٔ پشتیبان ساخته نشد: ${(e as Error).message}`), 400);
      }
    }
    // the configuration first: the first account becomes the platform administrator (PLATFORM_ADMIN rule of /auth/signup)
    patchServerConfig(d.file, (x) => {
      x.public_url = publicUrl;
      x.network.allow = allow;
      x.platform_admins = [input.admin.email];
      if (backupDir) x.backup.dir = backupDir;
    });
    d.reload();

    const origin = publicUrl;
    const headers = (cookie?: string) => {
      const h: Record<string, string> = { "content-type": "application/json", "x-real-ip": ipOf(c.req.raw.headers), host: new URL(origin).host, "x-forwarded-proto": new URL(origin).protocol.replace(":", "") };
      if (cookie) h.cookie = cookie;
      return h;
    };
    const call = async (method: string, path: string, body: unknown, cookie?: string) => {
      const res = await d.api.fetch(new Request(`${origin}/api${path}`, { method, headers: headers(cookie), body: JSON.stringify(body) }));
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      return { res, json };
    };
    const signup = await call("POST", "/auth/signup", { email: input.admin.email, password: input.admin.password, full_name: input.admin.full_name, ...(input.admin.mobile ? { mobile: input.admin.mobile } : {}) });
    if (!signup.res.ok) return c.json(signup.json ?? fail(500, "signup", "ساخت حساب مدیر ناموفق بود"), signup.res.status as 400);
    const setCookie = signup.res.headers.get("set-cookie") ?? "";
    const cookie = setCookie.split(";")[0];
    const org = await call("POST", "/orgs", { name: input.org.name, ...(input.org.timezone ? { timezone: input.org.timezone } : { timezone: "Asia/Tehran" }) }, cookie);
    if (!org.res.ok) return c.json(org.json ?? fail(500, "org", "ساخت سازمان ناموفق بود"), org.res.status as 400);
    const orgId = String(org.json?.id ?? "");
    const warnings: string[] = [];
    // a self-hosted installation has no SaaS ceilings: «سازمانی» becomes the default plan (changeable in «طرح‌ها»)
    await d.db
      .query(`update sm_plans set is_default = (key = 'enterprise') where exists (select 1 from sm_plans where key = 'enterprise')`)
      .catch((e) => warnings.push(`طرح پیش‌فرض تنظیم نشد: ${(e as Error).message}`));
    if (input.smtp) {
      const s = input.smtp;
      const ch = await call(
        "POST",
        `/o/${orgId}/r/email_channel`,
        { name: "Exchange سازمان", active: true, is_default: true, from_address: s.from_address, from_name: s.from_name || input.org.name, smtp_host: s.host, smtp_port: s.port, smtp_security: s.security, smtp_user: s.user || null, smtp_password: s.password || null },
        cookie,
      );
      if (!ch.res.ok) warnings.push(`کانال ایمیل ساخته نشد: ${ch.json?.error?.message ?? ch.res.status}`);
    }
    for (const [i, a] of input.ai.entries()) {
      const conn = await call(
        "POST",
        `/o/${orgId}/ai/connections`,
        { preset: a.kind === "ollama" ? "ollama" : "custom-openai", label: a.label || `مدل محلی ${i + 1}`, base_url: a.base_url.replace(/\/+$/, ""), ...(a.kind === "openai" ? { protocol: "openai-chat" } : {}) },
        cookie,
      );
      if (!conn.res.ok) warnings.push(`اتصال «${a.base_url}» ساخته نشد: ${conn.json?.error?.message ?? conn.res.status}`);
    }
    patchServerConfig(d.file, (x) => {
      x.setup = { token_hash: null, expires_at: null, completed_at: new Date().toISOString() };
    });
    try {
      const f = join(d.config().dirs.data, "setup-url.txt");
      if (existsSync(f)) rmSync(f, { force: true });
    } catch {
      /* best effort */
    }
    d.reload();
    d.log.info("setup: completed", { org_id: orgId, admin: input.admin.email, warnings: warnings.length });
    // a new host name needs a self-signed certificate that names it
    const hostChanged = new URL(before.public_url).host !== new URL(publicUrl).host;
    if (hostChanged && !(before.tls.pfx || (before.tls.cert && before.tls.key))) d.restart("public_url");
    // the administrator is signed in right away
    if (setCookie) c.header("set-cookie", setCookie);
    return c.json({ ok: true, org_id: orgId, recovery_code: signup.json?.recovery_code ?? null, warnings, directory_path: `/${orgId}${DIRECTORY_SETTINGS_PATH}`, restarting: hostChanged });
  });

  return r;
}

/** The configuration as stored now (setup and karizctl change it while the server runs). */
export const readConfig = (file: string) => loadServerConfig(file).config;
