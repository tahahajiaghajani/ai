// The deployment gate (DEV-008/009/010): a pipeline asks «may I deploy this to that environment?» before it does —
// POST /api/public/devops/gates/:key (signed like the webhooks) — and polls the answer. The policy, in order:
//   1. an unknown or inactive environment → rejected
//   2. an environment without protection (development, test) → approved
//   3. a blocking freeze, blackout or release freeze now (change and release windows) → rejected (people may still
//      approve it «با استثنا» with a reason)
//   4. a change named by the pipeline that is authorized (scheduled or implementing) → approved; one that is not → pending
//   5. production without a change: the connection's automatic standard change (from the change module's catalogue)
//      → approved once it is scheduled
//   6. otherwise pending: the seeded approval rule asks the release managers; their decision (or a person's
//      transition) decides the gate, and the sweep times out gates nobody answered
// Every gate keeps its evidence (environment, change and its state, windows, the rule that decided) with a SHA-256
// hash chained to the organisation's previous gate (`prev_hash`), so a later edit of the trail shows. Appending to the
// chain is serial: a gate is opened under the organisation's chain key (writes of one organisation otherwise run side
// by side), so it reads the last committed link and a retried run's earlier gate; the chain's order is the gates'
// record numbers, given out in that same turn (`created_at` is when a transaction began, not when it joined the chain).
import type { ServerConfig, Ctx } from "../../context";
import { lockKey, type Tx } from "../../db";
import { actorId, createIn, emitEvent, savepoint, transitionIn, updateIn, type WriteArgs } from "../../engine";
import { forbidden } from "../../http/errors";
import { onApprovalSettled, settledVerdict } from "../sla";
import { occurrencesBetween } from "../change";
import { freezesFor } from "../release/checks";
import { matchEnvironment } from "@shared/devops/logic";
import { authenticate, autoStandardChange, byNumber, namedProblem, openConnection } from "./ingest";
import { eqAll, isUuid, liveRow, liveRows, managesReleases, msOf, sha256, type Row } from "./common";
import type { HeaderFn } from "@shared/devops/logic";

export interface GateRequest {
  environment: string;
  service?: string | null;
  version?: string | null;
  commit?: string | null;
  run?: string | null;
  change?: string | null;
  pipeline?: string | null;
  summary?: string | null;
}

const AUTHORIZED = ["scheduled", "implement"];

/** Canonical JSON (sorted keys) of the evidence, for its hash. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as Row).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Row)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}

/** The hash of a gate's evidence chained to the previous gate's. */
export const evidenceHash = (prev: string | null, evidence: unknown): string => sha256(`${prev ?? ""}\n${canonical(evidence)}`);

/** Does the stored chain of the organisation's gates hold (each hash recomputed from its evidence and predecessor)? */
export async function verifyChain(sys: Ctx): Promise<{ ok: boolean; checked: number; broken: string | null }> {
  const gates = await liveRows(sys.db, sys, "change_gate", null, { order: "t.no, t.id", limit: 10_000 });
  let prev: string | null = null;
  for (const g of gates) {
    if (g.prev_hash !== prev || evidenceHash(prev, g.evidence ?? {}) !== g.evidence_hash) return { ok: false, checked: gates.length, broken: String(g.number ?? g.id) };
    prev = String(g.evidence_hash);
  }
  return { ok: true, checked: gates.length, broken: null };
}

/** The chain's last link (read under the chain key: every gate before it has committed). */
async function lastHash(tx: Tx, sys: Ctx): Promise<string | null> {
  const [last] = await liveRows(tx, sys, "change_gate", null, { order: "t.no desc, t.id desc", limit: 1 });
  return last ? String(last.evidence_hash ?? "") || null : null;
}

/** Ask the gate (the pipeline's signed request). */
export async function requestGate(cfg: ServerConfig, key: string, h: HeaderFn, raw: string, input: GateRequest): Promise<Row> {
  const { sys, conn, secret } = await openConnection(cfg, key);
  authenticate(secret, raw, h);
  return sys.write((tx) => openGateIn(tx, sys, conn, input));
}

