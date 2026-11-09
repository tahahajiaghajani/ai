// Inbound deliveries of DevOps tools (DEV-001/003/007): POST /api/public/devops/hooks/:key (src/server/routes/devops.ts)
//   1. the connection of the URL's key (active; else 404/410), the body's size, the signature against the
//      connection's sealed secret (`readSecret`; no secret → refused)
//   2. idempotency: the sender's delivery id (else the body's hash) is stored once per connection (`dev_event`
//      unique); a repeated delivery answers «duplicate» and changes nothing
//   3. the body is normalised (@shared/devops/logic) and processed as the system of the organisation, in one
//      transaction: repositories and pipelines are created on first sight; commits, pull requests and builds are
//      stored with the record numbers they mention; a deployment becomes (or moves) a `deployment` of the release
//      module — environment from the connection's map, service, release and change from the payload or the numbers
//      it mentions — and a production deployment without a change gets an automatic standard change from the
//      configured template of the change module (scheduled through the change module's own guards); a flag updates
//      the feature flag of its key
//   4. the event's outcome (processed / ignored / failed) and the connection's health are recorded
// Processing failures answer 200 with «failed» (the sender would retry the same delivery forever); people retry from
// the event list after fixing the cause.
import { extractKeys, matchEnvironment, normalize, deliveryIdOf, providerEvent, type ConnectionKind, type DeployInfo, type HeaderFn, type NormalizedEvent, type RepoInfo } from "@shared/devops/logic";
import type { ServerConfig, Ctx } from "../../context";
import type { Tx } from "../../db";
import { createIn, defFor, readSecret, savepoint, systemCtx, transitionIn, updateIn } from "../../engine";
import { AppError, bad, notFound, unauthorized } from "../../http/errors";
import { MAX_DELIVERY_BYTES, STORED_PAYLOAD_BYTES, eqAll, isUuid, liveRow, liveRows, msOf, numberPrefixes, releaseConfig, sha256, verifyDelivery, type Row } from "./common";

export interface IngestResult {
  status: "processed" | "ignored" | "failed" | "duplicate";
  event_id: string | null;
  message?: string;
  result?: Row;
}

/** The connection of a webhook key (any organisation), or null. */
export async function connectionByKey(cfg: ServerConfig, key: string): Promise<{ id: string; org_id: string } | null> {
  if (!/^[A-Za-z0-9_-]{10,80}$/.test(key)) return null;
  return cfg.db.one<{ id: string; org_id: string }>(`select id, org_id from sm_devops_connections where hook_key = $1 and deleted_at is null order by created_at limit 1`, [key]);
}

/** The connection (as the system) and its plain secret. */
export async function openConnection(cfg: ServerConfig, key: string): Promise<{ sys: Ctx; conn: Row; secret: string | null }> {
  const found = await connectionByKey(cfg, key);
  if (!found) throw notFound("اتصال پیدا نشد");
  const sys = await systemCtx(cfg, found.org_id);
  const conn = await liveRow(sys.db, sys, "devops_connection", found.id);
  if (!conn) throw notFound("اتصال پیدا نشد");
  if (conn.active === false) throw new AppError(410, "gone", "این اتصال غیرفعال است");
  const { def } = await defFor(sys, "devops_connection");
  const secret = await readSecret(sys.db, sys, def, String(conn.id), "secret");
  return { sys, conn, secret };
}

/** Verify a delivery's signature (401 in Persian when it does not prove the secret). */
export function authenticate(secret: string | null, raw: string, h: HeaderFn): "hmac" | "token" | "basic" {
  if (!secret) throw unauthorized("راز امضای این اتصال هنوز ساخته نشده است؛ در تنظیمات اتصال «ساخت راز» را بزنید");
  const by = verifyDelivery(secret, raw, h);
  if (!by) throw unauthorized("امضای درخواست معتبر نیست");
  return by;
}

