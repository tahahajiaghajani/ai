// Vulnerability response (SEC-014 … SEC-020, SEC-025): scoring of vulnerable items (risk, rating, SSVC, the remediation
// target from first detection, the CI's support group and service), scanner imports (parse → match hosts to CIs →
// one item per asset and vulnerability → reopen what reappears, verify what a covering scan no longer sees), grouping
// into remediation tasks by solution or owner, a change from a remediation group, exceptions applied to and released
// from their items, and scan coverage. Imports run with the caller's right to create items; writes go through the engine.
import { parseScan, vulnKeys, type ScanFinding, type ScannerKind, type ScanFormat } from "@shared/security/scan";
import { ssvc, vulnDueAt, vulnRisk, type VulnRating } from "@shared/security/logic";
import type { ScanImportResult } from "@shared/security/api";
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { addJournalIn, addLinkIn, createIn, defFor, get, transitionIn, updateIn } from "../../engine";
import { access } from "../../access/provider";
import { bad, forbidden } from "../../http/errors";
import { tableDef } from "@shared/tables";
import { servicesImpactedBy } from "../cmdb";
import { countRows, ids, isUuid, liveRow, liveRows, securityConfig, sysOf, type Row } from "./common";

const OPEN = ["open", "in_remediation"];
const num = (v: unknown): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

// a cache of reads per transaction (an import scores hundreds of items against the same vulnerabilities and CIs)
const caches = new WeakMap<object, Map<string, Row | null | string[]>>();
async function cached<T extends Row | null | string[]>(q: object, key: string, load: () => Promise<T>): Promise<T> {
  let m = caches.get(q);
  if (!m) caches.set(q, (m = new Map()));
  if (m.has(key)) return m.get(key) as T;
  const v = await load();
  m.set(key, v);
  return v;
}

/**
 * Score an item in place (risk, rating, SSVC, due date, overdue) from its vulnerability, its CI and the settings;
 * `assign` also fills the support group (the CI's, else the vulnerability management group) and the service.
 */
export async function scoreItem(q: Queryable, ctx: Ctx, n: Row, opts: { assign: boolean }): Promise<void> {
  const sys = sysOf(ctx);
  const cfg = await securityConfig(q, ctx);
  const vuln = isUuid(n.vulnerability_id) ? await cached(q, `v:${n.vulnerability_id}`, () => liveRow(q, sys, "sec_vulnerability", n.vulnerability_id)) : null;
  const ci = isUuid(n.ci_id) ? await cached(q, `c:${n.ci_id}`, () => liveRow(q, sys, "ci", n.ci_id)) : null;
  n.cvss_score = vuln?.cvss_score ?? n.cvss_score ?? null;
  n.epss = vuln?.epss ?? null;
  n.kev = !!vuln?.kev;
  n.asset_criticality = (ci?.criticality as string | null) ?? null;
  if (!n.title && vuln) n.title = vuln.title || vuln.cve_id;
  const r = vulnRisk({ cvss: num(n.cvss_score), epss: num(n.epss), kev: !!n.kev, criticality: n.asset_criticality, exposure: n.exposure ?? null, compensating: n.compensating ?? null });
  n.risk_score = r.score;
  n.risk_rating = r.rating;
  n.risk_factors = r.factors;
  n.ssvc = ssvc({ kev: !!n.kev, exploit: vuln?.exploit_maturity ?? null, exposure: n.exposure ?? null, criticality: n.asset_criticality });
  const days = { critical: cfg.vuln_sla_critical, high: cfg.vuln_sla_high, medium: cfg.vuln_sla_medium, low: cfg.vuln_sla_low };
  n.due_at = vulnDueAt(String(n.first_detected_at ?? new Date().toISOString()), r.rating as VulnRating, days, vuln?.kev ? (vuln.kev_due as string | null) : null);
  n.overdue = OPEN.includes(String(n.state ?? "open")) && Date.parse(String(n.due_at)) < Date.now();
  if (opts.assign) {
    if (!n.assignment_group_id) n.assignment_group_id = (ci?.support_group_id as string | null) ?? cfg.vuln_group_id ?? null;
    if (ci && !n.service_id) {
      const services = await cached(q, `s:${ci.id}`, () => servicesImpactedBy(q, sys, [String(ci.id)], 6).catch(() => [] as string[]));
      n.service_id = services[0] ?? null;
    }
    if (ci && !n.ip_address && ci.ip_address) n.ip_address = ci.ip_address;
  }
}

