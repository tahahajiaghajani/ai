// Pure logic of DevOps, shared by the server and the screens (no I/O, no crypto):
//   · normalisation of inbound payloads — GitHub, GitLab, Azure DevOps, Jenkins (notification plugin) and the
//     documented generic format — into one small model (push, pull request, build, deployment, flag, ping)
//   · the delivery id of a delivery (idempotency) and the record numbers a text mentions (INC0000012, CHG-12 …)
//   · environment matching (key, aliases, the connection's map, the environment kind)
//   · the DORA metrics with performance bands and weekly series (DEV-015): deployment frequency, lead time for
//     changes, change failure rate, failed deployment recovery time, and the rework rate
export type Json = Record<string, any>;

export interface Actor {
  name: string | null;
  email: string | null;
  login: string | null;
}
export interface RepoInfo {
  name: string;
  url: string | null;
  default_branch: string | null;
  external_id: string | null;
  visibility: "private" | "internal" | "public" | null;
}
export interface CommitInfo {
  sha: string;
  message: string;
  author_name: string | null;
  author_email: string | null;
  at: string | null;
  url: string | null;
}
export interface PrInfo {
  number: number;
  title: string;
  state: "open" | "merged" | "closed";
  author: string | null;
  url: string | null;
  source: string | null;
  target: string | null;
  opened_at: string | null;
  merged_at: string | null;
}
export type BuildStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";
export interface BuildInfo {
  external_id: string;
  run_number: string;
  status: BuildStatus;
  branch: string | null;
  sha: string | null;
  started_at: string | null;
  finished_at: string | null;
  url: string | null;
  tests_total: number | null;
  tests_failed: number | null;
  coverage: number | null;
}
export type DeployStatus = "queued" | "started" | "succeeded" | "failed" | "rolled_back" | "canceled";
export interface DeployInfo {
  external_id: string;
  environment: string;
  status: DeployStatus;
  version: string | null;
  sha: string | null;
  service: string | null;
  release: string | null;
  change: string | null;
  started_at: string | null;
  finished_at: string | null;
  url: string | null;
  description: string | null;
  kind: "planned" | "remediation" | null;
  commits: CommitInfo[];
}
export interface FlagInfo {
  key: string;
  state: "off" | "partial" | "on" | "killed";
  rollout_pct: number | null;
  service: string | null;
  environment: string | null;
}

export type NormalizedEvent =
  | { type: "push"; repo: RepoInfo; branch: string | null; commits: CommitInfo[]; actor: Actor }
  | { type: "pull_request"; repo: RepoInfo; pr: PrInfo; actor: Actor }
  | { type: "build"; repo: RepoInfo | null; pipeline: string | null; build: BuildInfo; actor: Actor }
  | { type: "deployment"; repo: RepoInfo | null; pipeline: string | null; deployment: DeployInfo; actor: Actor }
  | { type: "flag"; flag: FlagInfo; actor: Actor }
  | { type: "ping" }
  | { type: "ignored"; reason: string };