/** Receive one delivery. */
export async function ingestDelivery(cfg: ServerConfig, key: string, h: HeaderFn, raw: string): Promise<IngestResult> {
  if (Buffer.byteLength(raw, "utf8") > MAX_DELIVERY_BYTES) throw new AppError(413, "too_large", "حجم رویداد بیش از اندازهٔ مجاز است");
  const { sys, conn, secret } = await openConnection(cfg, key);
  const verifiedBy = authenticate(secret, raw, h);
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw bad("بدنهٔ درخواست JSON نیست");
  }
  const kind = String(conn.kind ?? "generic") as ConnectionKind;
  const hash = sha256(raw);
  const deliveryId = deliveryIdOf(kind, h, payload) ?? `sha256:${hash}`;
  const normalized = normalize(kind, h, payload);
  const event = await storeEvent(sys, conn, { deliveryId, hash, verifiedBy, providerEvent: providerEvent(kind, h, (payload ?? {}) as Row), type: normalized.type, payload: raw.length <= STORED_PAYLOAD_BYTES ? payload : { truncated: true, bytes: raw.length } });
  if (!event) return { status: "duplicate", event_id: null, message: "این تحویل پیش‌تر دریافت شده است" };
  return processEvent(sys, conn, event, normalized);
}

/** Store the event once per (connection, delivery id); null when it was already stored. */
async function storeEvent(sys: Ctx, conn: Row, e: { deliveryId: string; hash: string; verifiedBy: string; providerEvent: string; type: string; payload: unknown }): Promise<Row | null> {
  const existing = await liveRows(sys.db, sys, "dev_event", eqAll({ connection_id: conn.id, delivery_id: e.deliveryId }), { limit: 1 });
  if (existing.length) return null;
  // the signature covers the body, not the delivery id header: the same signed body sent again under another id
  // within a day is the same event (a replay or a tool's blind retry), unless the first one failed
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const same = await liveRows(sys.db, sys, "dev_event", { and: [{ f: "connection_id", op: "eq", v: conn.id }, { f: "payload_hash", op: "eq", v: e.hash }, { f: "received_at", op: "gte", v: since }, { f: "status", op: "ne", v: "failed" }] }, { limit: 1 });
  if (same.length) return null;
  try {
    return await sys.write((tx) =>
      createIn(tx, sys, "dev_event", {
        connection_id: conn.id, delivery_id: e.deliveryId, kind: EVENT_KIND[e.type] ?? "other", provider_event: e.providerEvent.slice(0, 120), status: "received",
        verified_by: e.verifiedBy, received_at: new Date().toISOString(), payload_hash: e.hash, payload: e.payload,
      }, { trusted: true }),
    );
  } catch (err) {
    // a concurrent delivery of the same id won the unique index
    if ((await liveRows(sys.db, sys, "dev_event", eqAll({ connection_id: conn.id, delivery_id: e.deliveryId }), { limit: 1 })).length) return null;
    throw err;
  }
}

const EVENT_KIND: Record<string, string> = { push: "push", pull_request: "pull_request", build: "build", deployment: "deployment", flag: "flag", ping: "ping", ignored: "other" };

/** Process a stored event and record its outcome (also «تلاش دوباره» of a failed event). */
export async function processEvent(sys: Ctx, conn: Row, event: Row, n: NormalizedEvent): Promise<IngestResult> {
  const now = new Date().toISOString();
  try {
    const result = n.type === "ignored" ? null : await sys.write((tx) => apply(tx, sys, conn, n));
    const status = n.type === "ignored" || result?.ignored ? "ignored" : "processed";
    const message = n.type === "ignored" ? n.reason : (result?.ignored as string | undefined);
    await sys.write(async (tx) => {
      await updateIn(tx, sys, "dev_event", String(event.id), { status, processed_at: now, result: result ?? { reason: message }, error: status === "ignored" ? (message ?? null) : null }, { trusted: true });
      await connectionStats(tx, sys, String(conn.id), { failed: false, at: now });
    });
    return { status, event_id: String(event.id), ...(message ? { message } : {}), result: result ?? undefined };
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    await sys.write(async (tx) => {
      await updateIn(tx, sys, "dev_event", String(event.id), { status: "failed", processed_at: now, error: message }, { trusted: true });
      await connectionStats(tx, sys, String(conn.id), { failed: true, at: now, error: message });
    });
    return { status: "failed", event_id: String(event.id), message };
  }
}

