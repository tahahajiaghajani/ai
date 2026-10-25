import "server-only";
import { headers } from "next/headers";
import { assertAdmin } from "@/lib/admin-auth";
import { decrypt, MIN_SECRET } from "@/lib/crypto";
import { env } from "@/lib/env";
import { getFile, gh, ghConfigured } from "@/lib/github";
import { GEMINI_CHAIN } from "@/lib/ai/runtime";
import { probeGeminiKey } from "@/lib/ai/gemini";
import { probeBot, type Bot } from "@/lib/notify";
import { AI_ERROR, AI_TRANSIENT, botErrorFa, parseTokenExpiry } from "@/lib/status-text";
import { KNOWLEDGE_FILE } from "@/lib/knowledge-file";
import { loadSettings } from "@/lib/settings";
import { DEFAULT_SETTINGS, type NotifyChannel, type Settings } from "@/lib/settings-types";
import { REQUEST_LABEL } from "@/lib/request-issue";

export type Status = "ok" | "warn" | "error" | "off";

export interface ConnectionReport {
  checkedAt: string;
  github: {
    status: Status;
    tokenSet: boolean;
    repo: string;
    repoValid: boolean;
    reachable: boolean;
    error: string;
    url: string;
    private: boolean | null;
    issues: boolean | null;
    settingsFile: boolean | null;
    knowledgeFile: boolean | null;
    labels: boolean | null;
    /** when the fine-grained token stops working (GitHub sends it with every response) */
    tokenExpires: string | null;
    /** the header as GitHub sent it, when it could not be read */
    tokenExpiresRaw: string;
    rateRemaining: number | null;
  };
  security: { status: Status; adminPassword: boolean; appSecret: "ok" | "short" | "missing"; previous: boolean };
  ai: {
    status: Status;
    enabled: boolean;
    keySource: "panel" | "env" | "none";
    keyHint: string;
    keyUnreadable: boolean;
    models: string[];
    modelsSource: "panel" | "env" | "default";
    /** a live check of the key (no generation quota): null = not checked, "" = works, else the problem in Persian */
    live: string | null;
  };
  notify: {
    status: Status;
    channel: NotifyChannel;
    source: "panel" | "env" | "none";
    tokenHint: string;
    tokenUnreadable: boolean;
    chatId: string;
    /** live check: the bot's username, and whether the chat id was found (null = could not tell) */
    live: { ok: boolean; username: string; chatOk: boolean | null; error: string } | null;
  };
  site: { status: Status; configured: string; current: string; explicit: boolean; vercelUrl: boolean };
  vercel: { status: Status; onVercel: boolean; environment: string; region: string; commit: string; branch: string; url: string };
}

async function currentOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return host ? `${proto}://${host}` : "";
}

const DAY = 86400_000;

function githubError(status: number, message: string): string {
  if (status === 401) return "توکن GitHub نامعتبر یا منقضی است.";
  if (status === 403) return `GitHub اجازه نداد (${message}). دسترسی‌های توکن را بررسی کنید.`;
  if (status === 404) return "مخزن پیدا نشد یا توکن به آن دسترسی ندارد (در ساخت توکن، همین مخزن را انتخاب کنید).";
  if (status === 0) return message === "timeout" ? "GitHub در زمان مقرر پاسخ نداد." : "اتصال به GitHub برقرار نشد.";
  return `${status} · ${message}`;
}