/** Open and decide (when the policy can) a gate as the system. */
export async function openGateIn(tx: Tx, sys: Ctx, conn: Row, input: GateRequest): Promise<Row> {
  // the organisation's chain key first: two gates opened at once append one after the other (never two links naming
  // the same predecessor), and a run asked twice at once finds its first gate
  await lockKey(tx, `devops.gate_chain:${sys.org.id}`);
  const now = Date.now();
  const envs = await liveRows(tx, sys, "release_environment", null);
  const env = matchEnvironment(String(input.environment ?? ""), envs.map((e) => ({ id: String(e.id), key: String(e.key), name: String(e.name), kind: e.kind, aliases: e.aliases, active: e.active })), (conn.env_map ?? {}) as Row);
  const envRow = env ? envs.find((e) => e.id === env.id) ?? null : null;
  const pipe = input.pipeline ? (await liveRows(tx, sys, "dev_pipeline", eqAll({ connection_id: conn.id, name: String(input.pipeline).slice(0, 200) }), { limit: 1 }))[0] ?? null : null;
  const service = isUuid(pipe?.service_id) ? String(pipe!.service_id) : isUuid(conn.service_id) ? String(conn.service_id) : null;
  const run = input.run ? String(input.run).slice(0, 200) : null;
  // a retried request of the same run and environment is the same gate: an open or passed one answers again; after a
  // refusal or a timeout it is asked again, with the change already made for that run
  const [earlier] = run && envRow ? await liveRows(tx, sys, "change_gate", eqAll({ connection_id: conn.id, run_ref: run, environment_id: envRow.id }), { order: "t.created_at desc, t.id desc", limit: 1 }) : [];
  if (earlier && ["pending", "approved", "overridden"].includes(String(earlier.state))) {
    const c = isUuid(earlier.change_id) ? await liveRow(tx, sys, "change_request", earlier.change_id) : null;
    return { ...earlier, change_number: c?.number ?? null };
  }
  const earlierChange = earlier && isUuid(earlier.change_id) ? await liveRow(tx, sys, "change_request", earlier.change_id) : null;
  // a named change is found as the webhooks find it («CHG-12», «chg12», «CHG0000012»); unknown, unauthorized or another
  // service's or group's change never falls back to an automatic one: the release managers decide
  const scope = { service, group: isUuid(conn.assignment_group_id) ? String(conn.assignment_group_id) : null };
  let change = input.change ? await byNumber(tx, sys, "change_request", String(input.change)) : null;
  const windows: string[] = [];
  if (envRow && envRow.protection !== "open") {
    try {
      for (const o of await occurrencesBetween(tx, sys, now, now + 1)) if ((o.kind === "freeze" || o.kind === "blackout") && o.enforcement !== "warn") windows.push(o.name);
    } catch {
      // no change module
    }
    for (const f of await freezesFor(tx, sys, { type: "minor", planned_start: new Date(now).toISOString(), planned_end: new Date(now + 1).toISOString() })) windows.push(f.name);
  }
  let state = "pending";
  let rule = "";
  let reason: string | null = null;
  if (!env || !envRow) {
    state = "rejected";
    rule = "محیط ناشناخته";
    reason = `محیط «${input.environment}» شناخته نشد`;
  } else if (envRow.protection === "open") {
    state = "approved";
    rule = "محیط بدون حفاظت";
  } else if (windows.length) {
    state = "rejected";
    rule = "دورهٔ انجماد یا ممنوعیت";
    reason = `اکنون «${[...new Set(windows)].join("، ")}» برقرار است`;
  } else if (input.change) {
    const problem = change ? namedProblem("change_request", change, scope) : `تغییر «${input.change}» پیدا نشد`;
    if (!problem) {
      state = "approved";
      rule = "تغییر مجاز";
    } else {
      rule = change && !AUTHORIZED.includes(String(change.state)) ? "تغییر هنوز مجاز نشده" : "تأیید مدیر انتشار";
      reason = problem;
    }
  } else if (envRow.kind === "production" && earlierChange && !["closed", "canceled"].includes(String(earlierChange.state))) {
    // the change this run's earlier gate made: never a second automatic change for the same run
    change = earlierChange;
    const problem = namedProblem("change_request", change, scope);
    if (!problem) {
      state = "approved";
      rule = "تغییر استاندارد خودکار";
    } else {
      rule = "تأیید مدیر انتشار";
      reason = problem;
    }
  } else if (envRow.kind === "production" && conn.auto_change !== false) {
    const probe: Row = { id: null, number: "—", external_id: `gate:${run ?? now}`, planned_start: new Date(now).toISOString() };
    const auto = await autoStandardChange(tx, sys, conn, pipe, probe, { service, version: input.version ?? null, envName: String(envRow.name) });
    if (auto.change && AUTHORIZED.includes(String(auto.change.state))) {
      change = auto.change;
      state = "approved";
      rule = "تغییر استاندارد خودکار";
    } else {
      change = auto.change;
      rule = "تأیید مدیر انتشار";
      reason = auto.problem;
    }
  } else {
    rule = "تأیید مدیر انتشار";
  }
  const evidence: Row = {
    environment: envRow ? { key: envRow.key, kind: envRow.kind, protection: envRow.protection } : { name: input.environment },
    change: change ? { number: change.number, state: change.state, type: change.type ?? null } : null,
    windows: [...new Set(windows)],
    version: input.version ?? null, commit: input.commit ?? null, run: input.run ?? null, pipeline: input.pipeline ?? null,
    connection: conn.name, rule, decided: state === "pending" ? null : state, at: new Date(now).toISOString(),
  };
  const prev = await lastHash(tx, sys);
  const timeoutMinutes = Number(conn.gate_timeout_minutes ?? 60) || 60;
  let gate = await createIn(tx, sys, "change_gate", {
    summary: (input.summary ?? `استقرار ${input.version ?? ""} در ${envRow?.name ?? input.environment}`).replace(/\s+/g, " ").trim().slice(0, 300),
    connection_id: conn.id, pipeline_id: pipe?.id ?? null, environment_id: envRow?.id ?? null, service_id: service,
    run_ref: run, artifact_version: input.version ?? null, commit_sha: input.commit ?? null, change_id: change?.id ?? null,
    rule, reason, requested_at: new Date(now).toISOString(), timeout_at: new Date(now + timeoutMinutes * 60_000).toISOString(),
    evidence, prev_hash: prev, evidence_hash: evidenceHash(prev, evidence),
  }, { trusted: true });
  if (state !== "pending") gate = await transitionIn(tx, sys, "change_gate", String(gate.id), state, state === "rejected" ? { reason: reason ?? rule } : {}, { trusted: true });
  else await emitEvent(tx, sys, { kind: "record.change_gate.pending", table: "change_gate", id: String(gate.id), number: gate.number ?? null, data: { users: [], environment: envRow?.key ?? null } });
  return { ...gate, change_number: change?.number ?? null };
}