/** The connection's counters and health after an event. */
async function connectionStats(tx: Tx, sys: Ctx, id: string, o: { failed: boolean; at: string; error?: string }): Promise<void> {
  const c = await liveRow(tx, sys, "devops_connection", id);
  if (!c) return;
  const total = Number(c.events_total ?? 0) + 1;
  const failed = Number(c.events_failed ?? 0) + (o.failed ? 1 : 0);
  const health = o.failed ? (failed / total > 0.2 ? "error" : "warning") : failed / total > 0.2 ? "warning" : "ok";
  await updateIn(tx, sys, "devops_connection", id, { events_total: total, events_failed: failed, last_event_at: o.at, health, ...(o.failed ? { last_error: o.error ?? null } : {}) }, { trusted: true, keepVersion: true });
}

// ---------------------------------------------------------------------------------------------------------------
// Applying a normalised event

async function ensureRepo(tx: Tx, sys: Ctx, conn: Row, info: RepoInfo | null): Promise<Row | null> {
  if (!info?.name) return null;
  const name = info.name.slice(0, 200);
  const [found] = await liveRows(tx, sys, "dev_repository", eqAll({ connection_id: conn.id, name }), { limit: 1 });
  if (found) {
    const patch: Row = {};
    if (info.url && !found.url) patch.url = info.url;
    if (info.default_branch && found.default_branch !== info.default_branch) patch.default_branch = info.default_branch;
    return Object.keys(patch).length ? updateIn(tx, sys, "dev_repository", String(found.id), patch, { trusted: true, keepVersion: true }) : found;
  }
  return createIn(tx, sys, "dev_repository", {
    connection_id: conn.id, name, url: info.url, default_branch: info.default_branch, visibility: info.visibility ?? "private", external_id: info.external_id,
    service_id: conn.service_id ?? null, owner_group_id: conn.assignment_group_id ?? null,
  }, { trusted: true });
}

async function ensurePipeline(tx: Tx, sys: Ctx, conn: Row, name: string | null, repo: Row | null): Promise<Row | null> {
  if (!name) return null;
  const n = name.slice(0, 200);
  const [found] = await liveRows(tx, sys, "dev_pipeline", eqAll({ connection_id: conn.id, name: n }), { limit: 1 });
  if (found) return found;
  return createIn(tx, sys, "dev_pipeline", { connection_id: conn.id, name: n, repository_id: repo?.id ?? null, service_id: repo?.service_id ?? conn.service_id ?? null }, { trusted: true });
}

const keysOf = (...texts: (string | null | undefined)[]) => [...new Set(texts.flatMap((t) => extractKeys(t, numberPrefixes())))].slice(0, 30);

async function apply(tx: Tx, sys: Ctx, conn: Row, n: NormalizedEvent): Promise<Row> {
  switch (n.type) {
    case "ping":
      return { ping: true };
    case "push": {
      const repo = await ensureRepo(tx, sys, conn, n.repo);
      let stored = 0;
      for (const c of n.commits.slice(0, 200)) {
        if (!c.sha || !repo) continue;
        const [found] = await liveRows(tx, sys, "dev_commit", eqAll({ repository_id: repo.id, sha: c.sha }), { limit: 1 });
        if (found) continue;
        await createIn(tx, sys, "dev_commit", { sha: c.sha, repository_id: repo.id, message: c.message, author_name: c.author_name, author_email: c.author_email, committed_at: c.at, branch: n.branch, url: c.url, keys: keysOf(c.message, n.branch) }, { trusted: true });
        stored++;
      }
      return { repository: repo?.name ?? null, commits: stored };
    }
    case "pull_request": {
      const repo = await ensureRepo(tx, sys, conn, n.repo);
      if (!repo) return { ignored: "مخزن درخواست ادغام شناخته نشد" };
      const values: Row = {
        title: n.pr.title || `#${n.pr.number}`, pr_number: n.pr.number, repository_id: repo.id, state: n.pr.state, author: n.pr.author, source_branch: n.pr.source, target_branch: n.pr.target,
        opened_at: n.pr.opened_at, merged_at: n.pr.merged_at, url: n.pr.url, keys: keysOf(n.pr.title, n.pr.source),
      };
      const [found] = await liveRows(tx, sys, "dev_pull_request", eqAll({ repository_id: repo.id, pr_number: n.pr.number }), { limit: 1 });
      const row = found ? await updateIn(tx, sys, "dev_pull_request", String(found.id), values, { trusted: true }) : await createIn(tx, sys, "dev_pull_request", values, { trusted: true });
      return { pull_request: row.id, keys: row.keys ?? [] };
    }
    case "build": {
      const repo = await ensureRepo(tx, sys, conn, n.repo);
      const pipe = await ensurePipeline(tx, sys, conn, n.pipeline, repo);
      const b = n.build;
      const start = msOf(b.started_at);
      const end = msOf(b.finished_at);
      const values: Row = {
        run_number: b.run_number || b.external_id, pipeline_id: pipe?.id ?? null, connection_id: conn.id, repository_id: repo?.id ?? null, status: b.status, branch: b.branch, commit_sha: b.sha,
        started_at: b.started_at, finished_at: b.finished_at, duration: start !== null && end !== null && end >= start ? Math.round((end - start) / 1000) : null,
        tests_total: b.tests_total, tests_failed: b.tests_failed, coverage: b.coverage, url: b.url, external_id: b.external_id, keys: keysOf(b.branch),
      };
      const [found] = await liveRows(tx, sys, "dev_build", eqAll({ connection_id: conn.id, external_id: b.external_id }), { limit: 1 });
      const row = found ? await updateIn(tx, sys, "dev_build", String(found.id), values, { trusted: true }) : await createIn(tx, sys, "dev_build", values, { trusted: true });
      return { build: row.id, status: row.status };
    }
    case "deployment":
      return applyDeployment(tx, sys, conn, n.deployment, await ensureRepo(tx, sys, conn, n.repo), n.pipeline, n.actor.email);
    case "flag":
      return applyFlag(tx, sys, conn, n.flag);
    default:
      return { ignored: "رویداد شناخته نشد" };
  }
}