/** A remediation group's counts and earliest due date from its items. */
export async function recountRemediation(tx: Tx, ctx: Ctx, remId: string): Promise<void> {
  const sys = sysOf(ctx);
  const rem = await liveRow(tx, sys, "sec_vuln_remediation", remId);
  if (!rem) return;
  const items = await liveRows(tx, sys, "sec_vuln_item", { f: "remediation_id", op: "eq", v: remId }, { limit: 10_000 });
  const open = items.filter((i) => OPEN.includes(i.state));
  const due = open.map((i) => i.due_at).filter(Boolean).sort()[0] ?? null;
  const patch: Row = {};
  if (Number(rem.item_count) !== items.length) patch.item_count = items.length;
  if (Number(rem.open_count) !== open.length) patch.open_count = open.length;
  if ((rem.due_at ?? null) !== due && Date.parse(String(rem.due_at)) !== Date.parse(String(due))) patch.due_at = due;
  if (Object.keys(patch).length) await updateIn(tx, sys, "sec_vuln_remediation", remId, patch, { trusted: true, keepVersion: true, allowLocked: true });
}

/** A vulnerability's open items and when it was last seen. */
export async function recountVulnerability(tx: Tx, ctx: Ctx, vulnId: string): Promise<void> {
  const sys = sysOf(ctx);
  const v = await liveRow(tx, sys, "sec_vulnerability", vulnId);
  if (!v) return;
  const open = await countRows(tx, sys, "sec_vuln_item", { and: [{ f: "vulnerability_id", op: "eq", v: vulnId }, { f: "state", op: "in", v: OPEN }] });
  if (Number(v.open_items ?? 0) !== open) await updateIn(tx, sys, "sec_vulnerability", vulnId, { open_items: open }, { trusted: true, keepVersion: true });
}

/** Rescore every item of a vulnerability after its CVSS, EPSS or KEV changed (job `security.rescore`). */
export async function rescoreVulnerability(sys: Ctx, vulnId: string): Promise<number> {
  const items = await liveRows(sys.db, sys, "sec_vuln_item", { and: [{ f: "vulnerability_id", op: "eq", v: vulnId }] }, { limit: 5000 });
  let n = 0;
  for (let i = 0; i < items.length; i += 200) {
    await sys.write(async (tx) => {
      for (const it of items.slice(i, i + 200)) {
        const next = { ...it };
        await scoreItem(tx, sys, next, { assign: false });
        const patch: Row = {};
        for (const f of ["cvss_score", "epss", "kev", "risk_score", "risk_rating", "ssvc", "due_at", "overdue", "risk_factors"]) if (JSON.stringify(next[f]) !== JSON.stringify(it[f])) patch[f] = next[f];
        if (Object.keys(patch).length) {
          await updateIn(tx, sys, "sec_vuln_item", it.id, patch, { trusted: true, keepVersion: true, allowLocked: true });
          n++;
        }
      }
    });
  }
  return n;
}

// ---------------------------------------------------------------------------------------------------------------
// Matching hosts to CIs (identification by FQDN, host name, then IP address; a unique match only)

interface HostKey {
  host: string;
  ip: string | null;
  hostname: string | null;
  fqdn: string | null;
}