/** What the pipeline reads back (signed with the gate's id as the body). */
export async function gateStatus(cfg: ServerConfig, key: string, h: HeaderFn, id: string): Promise<Row> {
  const { sys, conn, secret } = await openConnection(cfg, key);
  authenticate(secret, id, h);
  const gate = await liveRow(sys.db, sys, "change_gate", id);
  if (!gate || gate.connection_id !== conn.id) throw forbidden("این دروازه از این اتصال نیست");
  const change = isUuid(gate.change_id) ? await liveRow(sys.db, sys, "change_request", gate.change_id) : null;
  // `change` is the number the pipeline passes on with its deployment (`change`), so the deployment takes this change
  return { id: gate.id, number: gate.number, state: gate.state, allowed: ["approved", "overridden"].includes(String(gate.state)), reason: gate.reason ?? null, rule: gate.rule ?? null, change: change?.number ?? null, change_id: gate.change_id ?? null, decided_at: gate.decided_at ?? null, timeout_at: gate.timeout_at ?? null };
}

/** Hooks of the gate: a person's decision is the release manager's; who and when are stamped. */
export async function gateBefore(w: WriteArgs): Promise<void> {
  if (w.op === "create" && !w.trusted && w.ctx.actor !== "system") throw forbidden("دروازهٔ استقرار را خط لوله باز می‌کند");
  if (w.op !== "transition" || !w.transition) return;
  if (!w.trusted && w.ctx.actor !== "system" && !(await managesReleases(w.tx, w.ctx))) throw forbidden("تصمیم دروازهٔ استقرار با مدیر انتشار است");
  const now = Date.now();
  w.next.decided_at = new Date(now).toISOString();
  w.next.decided_by = actorId(w.ctx);
  const req = msOf(w.next.requested_at);
  if (req !== null) w.next.wait_seconds = Math.max(0, Math.round((now - req) / 1000));
}

/** Gates nobody answered in time (the sweep). */
export async function timeoutGates(sys: Ctx, now = Date.now()): Promise<number> {
  const open = await liveRows(sys.db, sys, "change_gate", { f: "state", op: "eq", v: "pending" }, { limit: 500 });
  let n = 0;
  for (const g of open) {
    if ((msOf(g.timeout_at) ?? Infinity) > now) continue;
    await sys.write((tx) => savepoint(tx, () => transitionIn(tx, sys, "change_gate", String(g.id), "timed_out", { reason: "پاسخی در مهلت داده نشد" }, { trusted: true }))).then(() => n++, () => undefined);
  }
  return n;
}

/** A settled approval round of a pending gate decides it. */
export function installGateApprovals(): (() => void)[] {
  return [
    onApprovalSettled("change_gate", async (s) => {
      const { tx, ctx, record, by } = s;
      // the gate's approvals as a whole: `replanned` is read from the aggregate, a withdrawal leaves it pending
      const verdict = settledVerdict(s);
      if (record.state !== "pending" || !verdict) return;
      const to = verdict;
      await transitionIn(tx, ctx, "change_gate", String(record.id), to, to === "rejected" ? { reason: "تأییدکنندگان استقرار را رد کردند" } : {}, { trusted: true });
      await updateIn(tx, ctx, "change_gate", String(record.id), { decided_by: by }, { trusted: true, keepVersion: true, allowLocked: true });
    }),
  ];
}