/** A record of `table` named by its number (as the system), or null. */
async function byNumber(tx: Tx, sys: Ctx, table: string, no: string | null | undefined): Promise<Row | null> {
  if (!no) return null;
  const keys = extractKeys(no, numberPrefixes());
  const want = keys[0] ?? no.trim().toUpperCase();
  const [row] = await liveRows(tx, sys, table, { f: "number", op: "eq", v: want }, { limit: 1 });
  return row ?? null;
}

const DEP_STATE: Record<string, string> = { queued: "planned", started: "in_progress", succeeded: "succeeded", failed: "failed", rolled_back: "rolled_back", canceled: "canceled" };

/** Paths through the deployment states a pipeline report may take (as the system, guards included). */
const PATHS: Record<string, Record<string, string[]>> = {
  planned: { in_progress: ["in_progress"], succeeded: ["in_progress", "succeeded"], failed: ["in_progress", "failed"], rolled_back: ["in_progress", "rolled_back"], canceled: ["canceled"] },
  pending_approval: { in_progress: ["in_progress"], succeeded: ["in_progress", "succeeded"], failed: ["in_progress", "failed"], rolled_back: ["in_progress", "rolled_back"], canceled: ["canceled"] },
  in_progress: { succeeded: ["succeeded"], failed: ["failed"], rolled_back: ["rolled_back"], canceled: ["failed"] },
  succeeded: { rolled_back: ["rolled_back"] },
  failed: { in_progress: ["in_progress"], succeeded: ["in_progress", "succeeded"], rolled_back: ["rolled_back"] },
};