export async function matchHosts(q: Queryable, ctx: Ctx, hosts: HostKey[]): Promise<Map<string, Row | null>> {
  const sys = sysOf(ctx);
  const out = new Map<string, Row | null>();
  if (!hosts.length || !tableDef("ci")) return out;
  const vals = (xs: (string | null)[]) => [...new Set(xs.filter(Boolean).flatMap((x) => [x!, x!.toLowerCase(), x!.toUpperCase()]))].slice(0, 500);
  const fqdns = vals(hosts.map((h) => h.fqdn));
  const names = vals(hosts.flatMap((h) => [h.hostname, h.fqdn ? h.fqdn.split(".")[0] : null]));
  const ips = [...new Set(hosts.map((h) => h.ip).filter(Boolean) as string[])].slice(0, 500);
  const or = [
    ...(fqdns.length ? [{ f: "fqdn", op: "in" as const, v: fqdns }] : []),
    ...(names.length ? [{ f: "hostname", op: "in" as const, v: names }] : []),
    ...(ips.length ? [{ f: "ip_address", op: "in" as const, v: ips }] : []),
  ];
  const cis = or.length ? await liveRows(q, sys, "ci", { or }, { limit: 5000 }) : [];
  const low = (v: unknown) => String(v ?? "").toLowerCase();
  for (const h of hosts) {
    const tries: ((c: Row) => boolean)[] = [
      (c) => !!h.fqdn && low(c.fqdn) === low(h.fqdn),
      (c) => !!h.hostname && (low(c.hostname) === low(h.hostname) || low(c.fqdn).split(".")[0] === low(h.hostname)),
      (c) => !!h.ip && String(c.ip_address ?? "").split("/")[0] === h.ip,
    ];
    let hit: Row | null = null;
    for (const t of tries) {
      const m = cis.filter(t);
      if (m.length === 1) {
        hit = m[0];
        break;
      }
      if (m.length > 1) break; // ambiguous: leave it for a person
    }
    out.set(h.host, hit);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Scanner imports

export interface ImportInput {
  name: string;
  content: string;
  scanner?: ScannerKind | null;
  format?: ScanFormat | null;
  /** read and match only; nothing is written */
  dry_run?: boolean;
}

const MAX_FINDINGS = 5000;

interface Candidate {
  key: string;
  vulnKey: string;
  f: ScanFinding;
  ci: Row | null;
}

/** Import a scanner's export (SEC-014, SEC-019): see the module comment. */
export async function importScan(ctx: Ctx, input: ImportInput): Promise<ScanImportResult> {
  const { def } = await defFor(ctx, "sec_vuln_item");
  if (!access().canCreate(ctx, def, null)) throw forbidden("ورود نتیجهٔ پویش با مدیریت آسیب‌پذیری است");
  const text = String(input.content ?? "");
  if (!text.trim()) throw bad("پرونده خالی است");
  const parsed = parseScan(text, { scanner: input.scanner ?? null, format: input.format ?? null });
  if (!parsed.findings.length && parsed.errors.length) throw bad(parsed.errors[0]);
  if (parsed.findings.length > MAX_FINDINGS) throw bad(`هر ورود حداکثر ${MAX_FINDINGS.toLocaleString("fa-IR")} یافته دارد؛ پرونده را چند بخش کنید`);
  const sys = sysOf(ctx);
  const scanner = parsed.scanner;
  const hostKeys = new Map<string, HostKey>();
  for (const f of parsed.findings) if (!hostKeys.has(f.host)) hostKeys.set(f.host, { host: f.host, ip: f.ip, hostname: f.hostname, fqdn: f.fqdn });
  const matched = await matchHosts(ctx.db, ctx, [...hostKeys.values()]);

  // one candidate per (asset, vulnerability): the first finding wins, later ones add their ports to the proof
  const candidates = new Map<string, Candidate>();
  for (const f of parsed.findings) {
    const ci = matched.get(f.host) ?? null;
    for (const vk of vulnKeys(f, scanner)) {
      const asset = ci ? `ci:${ci.id}` : `host:${f.host.toLowerCase()}`;
      const ck = `${asset}|${vk}`;
      const prev = candidates.get(ck);
      if (prev) {
        if (f.port && prev.f.port !== f.port) prev.f = { ...prev.f, proof: `${prev.f.proof ?? ""}\n[${f.port}/${f.protocol ?? ""}] ${f.proof ?? ""}`.trim().slice(0, 2000) };
      } else candidates.set(ck, { key: ck, vulnKey: vk, f, ci });
    }
  }
  const coveredCis = [...new Set([...matched.values()].filter(Boolean).map((c) => String(c!.id)))];
  const unmatchedHosts = [...matched.entries()].filter(([, c]) => !c).map(([h]) => h.toLowerCase());

  const result: ScanImportResult = {
    scanner, format: parsed.format, findings: parsed.findings.length, hosts: hostKeys.size, matched_hosts: coveredCis.length, unmatched_hosts: unmatchedHosts.length,
    items: candidates.size, created: 0, updated: 0, reopened: 0, closed: 0, skipped: parsed.skipped, errors: parsed.errors, import_id: null, dry_run: !!input.dry_run,
  };
  const vulnKeysAll = [...new Set([...candidates.values()].map((c) => c.vulnKey))];
  if (input.dry_run) {
    const existing = await existingItems(ctx.db, sys, [...candidates.values()], vulnKeysAll);
    result.created = [...candidates.keys()].filter((k) => !existing.has(k)).length;
    result.updated = candidates.size - result.created;
    result.reopened = [...existing.values()].filter((r) => ["fixed", "closed"].includes(r.state)).length;
    return result;
  }

  const cfg = await securityConfig(ctx.db, ctx);
  const now = new Date().toISOString();
  return ctx.write(async (tx) => {
    // the import record first: items point at it
    const imp = await createIn(tx, sys, "sec_scan_import", {
      name: String(input.name ?? "scan").slice(0, 200), scanner, format: parsed.format, imported_at: now, imported_by: ctx.actor === "system" ? null : ctx.user.id,
      hosts: hostKeys.size, finding_count: parsed.findings.length, skipped_count: parsed.skipped, unmatched_count: unmatchedHosts.length, covered_cis: coveredCis.slice(0, 2000), errors: parsed.errors.slice(0, 20),
    }, { trusted: true });
    result.import_id = imp.id;

    // the library: one vulnerability per CVE (or scanner check), filled in where it knows nothing yet
    const vulns = new Map<string, Row>();
    for (let i = 0; i < vulnKeysAll.length; i += 400) {
      for (const v of await liveRows(tx, sys, "sec_vulnerability", { f: "cve_id", op: "in", v: vulnKeysAll.slice(i, i + 400) }, { limit: 1000 })) vulns.set(String(v.cve_id), v);
    }
    for (const c of candidates.values()) {
      const have = vulns.get(c.vulnKey);
      if (!have) {
        vulns.set(c.vulnKey, await createIn(tx, sys, "sec_vulnerability", {
          cve_id: c.vulnKey, title: c.f.title, cvss_score: c.f.cvss !== null ? String(c.f.cvss) : null, cvss_vector: c.f.cvss_vector, solution: c.f.solution, description: c.f.description, source: "scanner",
          cvss_version: c.f.cvss_vector?.startsWith("CVSS:4") ? "4.0" : c.f.cvss_vector?.startsWith("CVSS:3.1") ? "3.1" : c.f.cvss_vector?.startsWith("CVSS:3") ? "3.0" : null,
        }, { trusted: true }));
      } else if ((have.cvss_score === null || have.cvss_score === undefined) && c.f.cvss !== null) {
        vulns.set(c.vulnKey, await updateIn(tx, sys, "sec_vulnerability", have.id, { cvss_score: String(c.f.cvss), ...(have.solution ? {} : { solution: c.f.solution }) }, { trusted: true }));
      }
    }

    const existing = await existingItems(tx, sys, [...candidates.values()], vulnKeysAll, vulns);
    const seen = new Set<string>();
    for (const c of candidates.values()) {
      const v = vulns.get(c.vulnKey)!;
      const dedupe = `${c.ci ? `ci:${c.ci.id}` : `host:${c.f.host.toLowerCase()}`}|${v.id}`;
      const it = existing.get(dedupe);
      if (it) {
        seen.add(it.id);
        const patch: Row = { last_seen_at: now, times_seen: Number(it.times_seen ?? 0) + 1, last_scan_id: imp.id, missing_since: null, proof: c.f.proof ?? it.proof ?? null };
        if (!it.port && c.f.port) patch.port = c.f.port;
        await updateIn(tx, sys, "sec_vuln_item", it.id, patch, { trusted: true, keepVersion: true, allowLocked: true });
        if (["fixed", "closed"].includes(it.state)) {
          await transitionIn(tx, sys, "sec_vuln_item", it.id, "open");
          await addJournalIn(tx, sys, tableDef("sec_vuln_item")!, it, { kind: "work_note", body: `در پویش ${imp.number ?? ""} دوباره دیده شد؛ مورد بازگشایی شد و موعد رفع از نخستین کشف ادامه دارد.` }, { trusted: true });
          result.reopened++;
        } else result.updated++;
      } else {
        const row = await createIn(tx, sys, "sec_vuln_item", {
          vulnerability_id: v.id, ci_id: c.ci?.id ?? null, host: c.f.host, ip_address: c.f.ip, port: c.f.port, protocol: c.f.protocol, source: scanner, scanner_ref: c.f.plugin,
          title: c.f.title || v.title || v.cve_id, proof: c.f.proof, first_detected_at: now, last_seen_at: now, times_seen: 1, last_scan_id: imp.id,
          exposure: "internal",
        }, { trusted: true });
        seen.add(row.id);
        result.created++;
      }
    }

    // verification by rescan: what this scanner found before on the covered assets and no longer sees is fixed
    if (cfg.autoclose_missing && (coveredCis.length || unmatchedHosts.length)) {
      const cond = { and: [{ f: "source", op: "eq" as const, v: scanner }, { f: "state", op: "in" as const, v: [...OPEN, "fixed"] }, { or: [...(coveredCis.length ? [{ f: "ci_id", op: "in" as const, v: coveredCis.slice(0, 500) }] : []), ...(unmatchedHosts.length ? [{ and: [{ f: "ci_id", op: "empty" as const }, { f: "host", op: "in" as const, v: unmatchedHosts.slice(0, 500) }] }] : [])] }] };
      for (const it of await liveRows(tx, sys, "sec_vuln_item", cond, { limit: 10_000 })) {
        if (seen.has(it.id)) continue;
        if (it.state === "fixed") await transitionIn(tx, sys, "sec_vuln_item", it.id, "closed");
        else await transitionIn(tx, sys, "sec_vuln_item", it.id, "fixed", { close_notes: `در پویش ${imp.number ?? ""} دیگر دیده نشد` });
        await updateIn(tx, sys, "sec_vuln_item", it.id, { missing_since: now, last_scan_id: imp.id }, { trusted: true, keepVersion: true, allowLocked: true });
        result.closed++;
      }
    }
    await updateIn(tx, sys, "sec_scan_import", imp.id, { created_count: result.created, updated_count: result.updated, reopened_count: result.reopened, closed_count: result.closed }, { trusted: true });
    return result;
  });
}

async function existingItems(q: Queryable, sys: Ctx, cands: Candidate[], vulnKeysAll: string[], known?: Map<string, Row>): Promise<Map<string, Row>> {
  const vulns = known ?? new Map<string, Row>();
  if (!known) for (let i = 0; i < vulnKeysAll.length; i += 400) for (const v of await liveRows(q, sys, "sec_vulnerability", { f: "cve_id", op: "in", v: vulnKeysAll.slice(i, i + 400) }, { limit: 1000 })) vulns.set(String(v.cve_id), v);
  const keys: string[] = [];
  const byKey = new Map<string, string>();
  for (const c of cands) {
    const v = vulns.get(c.vulnKey);
    if (!v) continue;
    const k = `${c.ci ? `ci:${c.ci.id}` : `host:${c.f.host.toLowerCase()}`}|${v.id}`;
    keys.push(k);
    byKey.set(k, c.key);
  }
  const out = new Map<string, Row>();
  for (let i = 0; i < keys.length; i += 400) {
    for (const r of await liveRows(q, sys, "sec_vuln_item", { f: "dedupe_key", op: "in", v: keys.slice(i, i + 400) }, { limit: 1000 })) out.set(known ? String(r.dedupe_key) : (byKey.get(String(r.dedupe_key)) ?? String(r.dedupe_key)), r);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Remediation grouping and changes (SEC-017, SEC-019)

/** Put open items without a remediation group into groups by solution (vulnerability × support group) or by owner. */
export async function groupRemediations(ctx: Ctx, basis: "solution" | "owner" = "solution", itemIds?: string[]): Promise<{ groups: number; items: number }> {
  const { def } = await defFor(ctx, "sec_vuln_remediation");
  if (!access().canCreate(ctx, def, null)) throw forbidden("ساخت گروه رفع با مدیریت آسیب‌پذیری است");
  const cond = { and: [{ f: "state", op: "in" as const, v: OPEN }, { f: "remediation_id", op: "empty" as const }, ...(itemIds?.length ? [{ f: "id", op: "in" as const, v: itemIds.slice(0, 500) }] : [])] };
  const items = await liveRows(ctx.db, ctx, "sec_vuln_item", cond, { order: "t.risk_score desc nulls last", limit: 2000 });
  const groups = new Map<string, Row[]>();
  for (const it of items) {
    const k = basis === "owner" ? `${it.assignment_group_id ?? "none"}` : `${it.vulnerability_id}|${it.assignment_group_id ?? "none"}`;
    groups.set(k, [...(groups.get(k) ?? []), it]);
  }
  const sys = sysOf(ctx, ctx.actor === "system" ? null : ctx.user.id);
  let made = 0;
  await ctx.write(async (tx) => {
    for (const rows of groups.values()) {
      const first = rows[0];
      const v = basis === "solution" ? await liveRow(tx, sysOf(ctx), "sec_vulnerability", first.vulnerability_id) : null;
      const title = basis === "solution" ? `رفع ${v?.cve_id ?? "آسیب‌پذیری"} روی ${rows.length.toLocaleString("fa-IR")} دارایی` : `رفع ${rows.length.toLocaleString("fa-IR")} آسیب‌پذیری گروه`;
      const rem = await createIn(tx, ctx, "sec_vuln_remediation", { title: title.slice(0, 300), vulnerability_id: basis === "solution" ? first.vulnerability_id : null, basis, assignment_group_id: first.assignment_group_id ?? null, solution: v?.solution ?? null });
      for (const it of rows) await updateIn(tx, sys, "sec_vuln_item", it.id, { remediation_id: rem.id }, { trusted: true, keepVersion: true });
      made++;
    }
  });
  return { groups: made, items: items.length };
}

/** A change request to remediate a group (the caller's own change: needs create in change), linked both ways. */
export async function remediationChange(ctx: Ctx, remId: string): Promise<{ change_id: string; number: string | null }> {
  const rem = (await get(ctx, "sec_vuln_remediation", remId)).row as Row;
  if (rem.change_id) throw bad("برای این گروه رفع پیش‌تر تغییر ساخته شده است");
  const { def: chg } = await defFor(ctx, "change_request");
  if (!access().canCreate(ctx, chg, null)) throw forbidden("ثبت تغییر برای شما مجاز نیست");
  const items = await liveRows(ctx.db, ctx, "sec_vuln_item", { and: [{ f: "remediation_id", op: "eq", v: remId }, { f: "state", op: "in", v: OPEN }] }, { limit: 500 });
  const cis = [...new Set(items.map((i) => i.ci_id).filter(isUuid))];
  const sys = sysOf(ctx, ctx.actor === "system" ? null : ctx.user.id);
  return ctx.write(async (tx) => {
    const change = await createIn(tx, ctx, "change_request", {
      short_description: `رفع آسیب‌پذیری: ${String(rem.title).slice(0, 170)}`,
      type: "normal",
      description: `${rem.solution ? `${rem.solution}\n\n` : ""}موردهای آسیب‌پذیر: ${items.map((i) => i.number).filter(Boolean).slice(0, 50).join("، ")}`.slice(0, 50_000),
      justification: "رفع آسیب‌پذیری‌های امنیتی در موعد مصوب (گروه رفع " + (rem.number ?? "") + ")",
      ci_id: cis[0] ?? null,
      affected_cis: cis.slice(0, 200),
      assignment_group_id: rem.assignment_group_id ?? null,
    });
    await addLinkIn(tx, ctx, "change_request", change.id, { kind: "fixes", table: "sec_vuln_remediation", id: remId });
    await updateIn(tx, sys, "sec_vuln_remediation", remId, { change_id: change.id }, { trusted: true });
    for (const it of items) await updateIn(tx, sys, "sec_vuln_item", it.id, { change_id: change.id }, { trusted: true, keepVersion: true });
    if (rem.state === "open") await transitionIn(tx, sys, "sec_vuln_remediation", remId, "in_progress");
    return { change_id: change.id, number: (change.number as string) ?? null };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Exceptions (SEC-020)

const TARGET: Record<string, string> = { deferral: "deferred", risk_acceptance: "exception", not_affected: "exception", false_positive: "false_positive" };

/** An approved exception moves its open items out of the queue (deferred, exception or false positive). */
export async function applyException(tx: Tx, ctx: Ctx, exc: Row): Promise<number> {
  const sys = sysOf(ctx);
  const cond = ids(exc.items).length ? { f: "id", op: "in" as const, v: ids(exc.items).slice(0, 500) } : { f: "vulnerability_id", op: "eq" as const, v: exc.vulnerability_id };
  const items = await liveRows(tx, sys, "sec_vuln_item", { and: [cond, { f: "state", op: "in", v: OPEN }] }, { limit: 500 });
  const to = TARGET[String(exc.kind)] ?? "exception";
  for (const it of items) {
    await updateIn(tx, sys, "sec_vuln_item", it.id, { exception_id: exc.id, ...(exc.kind === "not_affected" ? { vex_status: "not_affected", vex_justification: exc.vex_justification ?? null } : {}) }, { trusted: true, keepVersion: true });
    await transitionIn(tx, sys, "sec_vuln_item", it.id, to, to === "false_positive" ? { close_notes: `استثنای ${exc.number ?? ""}: ${String(exc.justification ?? "").slice(0, 500)}` } : {});
  }
  return items.length;
}

/** An expired or revoked exception returns its deferred and excepted items to the queue (their clock never stopped). */
export async function releaseException(tx: Tx, ctx: Ctx, exc: Row): Promise<number> {
  const sys = sysOf(ctx);
  const items = await liveRows(tx, sys, "sec_vuln_item", { and: [{ f: "exception_id", op: "eq", v: exc.id }, { f: "state", op: "in", v: ["deferred", "exception"] }] }, { limit: 500 });
  for (const it of items) {
    await transitionIn(tx, sys, "sec_vuln_item", it.id, "open");
    await addJournalIn(tx, sys, tableDef("sec_vuln_item")!, it, { kind: "work_note", body: `استثنای ${exc.number ?? ""} ${exc.state === "expired" ? "منقضی" : "ابطال"} شد؛ مورد به صف رفع برگشت.` }, { trusted: true });
  }
  return items.length;
}

// ---------------------------------------------------------------------------------------------------------------
// Coverage (SEC-025)

/** In-scope CIs (with an IP address, not retired) and how many a scan covered in the last 7 and 30 days. */
export async function scanCoverage(q: Queryable, ctx: Ctx): Promise<{ in_scope: number; scanned_7: number; scanned_30: number; unscanned: { id: string; number: string | null; name: string }[] }> {
  const sys = sysOf(ctx);
  if (!tableDef("ci")) return { in_scope: 0, scanned_7: 0, scanned_30: 0, unscanned: [] };
  const cis = await liveRows(q, sys, "ci", { and: [{ f: "ip_address", op: "nempty" }, { f: "operational_status", op: "ne", v: "retired" }] }, { limit: 20_000 });
  const since = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  const imports30 = await liveRows(q, sys, "sec_scan_import", { f: "imported_at", op: "gte", v: since(30) }, { limit: 1000 });
  const in7 = new Set<string>();
  const in30 = new Set<string>();
  const s7 = Date.parse(since(7));
  for (const imp of imports30) for (const id of ids(imp.covered_cis)) {
    in30.add(id);
    if (Date.parse(String(imp.imported_at)) >= s7) in7.add(id);
  }
  const scope = cis.map((c) => String(c.id));
  return {
    in_scope: scope.length,
    scanned_7: scope.filter((id) => in7.has(id)).length,
    scanned_30: scope.filter((id) => in30.has(id)).length,
    unscanned: cis.filter((c) => !in30.has(String(c.id))).slice(0, 50).map((c) => ({ id: c.id, number: c.number ?? null, name: c.name })),
  };
}