/** Live status of everything the site depends on (admin only). */
export async function connectionReport(): Promise<ConnectionReport> {
  await assertAdmin();
  const tokenSet = Boolean(env.githubToken);
  const repo = env.githubRepo;
  const repoValid = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo);

  const g: ConnectionReport["github"] = {
    status: "error",
    tokenSet,
    repo,
    repoValid,
    reachable: false,
    error: "",
    url: repo ? `https://github.com/${repo}` : "",
    private: null,
    issues: null,
    settingsFile: null,
    knowledgeFile: null,
    labels: null,
    tokenExpires: null,
    tokenExpiresRaw: "",
    rateRemaining: null,
  };
  let settings: Settings = DEFAULT_SETTINGS;
  if (ghConfigured()) {
    const r = await gh<{ private: boolean; has_issues: boolean; html_url: string }>("GET", "");
    g.reachable = r.ok;
    const expHeader = r.headers?.get("github-authentication-token-expiration") ?? "";
    const exp = parseTokenExpiry(expHeader);
    g.tokenExpires = exp === null ? null : new Date(exp).toISOString();
    g.tokenExpiresRaw = exp === null ? expHeader.slice(0, 60) : "";
    const left = Number(r.headers?.get("x-ratelimit-remaining"));
    g.rateRemaining = Number.isFinite(left) && r.headers?.has("x-ratelimit-remaining") ? left : null;
    if (!r.ok || !r.data) g.error = githubError(r.status, r.message);
    else {
      g.private = r.data.private;
      g.issues = r.data.has_issues;
      g.url = r.data.html_url;
      const [s, k, l] = await Promise.all([
        loadSettings().catch(() => null),
        getFile(KNOWLEDGE_FILE).then((f) => Boolean(f)).catch(() => null),
        gh("GET", `/labels/${REQUEST_LABEL}`).then((x) => (x.ok ? true : x.status === 404 ? false : null)),
      ]);
      g.settingsFile = s ? s.sha !== null : null;
      if (s) settings = s.settings;
      g.knowledgeFile = k;
      g.labels = l;
    }
    const expiresSoon = g.tokenExpires !== null && Date.parse(g.tokenExpires) - Date.now() < 14 * DAY;
    g.status = !g.reachable || g.private === false || g.issues === false ? "error" : !g.settingsFile || !g.knowledgeFile || !g.labels || expiresSoon ? "warn" : "ok";
  }

  const secret = env.appSecret;
  const security: ConnectionReport["security"] = {
    adminPassword: Boolean(env.adminPassword),
    appSecret: !secret ? "missing" : secret.length < MIN_SECRET ? "short" : "ok",
    previous: Boolean(env.appSecretPrevious),
    status: "ok",
  };
  // a short secret is refused (the panel and tracking links stay off), so it is an error, not a warning
  security.status = !security.adminPassword || security.appSecret !== "ok" ? "error" : "ok";

  const panelKey = decrypt(settings.ai.keyEnc);
  const keyUnreadable = Boolean(settings.ai.keyEnc) && !panelKey;
  const keySource = panelKey ? "panel" : env.geminiKey ? "env" : "none";
  const n = settings.notify;
  const panelToken = decrypt(n.tokenEnc);
  const notifySource = n.channel === "none" ? "none" : panelToken && n.chatId ? "panel" : env.telegramToken && env.telegramChatId ? "env" : "none";
  const bot: Bot | null =
    notifySource === "panel" ? { channel: n.channel as Bot["channel"], token: panelToken, chatId: n.chatId } : notifySource === "env" ? { channel: env.telegramChannel, token: env.telegramToken, chatId: env.telegramChatId } : null;
  // live checks run side by side and spend no quota: listing one model, and the bot's getMe/getChat
  const [aiKind, botLive] = await Promise.all([
    settings.ai.enabled && keySource !== "none" ? probeGeminiKey(panelKey || env.geminiKey) : Promise.resolve(undefined),
    bot ? probeBot(bot) : Promise.resolve(null),
  ]);
  const aiLive = aiKind === undefined ? null : aiKind === null ? "" : AI_ERROR[aiKind];
  const modelsSource = settings.ai.models.length ? "panel" : env.geminiModels.length ? "env" : "default";
  const ai: ConnectionReport["ai"] = {
    enabled: settings.ai.enabled,
    keySource,
    keyHint: panelKey ? settings.ai.keyHint : "",
    keyUnreadable,
    models: [...new Set([...(modelsSource === "panel" ? settings.ai.models : modelsSource === "env" ? env.geminiModels : []), ...GEMINI_CHAIN])],
    modelsSource,
    live: aiLive,
    status: !settings.ai.enabled
      ? "off"
      : keySource === "none"
        ? "error"
        : aiKind && !AI_TRANSIENT.includes(aiKind)
          ? "error"
          : keyUnreadable || aiKind
            ? "warn"
            : "ok",
  };

  const notify: ConnectionReport["notify"] = {
    channel: n.channel,
    source: notifySource,
    tokenHint: panelToken ? n.tokenHint : "",
    tokenUnreadable: Boolean(n.tokenEnc) && !panelToken,
    chatId: n.chatId,
    live: botLive ? { ...botLive, error: botLive.error ? botErrorFa(botLive.error) : "" } : null,
    // nothing set up yet is "optional", not a problem; a bot that is set up but fails is
    status: notifySource === "none" ? (n.tokenEnc && !panelToken ? "warn" : "off") : !botLive?.ok ? (botLive?.error === "network" ? "warn" : "error") : botLive.chatOk === false ? "error" : "ok",
  };

  const configured = env.siteUrl;
  const current = await currentOrigin();
  const explicit = Boolean(process.env.NEXT_PUBLIC_SITE_URL);
  let sameHost = true;
  try {
    sameHost = !current || new URL(configured).host === new URL(current).host;
  } catch {
    sameHost = false;
  }

  const onVercel = process.env.VERCEL === "1";
  // without NEXT_PUBLIC_SITE_URL the site uses Vercel's production address (the shortest custom domain, if any)
  const vercelUrl = !explicit && onVercel && Boolean(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  const vercel: ConnectionReport["vercel"] = {
    onVercel,
    environment: process.env.VERCEL_ENV ?? "",
    region: process.env.VERCEL_REGION ?? "",
    commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7),
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? "",
    url: process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "",
    status: onVercel ? "ok" : "off",
  };

  return {
    checkedAt: new Date().toISOString(),
    github: g,
    security,
    ai,
    notify,
    site: { status: (explicit || vercelUrl) && sameHost ? "ok" : "warn", configured, current, explicit, vercelUrl },
    vercel,
  };
}

/** The settings the forms start from, with every secret removed. */
export function publicSettings(s: Settings) {
  return {
    updatedAt: s.updatedAt,
    ai: { enabled: s.ai.enabled, hasKey: Boolean(s.ai.keyEnc), keyHint: s.ai.keyHint, models: s.ai.models },
    notify: { channel: s.notify.channel, hasToken: Boolean(s.notify.tokenEnc), tokenHint: s.notify.tokenHint, chatId: s.notify.chatId },
  };
}
export type PublicSettings = ReturnType<typeof publicSettings>;