async function applyDeployment(tx: Tx, sys: Ctx, conn: Row, d: DeployInfo, repo: Row | null, pipelineName: string | null, actorEmail: string | null): Promise<Row> {
  const envs = await liveRows(tx, sys, "release_environment", null);
  const env = matchEnvironment(d.environment, envs.map((e) => ({ id: String(e.id), key: String(e.key), name: String(e.name), kind: e.kind, aliases: e.aliases, active: e.active })), (conn.env_map ?? {}) as Row);
  if (!env) return { ignored: `محیط «${d.environment}» شناخته نشد؛ آن را در محیط‌ها یا نگاشت نام محیط‌های اتصال تعریف کنید` };
  const pipe = await ensurePipeline(tx, sys, conn, pipelineName, repo);
  const keys = keysOf(d.description, d.release, d.change, ...d.commits.map((c) => c.message));
  const release = (await byNumber(tx, sys, "release", d.release)) ?? (await firstOf(tx, sys, "release", keys, "REL"));
  const change = (await byNumber(tx, sys, "change_request", d.change)) ?? (await firstOf(tx, sys, "change_request", keys, "CHG"));
  let service = isUuid(pipe?.service_id) ? String(pipe!.service_id) : isUuid(repo?.service_id) ? String(repo!.service_id) : isUuid(conn.service_id) ? String(conn.service_id) : null;
  if (d.service) {
    const [named] = await liveRows(tx, sys, "service", { or: [{ f: "name", op: "eq", v: d.service }, { f: "number", op: "eq", v: d.service.toUpperCase() }] }, { limit: 1 }).catch(() => [] as Row[]);
    if (named) service = String(named.id);
  }
  if (!service && release && isUuid(release.service_id)) service = String(release.service_id);
  const firstCommit = d.commits.map((c) => msOf(c.at)).filter((x): x is number => x !== null).sort((a, b) => a - b)[0] ?? null;
  const onBehalf = actorEmail ? (await tx.one<{ id: string }>(`select u.id from sm_users u join sm_org_members m on m.user_id = u.id and m.org_id = $1 and m.is_active and m.deleted_at is null where lower(u.email) = $2 limit 1`, [sys.org.id, actorEmail.toLowerCase()]))?.id ?? null : null;

  const [found] = await liveRows(tx, sys, "deployment", eqAll({ connection_id: conn.id, external_id: d.external_id }), { limit: 1 });
  let dep: Row;
  if (found) {
    const patch: Row = {};
    if (d.version && !found.artifact_version) patch.artifact_version = d.version;
    if (d.sha && !found.commit_sha) patch.commit_sha = d.sha;
    if (change && !found.change_id) patch.change_id = change.id;
    if (release && !found.release_id) patch.release_id = release.id;
    if (firstCommit !== null && !found.first_commit_at) patch.first_commit_at = new Date(firstCommit).toISOString();
    dep = Object.keys(patch).length ? await updateIn(tx, sys, "deployment", String(found.id), patch, { trusted: true }) : found;
  } else {
    dep = await createIn(tx, sys, "deployment", {
      short_description: (d.description ?? "").slice(0, 160) || undefined,
      environment_id: env.id, release_id: release?.id ?? null, change_id: change?.id ?? null, service_id: service,
      artifact_version: d.version, commit_sha: d.sha, approach: "continuous", kind: d.kind ?? "planned",
      pipeline_id: pipe?.id ?? null, connection_id: conn.id, external_id: d.external_id, external_url: d.url,
      initiated_by: String(conn.principal ?? conn.name ?? "").slice(0, 160) || null, on_behalf_of: onBehalf,
      assignment_group_id: conn.assignment_group_id ?? null, planned_start: d.started_at ?? new Date().toISOString(),
      first_commit_at: firstCommit !== null ? new Date(firstCommit).toISOString() : null,
    }, { trusted: true });
  }
  // a production deployment without a change gets the automatic standard change (DevOps change velocity)
  let auto: Row | null = null;
  if (env.kind === "production" && !dep.change_id && conn.auto_change !== false && !["canceled"].includes(DEP_STATE[d.status])) {
    auto = await autoStandardChange(tx, sys, conn, pipe, dep, { service, version: d.version, envName: env.name });
    if (auto.change) dep = await updateIn(tx, sys, "deployment", String(dep.id), { change_id: auto.change.id }, { trusted: true });
    else if (auto.problem) dep = await updateIn(tx, sys, "deployment", String(dep.id), { policy_note: auto.problem }, { trusted: true, keepVersion: true });
  }
  // move the deployment to the reported state
  const target = DEP_STATE[d.status];
  const path = PATHS[String(dep.state)]?.[target] ?? [];
  const note = d.status === "canceled" && dep.state === "in_progress" ? "در ابزار لغو شد" : (d.description ?? `گزارش خط لوله: ${d.status}`);
  for (const to of path) {
    const data: Row = {};
    if (["failed", "rolled_back", "canceled"].includes(to)) data.result_notes = note.slice(0, 2000);
    if (to === "in_progress" && d.started_at) data.actual_start = d.started_at;
    if (["succeeded", "failed", "rolled_back"].includes(to) && d.finished_at) data.actual_end = d.finished_at;
    dep = await transitionIn(tx, sys, "deployment", String(dep.id), to, data, { trusted: true });
  }
  return { deployment: dep.id, number: dep.number, state: dep.state, environment: env.key, change: dep.change_id ?? null, auto_change: auto?.change?.number ?? null, policy: auto?.problem ?? null };
}