export type ConnectionKind = "github" | "gitlab" | "azure_devops" | "jenkins" | "generic";
export type HeaderFn = (name: string) => string | undefined | null;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): Json[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);
const iso = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const t = /^\d+$/.test(s) ? Number(s) * (s.length <= 10 ? 1000 : 1) : Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
const branchOf = (ref: unknown): string | null => {
  const r = str(ref);
  return r ? r.replace(/^refs\/(heads|tags)\//, "") : null;
};
const actor = (name: unknown, email: unknown, login: unknown): Actor => ({ name: str(name), email: str(email)?.toLowerCase() ?? null, login: str(login) });

function repo(name: unknown, extra: { url?: unknown; default_branch?: unknown; id?: unknown; visibility?: unknown } = {}): RepoInfo | null {
  const n = str(name);
  if (!n) return null;
  const vis = str(extra.visibility);
  return {
    name: n.slice(0, 200),
    url: str(extra.url),
    default_branch: str(extra.default_branch),
    external_id: str(extra.id),
    visibility: vis === "public" || vis === "internal" || vis === "private" ? vis : null,
  };
}

function commitsOf(list: unknown, map: (c: Json) => CommitInfo | null): CommitInfo[] {
  return arr(list).map(map).filter((c): c is CommitInfo => !!c && !!c.sha).slice(0, 200);
}

const ghCommit = (c: Json): CommitInfo | null => ({
  sha: str(c.id ?? c.sha) ?? "",
  message: (str(c.message) ?? "").slice(0, 4000),
  author_name: str(obj(c.author).name),
  author_email: str(obj(c.author).email)?.toLowerCase() ?? null,
  at: iso(c.timestamp ?? obj(c.author).date),
  url: str(c.url),
});

// ---------------------------------------------------------------------------------------------------------------
// GitHub

const GH_DEPLOY: Record<string, DeployStatus> = { pending: "queued", queued: "queued", in_progress: "started", success: "succeeded", failure: "failed", error: "failed" };

function github(event: string, p: Json): NormalizedEvent {
  const r = obj(p.repository);
  const rp = repo(r.full_name ?? r.name, { url: r.html_url, default_branch: r.default_branch, id: r.id, visibility: r.visibility ?? (r.private === true ? "private" : r.private === false ? "public" : null) });
  const who = actor(obj(p.sender).login ?? obj(p.pusher).name, obj(p.pusher).email, obj(p.sender).login);
  switch (event) {
    case "ping":
      return { type: "ping" };
    case "push":
      if (!rp) return { type: "ignored", reason: "مخزن در رویداد نیست" };
      return { type: "push", repo: rp, branch: branchOf(p.ref), commits: commitsOf(p.commits, ghCommit), actor: who };
    case "pull_request": {
      const pr = obj(p.pull_request);
      if (!rp || num(pr.number) === null) return { type: "ignored", reason: "درخواست ادغام ناقص است" };
      const state = pr.merged === true || pr.merged_at ? "merged" : pr.state === "closed" ? "closed" : "open";
      return {
        type: "pull_request", repo: rp, actor: who,
        pr: { number: num(pr.number)!, title: (str(pr.title) ?? "").slice(0, 300), state, author: str(obj(pr.user).login), url: str(pr.html_url), source: str(obj(pr.head).ref), target: str(obj(pr.base).ref), opened_at: iso(pr.created_at), merged_at: iso(pr.merged_at) },
      };
    }
    case "workflow_run": {
      const w = obj(p.workflow_run);
      if (num(w.id) === null) return { type: "ignored", reason: "اجرای خط لوله ناقص است" };
      const status: BuildStatus = w.status === "completed"
        ? w.conclusion === "success" ? "succeeded" : w.conclusion === "cancelled" || w.conclusion === "skipped" ? "canceled" : "failed"
        : w.status === "in_progress" ? "running" : "queued";
      return {
        type: "build", repo: rp, pipeline: str(w.name) ?? str(obj(p.workflow).name), actor: actor(obj(w.actor).login, null, obj(w.actor).login),
        build: { external_id: `gh-run:${w.id}`, run_number: str(w.run_number) ?? String(w.id), status, branch: str(w.head_branch), sha: str(w.head_sha), started_at: iso(w.run_started_at ?? w.created_at), finished_at: w.status === "completed" ? iso(w.updated_at) : null, url: str(w.html_url), tests_total: null, tests_failed: null, coverage: null },
      };
    }
    case "deployment":
    case "deployment_status": {
      const d = obj(p.deployment);
      const s = obj(p.deployment_status);
      if (num(d.id) === null) return { type: "ignored", reason: "استقرار ناقص است" };
      const raw = event === "deployment" ? "pending" : String(s.state ?? "");
      if (raw === "inactive") return { type: "ignored", reason: "استقرار پیشین غیرفعال شد" };
      const status = GH_DEPLOY[raw];
      if (!status) return { type: "ignored", reason: `وضعیت استقرار «${raw}» شناخته نیست` };
      const extra = typeof d.payload === "string" ? safeJson(d.payload) : obj(d.payload);
      return {
        type: "deployment", repo: rp, pipeline: str(d.task) === "deploy" ? null : str(d.task), actor: actor(obj(d.creator).login, null, obj(d.creator).login),
        deployment: {
          external_id: `gh-deploy:${d.id}`, environment: str(s.environment ?? d.environment) ?? "", status,
          version: str(extra.version) ?? str(d.ref), sha: str(d.sha), service: str(extra.service), release: str(extra.release), change: str(extra.change),
          started_at: iso(d.created_at), finished_at: status === "succeeded" || status === "failed" ? iso(s.updated_at ?? s.created_at) : null,
          url: str(s.log_url ?? s.target_url ?? s.environment_url), description: str(s.description ?? d.description), kind: extra.kind === "remediation" ? "remediation" : null,
          commits: [],
        },
      };
    }
    default:
      return { type: "ignored", reason: `رویداد «${event}» به کار دواپس نمی‌آید` };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// GitLab

const GL_PIPE: Record<string, BuildStatus> = { created: "queued", waiting_for_resource: "queued", preparing: "queued", pending: "queued", scheduled: "queued", manual: "queued", running: "running", success: "succeeded", failed: "failed", canceled: "canceled", skipped: "canceled" };
const GL_DEPLOY: Record<string, DeployStatus> = { created: "queued", running: "started", success: "succeeded", failed: "failed", canceled: "canceled" };

function gitlab(event: string, p: Json): NormalizedEvent {
  const pr = obj(p.project);
  const vis = num(pr.visibility_level);
  const rp = repo(pr.path_with_namespace ?? pr.name, { url: pr.web_url, default_branch: pr.default_branch, id: pr.id, visibility: vis === 20 ? "public" : vis === 10 ? "internal" : vis === 0 ? "private" : null });
  const u = obj(p.user);
  const who = actor(u.name ?? p.user_name, u.email ?? p.user_email, u.username ?? p.user_username);
  const kind = String(p.object_kind ?? "");
  const e = event.toLowerCase();
  if (e === "push hook" || kind === "push") {
    if (!rp) return { type: "ignored", reason: "مخزن در رویداد نیست" };
    return { type: "push", repo: rp, branch: branchOf(p.ref), commits: commitsOf(p.commits, ghCommit), actor: who };
  }
  if (e === "merge request hook" || kind === "merge_request") {
    const o = obj(p.object_attributes);
    if (!rp || num(o.iid) === null) return { type: "ignored", reason: "درخواست ادغام ناقص است" };
    const state = o.state === "merged" ? "merged" : o.state === "closed" || o.state === "locked" ? "closed" : "open";
    return {
      type: "pull_request", repo: rp, actor: who,
      pr: { number: num(o.iid)!, title: (str(o.title) ?? "").slice(0, 300), state, author: who.login, url: str(o.url), source: str(o.source_branch), target: str(o.target_branch), opened_at: iso(o.created_at), merged_at: state === "merged" ? iso(o.merged_at ?? o.updated_at) : null },
    };
  }
  if (e === "pipeline hook" || kind === "pipeline") {
    const o = obj(p.object_attributes);
    if (num(o.id) === null) return { type: "ignored", reason: "اجرای خط لوله ناقص است" };
    const status = GL_PIPE[String(o.status ?? "")] ?? "queued";
    return {
      type: "build", repo: rp, pipeline: str(o.name) ?? (rp ? `${rp.name} pipeline` : null), actor: who,
      build: { external_id: `gl-pipe:${o.id}`, run_number: str(o.iid) ?? String(o.id), status, branch: branchOf(o.ref), sha: str(o.sha), started_at: iso(o.created_at), finished_at: iso(o.finished_at), url: rp?.url ? `${rp.url}/-/pipelines/${o.id}` : null, tests_total: null, tests_failed: null, coverage: num(o.coverage) },
    };
  }
  if (e === "deployment hook" || kind === "deployment") {
    const status = GL_DEPLOY[String(p.status ?? "")];
    if (num(p.deployment_id) === null || !status) return { type: "ignored", reason: "استقرار ناقص است" };
    return {
      type: "deployment", repo: rp, pipeline: null, actor: who,
      deployment: {
        external_id: `gl-deploy:${p.deployment_id}`, environment: str(p.environment) ?? "", status, version: str(p.ref) ?? str(p.short_sha), sha: str(p.short_sha),
        service: null, release: null, change: null, started_at: iso(p.status_changed_at), finished_at: status === "succeeded" || status === "failed" ? iso(p.status_changed_at) : null,
        url: str(p.deployable_url ?? p.environment_external_url), description: null, kind: null, commits: [],
      },
    };
  }
  return { type: "ignored", reason: `رویداد «${event || kind}» به کار دواپس نمی‌آید` };
}

// ---------------------------------------------------------------------------------------------------------------
// Azure DevOps (service hooks)

function azure(p: Json): NormalizedEvent {
  const type = String(p.eventType ?? "");
  const res = obj(p.resource);
  if (type === "git.push") {
    const r = obj(res.repository);
    const rp = repo(obj(r.project).name ? `${obj(r.project).name}/${r.name}` : r.name, { url: r.remoteUrl, id: r.id, default_branch: branchOf(r.defaultBranch) });
    if (!rp) return { type: "ignored", reason: "مخزن در رویداد نیست" };
    const commits = commitsOf(res.commits, (c) => ({ sha: str(c.commitId) ?? "", message: (str(c.comment) ?? "").slice(0, 4000), author_name: str(obj(c.author).name), author_email: str(obj(c.author).email)?.toLowerCase() ?? null, at: iso(obj(c.author).date), url: str(c.url) }));
    return { type: "push", repo: rp, branch: branchOf(arr(res.refUpdates)[0]?.name), commits, actor: actor(obj(res.pushedBy).displayName, obj(res.pushedBy).uniqueName, obj(res.pushedBy).uniqueName) };
  }
  if (type.startsWith("git.pullrequest.")) {
    const r = obj(res.repository);
    const rp = repo(obj(r.project).name ? `${obj(r.project).name}/${r.name}` : r.name, { url: r.remoteUrl, id: r.id });
    if (!rp || num(res.pullRequestId) === null) return { type: "ignored", reason: "درخواست ادغام ناقص است" };
    const state = res.status === "completed" ? "merged" : res.status === "abandoned" ? "closed" : "open";
    return {
      type: "pull_request", repo: rp, actor: actor(obj(res.createdBy).displayName, obj(res.createdBy).uniqueName, obj(res.createdBy).uniqueName),
      pr: { number: num(res.pullRequestId)!, title: (str(res.title) ?? "").slice(0, 300), state, author: str(obj(res.createdBy).displayName), url: str(obj(obj(res._links).web).href ?? res.url), source: branchOf(res.sourceRefName), target: branchOf(res.targetRefName), opened_at: iso(res.creationDate), merged_at: state === "merged" ? iso(res.closedDate) : null },
    };
  }
  if (type === "build.complete") {
    const result = String(res.result ?? "");
    const status: BuildStatus = result === "succeeded" || result === "partiallySucceeded" ? "succeeded" : result === "canceled" ? "canceled" : "failed";
    const r = obj(res.repository);
    return {
      type: "build", repo: repo(r.name ?? r.id, { url: r.url }), pipeline: str(obj(res.definition).name), actor: actor(obj(res.requestedFor).displayName, obj(res.requestedFor).uniqueName, obj(res.requestedFor).uniqueName),
      build: { external_id: `az-build:${res.id}`, run_number: str(res.buildNumber) ?? String(res.id ?? ""), status, branch: branchOf(res.sourceBranch), sha: str(res.sourceVersion), started_at: iso(res.startTime), finished_at: iso(res.finishTime), url: str(obj(obj(res._links).web).href ?? res.url), tests_total: null, tests_failed: null, coverage: null },
    };
  }
  if (type === "ms.vss-release.deployment-completed-event" || type === "ms.vss-release.deployment-started-event") {
    const env = obj(res.environment);
    const dep = obj(res.deployment);
    const rel = obj(dep.release ?? res.release);
    const raw = String(env.status ?? res.status ?? "").toLowerCase();
    const status: DeployStatus = type.endsWith("started-event") ? "started" : raw === "succeeded" || raw === "partiallysucceeded" ? "succeeded" : raw === "canceled" ? "canceled" : "failed";
    const id = str(dep.id) ?? str(env.id);
    if (!id || !str(env.name)) return { type: "ignored", reason: "استقرار ناقص است" };
    return {
      type: "deployment", repo: null, pipeline: str(obj(rel.releaseDefinition).name ?? obj(res.releaseDefinition).name), actor: actor(obj(dep.requestedFor).displayName, obj(dep.requestedFor).uniqueName, null),
      deployment: { external_id: `az-deploy:${id}`, environment: str(env.name)!, status, version: str(rel.name), sha: null, service: null, release: null, change: null, started_at: iso(dep.startedOn ?? dep.queuedOn), finished_at: status === "started" ? null : iso(dep.completedOn ?? dep.lastModifiedOn), url: str(obj(obj(rel._links).web).href), description: null, kind: null, commits: [] },
    };
  }
  return { type: "ignored", reason: `رویداد «${type || "ناشناخته"}» به کار دواپس نمی‌آید` };
}

// ---------------------------------------------------------------------------------------------------------------
// Jenkins (notification plugin) and the generic format

const JENKINS: Record<string, BuildStatus> = { SUCCESS: "succeeded", FAILURE: "failed", UNSTABLE: "failed", ABORTED: "canceled", NOT_BUILT: "canceled" };

function jenkinsBuild(p: Json): NormalizedEvent {
  const b = obj(p.build);
  const phase = String(b.phase ?? "").toUpperCase();
  const status: BuildStatus = phase === "STARTED" || phase === "QUEUED" ? "running" : JENKINS[String(b.status ?? "").toUpperCase()] ?? (phase === "COMPLETED" || phase === "FINALIZED" ? "failed" : "running");
  const scm = obj(b.scm);
  return {
    type: "build", repo: repo(scm.url), pipeline: str(p.name), actor: actor(null, null, null),
    build: { external_id: `jenkins:${p.name}#${b.number}`, run_number: String(b.number ?? ""), status, branch: branchOf(scm.branch), sha: str(scm.commit), started_at: null, finished_at: status === "running" ? null : new Date().toISOString(), url: str(b.full_url ?? p.url), tests_total: null, tests_failed: null, coverage: null },
  };
}

const GENERIC_DEPLOY: Record<string, DeployStatus> = { queued: "queued", pending: "queued", started: "started", running: "started", in_progress: "started", succeeded: "succeeded", success: "succeeded", failed: "failed", failure: "failed", error: "failed", rolled_back: "rolled_back", rollback: "rolled_back", canceled: "canceled", cancelled: "canceled" };
const GENERIC_BUILD: Record<string, BuildStatus> = { queued: "queued", pending: "queued", running: "running", started: "running", in_progress: "running", succeeded: "succeeded", success: "succeeded", failed: "failed", failure: "failed", error: "failed", canceled: "canceled", cancelled: "canceled" };

const genCommit = (c: Json): CommitInfo | null => ({ sha: str(c.sha ?? c.id) ?? "", message: (str(c.message) ?? "").slice(0, 4000), author_name: str(c.author_name ?? obj(c.author).name), author_email: str(c.author_email ?? obj(c.author).email)?.toLowerCase() ?? null, at: iso(c.at ?? c.timestamp), url: str(c.url) });

function generic(p: Json): NormalizedEvent {
  const type = String(p.type ?? p.event ?? "").toLowerCase();
  const who = actor(obj(p.actor).name ?? p.actor_name, obj(p.actor).email ?? p.actor_email, obj(p.actor).login ?? p.actor_login);
  const rp = repo(p.repository, { url: p.repository_url });
  switch (type) {
    case "ping":
      return { type: "ping" };
    case "push":
      if (!rp) return { type: "ignored", reason: "نام مخزن (repository) را بفرستید" };
      return { type: "push", repo: rp, branch: branchOf(p.branch ?? p.ref), commits: commitsOf(p.commits, genCommit), actor: who };
    case "pull_request": {
      if (!rp || num(p.number) === null) return { type: "ignored", reason: "مخزن و شمارهٔ درخواست ادغام را بفرستید" };
      const st = String(p.state ?? "open");
      return { type: "pull_request", repo: rp, actor: who, pr: { number: num(p.number)!, title: (str(p.title) ?? "").slice(0, 300), state: st === "merged" ? "merged" : st === "closed" ? "closed" : "open", author: str(p.author), url: str(p.url), source: str(p.source_branch), target: str(p.target_branch), opened_at: iso(p.opened_at), merged_at: iso(p.merged_at) } };
    }
    case "build": {
      const id = str(p.id ?? p.run_id);
      if (!id) return { type: "ignored", reason: "شناسهٔ اجرا (id) را بفرستید" };
      const tests = obj(p.tests);
      return {
        type: "build", repo: rp, pipeline: str(p.pipeline), actor: who,
        build: { external_id: `run:${id}`, run_number: str(p.run_number) ?? id, status: GENERIC_BUILD[String(p.status ?? "").toLowerCase()] ?? "running", branch: branchOf(p.branch), sha: str(p.commit ?? p.sha), started_at: iso(p.started_at), finished_at: iso(p.finished_at), url: str(p.url), tests_total: num(tests.total), tests_failed: num(tests.failed), coverage: num(tests.coverage) },
      };
    }
    case "deployment": {
      const id = str(p.id ?? p.deployment_id);
      const status = GENERIC_DEPLOY[String(p.status ?? "").toLowerCase()];
      if (!id || !str(p.environment) || !status) return { type: "ignored", reason: "شناسه (id)، محیط (environment) و وضعیت (status) استقرار را بفرستید" };
      return {
        type: "deployment", repo: rp, pipeline: str(p.pipeline), actor: who,
        deployment: {
          external_id: `dep:${id}`, environment: str(p.environment)!, status, version: str(p.version), sha: str(p.commit ?? p.sha), service: str(p.service), release: str(p.release), change: str(p.change),
          started_at: iso(p.started_at), finished_at: iso(p.finished_at), url: str(p.url), description: str(p.description), kind: p.kind === "remediation" ? "remediation" : p.kind === "planned" ? "planned" : null,
          commits: commitsOf(p.commits, genCommit),
        },
      };
    }
    case "flag": {
      const key = str(p.key);
      if (!key) return { type: "ignored", reason: "کلید پرچم (key) را بفرستید" };
      const st = String(p.state ?? "").toLowerCase();
      const rollout = num(p.rollout_pct);
      const state: FlagInfo["state"] = st === "killed" ? "killed" : st === "off" ? "off" : rollout !== null && rollout < 100 && rollout > 0 ? "partial" : st === "on" || rollout === 100 ? "on" : "off";
      return { type: "flag", actor: who, flag: { key: key.slice(0, 120), state, rollout_pct: rollout, service: str(p.service), environment: str(p.environment) } };
    }
    default:
      return { type: "ignored", reason: `نوع رویداد «${type || "خالی"}» در قالب عمومی شناخته نیست` };
  }
}

function safeJson(s: string): Json {
  try {
    return obj(JSON.parse(s));
  } catch {
    return {};
  }
}

/** The provider's event name of a delivery (for the log). */
export function providerEvent(kind: ConnectionKind, h: HeaderFn, p: Json): string {
  if (kind === "github") return str(h("x-github-event")) ?? "";
  if (kind === "gitlab") return str(h("x-gitlab-event")) ?? str(p.object_kind) ?? "";
  if (kind === "azure_devops") return str(p.eventType) ?? "";
  if (kind === "jenkins" && !p.type) return "jenkins-build";
  return str(p.type ?? p.event) ?? "";
}

/** One delivery in the shared model. A generic body (with `type`) is understood from every tool. */
export function normalize(kind: ConnectionKind, h: HeaderFn, payload: unknown): NormalizedEvent {
  const p = obj(payload);
  if (kind === "github" && h("x-github-event")) return github(String(h("x-github-event")), p);
  if (kind === "gitlab" && (h("x-gitlab-event") || p.object_kind)) return gitlab(String(h("x-gitlab-event") ?? ""), p);
  if (kind === "azure_devops" && p.eventType) return azure(p);
  if (kind === "jenkins" && !p.type && p.build) return jenkinsBuild(p);
  return generic(p);
}

/** The sender's delivery id (a retried delivery carries the same one), else null. */
export function deliveryIdOf(kind: ConnectionKind, h: HeaderFn, payload: unknown): string | null {
  const p = obj(payload);
  const id =
    str(h("x-github-delivery")) ??
    str(h("x-gitlab-event-uuid")) ??
    str(h("x-gitlab-webhook-uuid")) ??
    str(h("idempotency-key")) ??
    str(h("x-delivery-id")) ??
    (kind === "azure_devops" ? str(p.id) ?? str(p.notificationId) : null) ??
    str(p.delivery_id);
  return id ? id.slice(0, 200) : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Record numbers in texts

/**
 * The record numbers a text mentions, normalised to the engine's form (`INC0000012`): «INC-12», «inc12» and
 * «INC0000012» alike, only for the prefixes given (`prefix → pad`).
 */
export function extractKeys(text: string | null | undefined, prefixes: ReadonlyMap<string, number>): string[] {
  if (!text) return [];
  const out = new Set<string>();
  const re = /(^|[^A-Za-z0-9])([A-Za-z][A-Za-z_]{1,11})[-_ ]?(\d{1,12})(?![0-9])/g;
  for (const m of text.matchAll(re)) {
    const prefix = m[2].toUpperCase();
    const pad = prefixes.get(prefix);
    if (pad === undefined) continue;
    const n = String(Number(m[3]));
    if (n === "0" || n.length > pad + 3) continue;
    out.add(`${prefix}${n.padStart(pad, "0")}`);
    if (out.size >= 30) break;
  }
  return [...out];
}

// ---------------------------------------------------------------------------------------------------------------
// Environments

export interface EnvLike {
  id: string;
  key: string;
  name: string;
  kind?: string | null;
  aliases?: string[] | null;
  active?: boolean | null;
}

/** The environment a tool's environment name means: the connection's map, the key, an alias, the name, a lone kind. */
export function matchEnvironment(name: string, envs: readonly EnvLike[], envMap: Record<string, unknown> = {}): EnvLike | null {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  const live = envs.filter((e) => e.active !== false);
  const mapped = Object.entries(envMap).find(([k]) => k.trim().toLowerCase() === n)?.[1];
  const target = typeof mapped === "string" ? mapped.trim().toLowerCase() : n;
  const by = (f: (e: EnvLike) => boolean) => live.find(f) ?? null;
  return (
    by((e) => e.key.toLowerCase() === target) ??
    by((e) => (e.aliases ?? []).some((a) => a.trim().toLowerCase() === target)) ??
    by((e) => e.name.trim().toLowerCase() === target) ??
    (() => {
      const kinds = live.filter((e) => String(e.kind ?? "") === target || (target === "prod" && e.kind === "production"));
      return kinds.length === 1 ? kinds[0] : null;
    })()
  );
}

// ---------------------------------------------------------------------------------------------------------------
// DORA

const DAY = 86_400_000;
const HOUR = 3_600_000;

export type DoraBand = "elite" | "high" | "medium" | "low" | "none";
export const DORA_BANDS: Record<DoraBand, { label: string; color: string }> = {
  elite: { label: "ممتاز", color: "green" },
  high: { label: "بالا", color: "teal" },
  medium: { label: "متوسط", color: "gold" },
  low: { label: "پایین", color: "red" },
  none: { label: "بی‌داده", color: "gray" },
};

export interface DoraDeployment {
  id: string;
  /** when it finished (succeeded, failed or rolled back) */
  at: number;
  state: string;
  first_commit_at?: number | null;
  restored_at?: number | null;
  change_failure?: boolean | null;
  kind?: string | null;
  service_id?: string | null;
}

export interface DoraWeek {
  week: string;
  deployments: number;
  failures: number;
  lead_p50: number | null;
  restore_p50: number | null;
}

export interface DoraMetrics {
  from: number;
  to: number;
  days: number;
  deployments: number;
  successful: number;
  failures: number;
  frequency: { per_day: number; per_week: number; band: DoraBand };
  lead_time: { p50: number | null; n: number; band: DoraBand };
  change_failure_rate: { pct: number | null; band: DoraBand };
  recovery: { p50: number | null; n: number; open: number; band: DoraBand };
  rework_rate: { pct: number | null };
  weekly: DoraWeek[];
}

export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export type DoraMetricKey = "frequency" | "lead_time" | "cfr" | "recovery";

/** Thresholds of the bands: elite, high and medium limits (deployments per day; seconds; percent). */
export type DoraThresholds = Record<DoraMetricKey, [number, number, number]>;

export const DEFAULT_DORA_THRESHOLDS: DoraThresholds = {
  frequency: [1, 1 / 7, 1 / 30],
  lead_time: [DAY / 1000, (7 * DAY) / 1000, (30 * DAY) / 1000],
  cfr: [5, 10, 15],
  recovery: [HOUR / 1000, DAY / 1000, (7 * DAY) / 1000],
};

/** The DORA definitions an organisation starts with (seeded into the release settings, editable there). */
export const DORA_DEFINITIONS: Record<DoraMetricKey | "rework", { name: string; formula: string; better: "higher" | "lower"; thresholds?: [number, number, number]; unit: string }> = {
  frequency: { name: "تناوب استقرار", formula: "استقرارهای موفق در محیط عملیاتی ÷ روزهای بازه", better: "higher", thresholds: DEFAULT_DORA_THRESHOLDS.frequency, unit: "بار در روز" },
  lead_time: { name: "زمان تحویل تغییر", formula: "میانهٔ (زمان استقرار عملیاتی − زمان نخستین کامیت)", better: "lower", thresholds: DEFAULT_DORA_THRESHOLDS.lead_time, unit: "ثانیه" },
  cfr: { name: "نرخ شکست تغییر", formula: "استقرارهای ناموفق، بازگردانده یا ناشی رخداد ÷ همهٔ استقرارهای عملیاتی", better: "lower", thresholds: DEFAULT_DORA_THRESHOLDS.cfr, unit: "درصد" },
  recovery: { name: "زمان بازیابی از استقرار ناموفق", formula: "میانهٔ (نخستین استقرار موفق بعدی همان محیط و خدمت − پایان استقرار ناموفق)", better: "lower", thresholds: DEFAULT_DORA_THRESHOLDS.recovery, unit: "ثانیه" },
  rework: { name: "نرخ دوباره‌کاری", formula: "استقرارهای رفع اضطراری (هات‌فیکس) ÷ همهٔ استقرارهای عملیاتی", better: "lower", unit: "درصد" },
};

/** The thresholds of a stored definitions object (missing or malformed values fall back to the defaults). */
export function thresholdsOf(defs: unknown): DoraThresholds {
  const out = { ...DEFAULT_DORA_THRESHOLDS };
  const d = obj(defs);
  for (const k of Object.keys(out) as DoraMetricKey[]) {
    const t = obj(d[k]).thresholds;
    if (Array.isArray(t) && t.length === 3 && t.every((x) => typeof x === "number" && Number.isFinite(x))) out[k] = [t[0], t[1], t[2]];
  }
  return out;
}

/** The DORA band of each metric (deployments per day; lead and recovery in seconds; failure rate in percent). */
export function doraBand(metric: DoraMetricKey, v: number | null, t: DoraThresholds = DEFAULT_DORA_THRESHOLDS): DoraBand {
  if (v === null || !Number.isFinite(v)) return "none";
  const [e, h, m] = t[metric];
  if (metric === "frequency") return v >= e ? "elite" : v >= h ? "high" : v >= m ? "medium" : v > 0 ? "low" : "none";
  if (metric === "cfr") return v <= e ? "elite" : v <= h ? "high" : v <= m ? "medium" : "low";
  return v < e ? "elite" : v < h ? "high" : v < m ? "medium" : "low";
}

/** Saturday (UTC) of the week an instant falls in, as YYYY-MM-DD (weeks start on Saturday). */
export function weekOf(t: number): string {
  const day = Math.floor(t / DAY);
  // 1970-01-01 was a Thursday: Saturday is two days later
  const sat = day - ((day - 2) % 7 + 7) % 7;
  return new Date(sat * DAY).toISOString().slice(0, 10);
}

const FAILED_STATES = ["failed", "rolled_back"];
const OK_STATES = ["succeeded", "closed"];

/** DORA metrics over production deployments finished in [from, to). */
export function doraMetrics(input: readonly DoraDeployment[], range: { from: number; to: number }, t: DoraThresholds = DEFAULT_DORA_THRESHOLDS): DoraMetrics {
  const deps = input.filter((d) => d.at >= range.from && d.at < range.to && (OK_STATES.includes(d.state) || FAILED_STATES.includes(d.state)));
  const days = Math.max(1, (range.to - range.from) / DAY);
  const ok = deps.filter((d) => OK_STATES.includes(d.state));
  const isFailure = (d: DoraDeployment) => FAILED_STATES.includes(d.state) || d.change_failure === true;
  const failures = deps.filter(isFailure);
  const leads = ok.map((d) => (d.first_commit_at && d.first_commit_at <= d.at ? (d.at - d.first_commit_at) / 1000 : null)).filter((x): x is number => x !== null);
  const recoveries = failures.map((d) => (d.restored_at && d.restored_at >= d.at ? (d.restored_at - d.at) / 1000 : null)).filter((x): x is number => x !== null);
  const perDay = ok.length / days;
  const cfr = deps.length ? Math.round((failures.length / deps.length) * 1000) / 10 : null;
  const lead = median(leads);
  const rec = median(recoveries);
  const rework = deps.length ? Math.round((deps.filter((d) => d.kind === "remediation").length / deps.length) * 1000) / 10 : null;
  const weeks = new Map<string, DoraDeployment[]>();
  for (let t = range.from; t < range.to; t += 7 * DAY) weeks.set(weekOf(t), []);
  for (const d of deps) {
    const w = weekOf(d.at);
    if (!weeks.has(w)) weeks.set(w, []);
    weeks.get(w)!.push(d);
  }
  const weekly = [...weeks.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([week, ds]) => ({
    week,
    deployments: ds.filter((d) => OK_STATES.includes(d.state)).length,
    failures: ds.filter(isFailure).length,
    lead_p50: median(ds.map((d) => (OK_STATES.includes(d.state) && d.first_commit_at && d.first_commit_at <= d.at ? (d.at - d.first_commit_at) / 1000 : null)).filter((x): x is number => x !== null)),
    restore_p50: median(ds.filter(isFailure).map((d) => (d.restored_at && d.restored_at >= d.at ? (d.restored_at - d.at) / 1000 : null)).filter((x): x is number => x !== null)),
  }));
  return {
    from: range.from,
    to: range.to,
    days: Math.round(days),
    deployments: deps.length,
    successful: ok.length,
    failures: failures.length,
    frequency: { per_day: Math.round(perDay * 1000) / 1000, per_week: Math.round(perDay * 7 * 100) / 100, band: ok.length ? doraBand("frequency", perDay, t) : "none" },
    lead_time: { p50: lead === null ? null : Math.round(lead), n: leads.length, band: doraBand("lead_time", lead, t) },
    change_failure_rate: { pct: cfr, band: doraBand("cfr", cfr, t) },
    recovery: { p50: rec === null ? null : Math.round(rec), n: recoveries.length, open: failures.length - recoveries.length, band: doraBand("recovery", rec, t) },
    rework_rate: { pct: rework },
    weekly,
  };
}
