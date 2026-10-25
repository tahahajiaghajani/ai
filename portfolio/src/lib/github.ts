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
    /** GitHub's primary or secondary rate limit, not a permission problem */
    public rateLimited = false,
  ) {
    super(message);
  }
}

const isRateLimit = (r: GhResponse<unknown>) =>
  r.status === 429 || (r.status === 403 && (r.headers?.get("x-ratelimit-remaining") === "0" || r.headers?.has("retry-after") || /rate limit/i.test(r.message)));

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

/** The data repository is public: nothing is written to it and no tracking page is shown. */
export class PublicRepoError extends GhError {
  constructor() {
    super("the data repository is public; make it private", 403);
  }
}

let privateSince = 0;

/**
 * The repository holds visitors' names and contact details, so the site stops writing to it (and stops showing
 * tracking pages) once it is public. Only a "private" answer is remembered, for one minute per instance: a repository
 * made public is noticed within a minute, one made private again at once. Throws when public or unreachable.
 */
export async function assertPrivateRepo(): Promise<void> {
  if (Date.now() - privateSince < 60_000) return;
  const r = await gh<{ private: boolean }>("GET", "");
  if (!r.ok || !r.data) throw new GhError(r.message, r.status, isRateLimit(r));
  if (r.data.private !== true) throw new PublicRepoError();
  privateSince = Date.now();
}

/** A call that must succeed; every write first checks that the repository is private. */
async function must<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (method !== "GET") await assertPrivateRepo();
  const r = await gh<T>(method, path, body);
  if (!r.ok || r.data === null) throw new GhError(r.message || "github error", r.status, isRateLimit(r));
  return r.data;
}

const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

/* ------------------------------------------------------------------ files */

export async function getFile(path: string): Promise<{ text: string; sha: string } | null> {
  const r = await gh<{ content?: string; encoding?: string; sha: string; type?: string }>("GET", `/contents/${encodePath(path)}`);
  if (r.status === 404) return null;
  if (!r.ok || !r.data) throw new GhError(r.message, r.status, isRateLimit(r));
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
  comments: number;
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
  /** the writer's relation to the repository: OWNER, MEMBER, COLLABORATOR, … NONE */
  author_association: string;
}

export function createIssue(input: { title: string; body: string; labels?: string[] }): Promise<GhIssue> {
  return must<GhIssue>("POST", "/issues", input);
}

export async function getIssue(n: number): Promise<GhIssue | null> {
  if (!Number.isInteger(n) || n < 1) return null;
  const r = await gh<GhIssue>("GET", `/issues/${n}`);
  if (r.status === 404 || r.status === 410) return null;
  if (!r.ok || !r.data) throw new GhError(r.message, r.status, isRateLimit(r));
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

/** The newest comments (up to `max`), oldest first: comments can only be listed in ascending order, so read the last pages. */
export async function listRecentComments(n: number, max = 100): Promise<GhComment[]> {
  const issue = await getIssue(n);
  if (!issue) return [];
  const last = Math.max(1, Math.ceil((issue.comments || 0) / 100));
  const pages = [last - 1, last].filter((p) => p >= 1 && (last - p) * 100 < max + 100);
  const out: GhComment[] = [];
  for (const page of pages) out.push(...(await must<GhComment[]>("GET", `/issues/${n}/comments?per_page=100&page=${page}`)));
  return out.slice(-max);
}

export function addComment(n: number, body: string): Promise<GhComment> {
  return must<GhComment>("POST", `/issues/${n}/comments`, { body });
}

/** Creates the labels the site uses (an existing label answers 422 and is left as it is). */
export async function ensureLabels(labels: { name: string; color: string; description?: string }[]): Promise<void> {
  await assertPrivateRepo();
  for (const l of labels) {
    const r = await gh("POST", "/labels", l);
    if (!r.ok && r.status !== 422) throw new GhError(r.message, r.status, isRateLimit(r));
  }
}
