import "server-only";
import { env } from "@/lib/env";

/**
 * The site's only storage: one private GitHub repository, reached with a fine-grained token (GITHUB_TOKEN, scoped to
 * GITHUB_REPO with Contents and Issues read/write). Requests are issues, messages are comments, and the panel's
 * settings and extra knowledge are files. Plain fetch, never cached; callers cache what they read often.
 */

export class GhError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export interface GhResponse<T> {
  ok: boolean;
  status: number;
  data: T | null;
  message: string;
  headers: Headers | null;
}

const REPO = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

export function ghConfigured(): boolean {
  return Boolean(env.githubToken) && REPO.test(env.githubRepo);
}

/** One call to the GitHub REST API; `path` is under the repository ("" = the repository itself). Never throws. */
export async function gh<T = unknown>(method: string, path: string, body?: unknown, timeoutMs = 10_000): Promise<GhResponse<T>> {
  if (!ghConfigured()) return { ok: false, status: 0, data: null, message: "not configured", headers: null };
  try {
    const res = await fetch(`${env.githubApi}/repos/${env.githubRepo}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${env.githubToken}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "taha-portfolio",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    const message = res.ok ? "" : ((data as { message?: string } | null)?.message ?? `HTTP ${res.status}`).slice(0, 300);
    return { ok: res.ok, status: res.status, data: res.ok ? (data as T) : null, message, headers: res.headers };
  } catch (e) {
    const message = e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network";
    return { ok: false, status: 0, data: null, message, headers: null };
  }
}

let privacy: { at: number; isPrivate: boolean } | null = null;

/**
 * Requests and questions carry visitors' names and contact details, so they are only ever written to a private
 * repository. Checked at most every ten minutes per instance; throws when the repository is public or unreachable.
 */
export async function assertPrivateRepo(): Promise<void> {
  if (!privacy || Date.now() - privacy.at > 10 * 60_000) {
    const r = await gh<{ private: boolean }>("GET", "");
    if (!r.ok || !r.data) throw new GhError(r.message, r.status);
    privacy = { at: Date.now(), isPrivate: r.data.private === true };
  }
  if (!privacy.isPrivate) throw new GhError("the data repository is public; make it private", 403);
}

async function must<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await gh<T>(method, path, body);
  if (!r.ok || r.data === null) throw new GhError(r.message || "github error", r.status);
  return r.data;
}

const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

/* ------------------------------------------------------------------ files */

export async function getFile(path: string): Promise<{ text: string; sha: string } | null> {
  const r = await gh<{ content?: string; encoding?: string; sha: string; type?: string }>("GET", `/contents/${encodePath(path)}`);
  if (r.status === 404) return null;
  if (!r.ok || !r.data) throw new GhError(r.message, r.status);
  if (r.data.type && r.data.type !== "file") throw new GhError(`${path} is not a file`, 400);
  return { text: Buffer.from(r.data.content ?? "", "base64").toString("utf8"), sha: r.data.sha };
}

/** Creates or replaces a file; `sha` is the version being replaced (none = create). Returns the new sha. */
export async function putFile(path: string, text: string, message: string, sha?: string): Promise<string> {
  const d = await must<{ content: { sha: string } }>("PUT", `/contents/${encodePath(path)}`, {
    message,
    content: Buffer.from(text, "utf8").toString("base64"),
    ...(sha ? { sha } : {}),
  });
  return d.content.sha;
}

/* ----------------------------------------------------------------- issues */

export interface GhIssue {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  labels: ({ name: string } | string)[];
  html_url: string;
  created_at: string;
  updated_at: string;
  pull_request?: unknown;
}

export interface GhComment {
  id: number;
  body: string;
  created_at: string;
  html_url: string;
}

export function createIssue(input: { title: string; body: string; labels?: string[] }): Promise<GhIssue> {
  return must<GhIssue>("POST", "/issues", input);
}

export async function getIssue(n: number): Promise<GhIssue | null> {
  if (!Number.isInteger(n) || n < 1) return null;
  const r = await gh<GhIssue>("GET", `/issues/${n}`);
  if (r.status === 404 || r.status === 410) return null;
  if (!r.ok || !r.data) throw new GhError(r.message, r.status);
  return r.data.pull_request ? null : r.data;
}

export function updateIssue(n: number, patch: { title?: string; body?: string; state?: "open" | "closed"; labels?: string[] }): Promise<GhIssue> {
  return must<GhIssue>("PATCH", `/issues/${n}`, patch);
}

/** Newest first; pull requests are left out. */
export async function listIssues(q: { labels?: string; state?: "open" | "closed" | "all"; perPage?: number; page?: number }): Promise<GhIssue[]> {
  const params = new URLSearchParams({ state: q.state ?? "all", sort: "created", direction: "desc", per_page: String(q.perPage ?? 100), page: String(q.page ?? 1) });
  if (q.labels) params.set("labels", q.labels);
  const list = await must<GhIssue[]>("GET", `/issues?${params}`);
  return list.filter((i) => !i.pull_request);
}

/** Oldest first, up to 300 comments. */
export async function listComments(n: number): Promise<GhComment[]> {
  const out: GhComment[] = [];
  for (let page = 1; page <= 3; page++) {
    const batch = await must<GhComment[]>("GET", `/issues/${n}/comments?per_page=100&page=${page}`);
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

export function addComment(n: number, body: string): Promise<GhComment> {
  return must<GhComment>("POST", `/issues/${n}/comments`, { body });
}

/** Creates the labels the site uses (an existing label answers 422 and is left as it is). */
export async function ensureLabels(labels: { name: string; color: string; description?: string }[]): Promise<void> {
  for (const l of labels) {
    const r = await gh("POST", "/labels", l);
    if (!r.ok && r.status !== 422) throw new GhError(r.message, r.status);
  }
}