async function firstOf(tx: Tx, sys: Ctx, table: string, keys: string[], prefix: string): Promise<Row | null> {
  for (const k of keys.filter((x) => x.startsWith(prefix))) {
    const [row] = await liveRows(tx, sys, table, { f: "number", op: "eq", v: k }, { limit: 1 });
    if (row) return row;
  }
  return null;
}

/**
 * The standard change of a pipeline's production deployment, from the change module's catalogue: the pipeline's
 * template, else the connection's, else the release settings' default — only a published standard template (a
 * suspended one, after failures, sends deployments back to normal changes). Scheduled through the change module's
 * guards (a blackout refuses it: the deployment then carries the reason).
 */
export async function autoStandardChange(tx: Tx, sys: Ctx, conn: Row, pipe: Row | null, dep: Row, o: { service: string | null; version: string | null; envName: string }): Promise<{ change: Row | null; problem: string | null }> {
  const cfg = await releaseConfig(tx, sys);
  const templateId = [pipe?.change_template_id, conn.change_template_id, cfg.default_change_template_id].find(isUuid) ?? null;
  if (!templateId) return { change: null, problem: "الگوی تغییر استاندارد خط لوله تعیین نشده است" };
  const t = await liveRow(tx, sys, "change_template", templateId);
  if (!t || t.kind !== "standard" || t.state !== "published") return { change: null, problem: `تغییر استاندارد «${t?.name ?? ""}» منتشرشده نیست؛ این استقرار تغییر مجاز ندارد` };
  const start = msOf(dep.planned_start) ?? Date.now();
  const max = Number(t.max_duration ?? 0) > 0 ? Number(t.max_duration) * 1000 : 3_600_000;
  const values: Row = {
    template_id: templateId, type: "standard",
    short_description: `استقرار ${o.version ?? ""} در ${o.envName}`.replace(/\s+/g, " ").trim().slice(0, 160),
    description: `تغییر استاندارد خودکار برای استقرار ${dep.number} از اتصال «${conn.name}».`,
    external_ref: `deploy:${dep.external_id ?? dep.id}`.slice(0, 200),
    planned_start: new Date(start).toISOString(), planned_end: new Date(start + Math.min(max, 4 * 3_600_000)).toISOString(),
    ...(o.service ? { service_id: o.service } : {}),
    ...(isUuid(conn.assignment_group_id) ? { assignment_group_id: conn.assignment_group_id } : {}),
  };
  const change = await createIn(tx, sys, "change_request", values, { trusted: true });
  try {
    const scheduled = await savepoint(tx, () => transitionIn(tx, sys, "change_request", String(change.id), "scheduled", {}, { trusted: true }));
    return { change: scheduled, problem: null };
  } catch (e) {
    return { change, problem: `تغییر ${change.number} زمان‌بندی نشد: ${e instanceof Error ? e.message : String(e)}` };
  }
}

async function applyFlag(tx: Tx, sys: Ctx, conn: Row, f: { key: string; state: string; rollout_pct: number | null; service: string | null; environment: string | null }): Promise<Row> {
  const [found] = await liveRows(tx, sys, "feature_flag", eqAll({ key: f.key }), { limit: 1 });
  const envs = f.environment ? await liveRows(tx, sys, "release_environment", null) : [];
  const env = f.environment ? matchEnvironment(f.environment, envs.map((e) => ({ id: String(e.id), key: String(e.key), name: String(e.name), kind: e.kind, aliases: e.aliases, active: e.active })), (conn.env_map ?? {}) as Row) : null;
  const patch: Row = { state: f.state, ...(f.rollout_pct !== null ? { rollout_pct: f.rollout_pct } : {}) };
  if (env) patch.environments = [...new Set([...((found?.environments as string[]) ?? []), env.id])];
  const row = found ? await updateIn(tx, sys, "feature_flag", String(found.id), patch, { trusted: true }) : await createIn(tx, sys, "feature_flag", { key: f.key, name: f.key, service_id: conn.service_id ?? null, ...patch }, { trusted: true });
  return { flag: row.id, state: row.state };
}
