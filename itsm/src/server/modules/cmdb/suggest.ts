// Relationship suggestions (catalogue CMDB-041, the rule-based half; the AI layer adds its own through
// `registerCmdbAi`): CIs that keep turning up together on the same incidents — the incident's CI and its affected CIs,
// or two affected CIs — without any relationship between them are proposed as «وابسته به», the CI closer to the
// services depending on the other. A suggestion carries its evidence (how many incidents, which ones); the CI owner
// accepts it (the relationship is created with their access) or rejects it, and a rejected pair is never proposed again.
// Rule-based relationships (CMDB-007) live here too: equal attribute values create «اجرا روی» and friends, and end them
// when the values no longer match.
import { familyLayer, relLabel } from "@shared/cmdb/logic";
import type { Ctx } from "../../context";
import { pgArray } from "../../db";
import type { Tx } from "../../db";
import { conflict, forbidden, notFound } from "../../http/errors";
import { condEnv, createIn, orgSchema, readable, savepoint, transitionIn, updateIn } from "../../engine";
import { access } from "../../access/provider";
import { tableDef } from "@shared/tables";
import { classTree, cmdbConfig, ciColumnSql, eqAll, isUuid, liveRow, liveRows, relTypes, sysOf, type Row } from "./common";
import { edgesAround } from "./graph";

const pairKey = (a: string, b: string) => [a, b].sort().join("|");

/** Propose relationships from incident co-occurrence over the last `days` (system; idempotent). */
export async function suggestFromIncidents(tx: Tx, ctx: Ctx, days = 90): Promise<{ proposed: number; pairs: number }> {
  if (!tableDef("incident")) return { proposed: 0, pairs: 0 };
  const sys = sysOf(ctx);
  const cfg = await cmdbConfig(tx, ctx);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const incidents = await liveRows(tx, sys, "incident", { f: "opened_at", op: "gte", v: since }, { order: "t.opened_at desc", limit: 5000 });
  const counts = new Map<string, { a: string; b: string; n: number; incidents: string[] }>();
  for (const inc of incidents) {
    const cis = [...new Set([inc.ci_id, ...(inc.affected_cis ?? [])].filter(isUuid))].slice(0, 12);
    for (let i = 0; i < cis.length; i++)
      for (let j = i + 1; j < cis.length; j++) {
        const k = pairKey(cis[i], cis[j]);
        const e = counts.get(k) ?? { a: cis[i], b: cis[j], n: 0, incidents: [] };
        e.n++;
        if (e.incidents.length < 10) e.incidents.push(inc.number ?? inc.id);
        counts.set(k, e);
      }
  }
  const strong = [...counts.values()].filter((p) => p.n >= cfg.suggest_min_support);
  if (!strong.length) return { proposed: 0, pairs: 0 };
  const ids = [...new Set(strong.flatMap((p) => [p.a, p.b]))];
  const cis = new Map((await liveRows(tx, sys, "ci", { f: "id", op: "in", v: ids.slice(0, 5000) })).map((r) => [r.id, r]));
  const related = new Set((await edgesAround(tx, ctx, ids, { includeHidden: true })).map((e) => pairKey(e.parent_id, e.child_id)));
  const known = new Set((await liveRows(tx, sys, "ci_rel_suggestion", { f: "pair_key", op: "in", v: strong.map((p) => pairKey(p.a, p.b)) })).map((s) => String(s.pair_key)));
  const tree = await classTree(tx, ctx);
  const types = await relTypes(tx, ctx);
  let proposed = 0;
  for (const p of strong.sort((x, y) => y.n - x.n).slice(0, 200)) {
    const k = pairKey(p.a, p.b);
    if (related.has(k) || known.has(k)) continue;
    const a = cis.get(p.a);
    const b = cis.get(p.b);
    if (!a || !b) continue;
    // the CI nearer to the services (a lower layer) depends on the other
    const [parent, child] = familyLayer(tree.family(a.class)) <= familyLayer(tree.family(b.class)) ? [a, b] : [b, a];
    await createIn(tx, sys, "ci_rel_suggestion", {
      parent_id: parent.id, child_id: child.id, type: "depends_on", method: "cooccurrence", score: Math.min(100, p.n * 15),
      evidence: { incidents: p.incidents, count: p.n, days }, pair_key: k, label: relLabel(parent.name, types.get("depends_on"), child.name, "depends_on"),
    }, { trusted: true });
    proposed++;
  }
  return { proposed, pairs: strong.length };
}

/** Accept a suggestion: the relationship is created with the caller's access (they must be able to change a CI). */
export async function acceptSuggestion(ctx: Ctx, id: string, type?: string | null): Promise<Row> {
  return ctx.write(async (tx) => {
    const s = await liveRow(tx, ctx, "ci_rel_suggestion", id);
    if (!s) throw notFound("پیشنهاد پیدا نشد");
    if (s.state !== "proposed") throw conflict("دربارهٔ این پیشنهاد پیش‌تر تصمیم گرفته شده است");
    const rel = await createIn(tx, ctx, "ci_rel", { parent_id: s.parent_id, child_id: s.child_id, type: type || s.type, origin_kind: s.method === "ai" ? "ai" : "rule", note: `پذیرش پیشنهاد (${s.evidence?.count ?? "?"} رخداد مشترک)` });
    await updateIn(tx, sysOf(ctx), "ci_rel_suggestion", id, { rel_id: rel.id, decided_by: ctx.actor === "system" ? null : ctx.user.id }, { trusted: true });
    return transitionIn(tx, sysOf(ctx), "ci_rel_suggestion", id, "accepted", {}, { trusted: true });
  });
}

/** Reject a suggestion (the pair is not proposed again). */
export async function rejectSuggestion(ctx: Ctx, id: string): Promise<Row> {
  return ctx.write(async (tx) => {
    const s = await liveRow(tx, ctx, "ci_rel_suggestion", id);
    if (!s) throw notFound("پیشنهاد پیدا نشد");
    if (s.state !== "proposed") throw conflict("دربارهٔ این پیشنهاد پیش‌تر تصمیم گرفته شده است");
    const schema = await orgSchema(ctx, tx);
    const def = schema.def("ci") ?? tableDef("ci")!;
    const parent = await liveRow(tx, sysOf(ctx), "ci", s.parent_id);
    const child = await liveRow(tx, sysOf(ctx), "ci", s.child_id);
    if (ctx.actor !== "system" && !((parent && access().canWrite(ctx, def, parent)) || (child && access().canWrite(ctx, def, child)))) throw forbidden("تصمیم دربارهٔ این پیشنهاد با مالک پیکربندی است");
    await updateIn(tx, sysOf(ctx), "ci_rel_suggestion", id, { decided_by: ctx.actor === "system" ? null : ctx.user.id }, { trusted: true });
    return transitionIn(tx, sysOf(ctx), "ci_rel_suggestion", id, "rejected", {}, { trusted: true });
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Rule-based relationships (CMDB-007)

/**
 * Apply the active relationship rules to CIs (`ids`, or every CI of the rules' classes when omitted, bounded): a CI of
 * the source class whose attribute equals a target CI's attribute gets the rule's relationship (origin «قاعده»); with
 * «ساختن و پایان دادن», rule relationships whose values no longer match are ended.
 */
export async function applyRelRules(tx: Tx, ctx: Ctx, ids?: string[]): Promise<{ created: number; ended: number }> {
  const sys = sysOf(ctx);
  const rules = await liveRows(tx, sys, "ci_rel_rule", { f: "active", op: "eq", v: true });
  if (!rules.length) return { created: 0, ended: 0 };
  const tree = await classTree(tx, ctx);
  const types = await relTypes(tx, ctx);
  let created = 0;
  let ended = 0;
  const at = new Date().toISOString();
  for (const rule of rules) {
    const srcClasses = tree.descendants(rule.source_class);
    const dstClasses = tree.descendants(rule.target_class);
    const t = types.get(rule.type);
    if (!t) continue;
    // candidate pairs: one query joining both sides on the attribute values (system rights through the access rule)
    const schema = await orgSchema(sys, tx);
    const def = schema.def("ci") ?? tableDef("ci")!;
    const env = await condEnv(sys);
    const params: unknown[] = [];
    const rs = readable(sys, def, "s", params, env);
    const rd = readable(sys, def, "d", params, env);
    params.push(pgArray(srcClasses));
    const sc = params.length;
    params.push(pgArray(dstClasses));
    const dc = params.length;
    const sCol = ciColumnSql("s", String(rule.source_attr), params);
    const dCol = ciColumnSql("d", String(rule.target_attr), params);
    let extra = "";
    if (ids?.length) {
      params.push(pgArray(ids));
      extra = ` and (s.id = any($${params.length}::uuid[]) or d.id = any($${params.length}::uuid[]))`;
    }
    const pairs = await tx.query<{ s: string; d: string; sn: string; dn: string }>(
      `select s.id as s, d.id as d, s.name as sn, d.name as dn from ${def.table} s join ${def.table} d on d.org_id = s.org_id and d.id <> s.id
        where ${rs} and ${rd} and s.class = any($${sc}::text[]) and d.class = any($${dc}::text[])
          and s.merged_into is null and d.merged_into is null and coalesce(${sCol}, '') <> '' and lower(${sCol}) = lower(${dCol})${extra} limit 5000`,
      params,
    );
    const want = new Set(pairs.map((p) => `${p.s}|${p.d}`));
    for (const p of pairs) {
      const [existing] = await liveRows(tx, sys, "ci_rel", { and: [{ f: "parent_id", op: "eq", v: p.s }, { f: "child_id", op: "eq", v: p.d }, { f: "type", op: "eq", v: rule.type }, { f: "valid_to", op: "empty" }] }, { limit: 1 });
      if (existing) continue;
      const ok = await savepoint(tx, () => createIn(tx, sys, "ci_rel", { parent_id: p.s, child_id: p.d, type: rule.type, origin_kind: "rule", note: `قاعدهٔ «${rule.name}»` }, { trusted: true })).then(() => true).catch(() => false);
      if (ok) created++;
    }
    if (rule.mode === "create_and_retire") {
      const cond = ids?.length ? { and: [{ f: "origin_kind", op: "eq" as const, v: "rule" }, { f: "type", op: "eq" as const, v: rule.type }, { f: "valid_to", op: "empty" as const }, { or: [{ f: "parent_id", op: "in" as const, v: ids }, { f: "child_id", op: "in" as const, v: ids }] }] } : { and: [{ f: "origin_kind", op: "eq" as const, v: "rule" }, { f: "type", op: "eq" as const, v: rule.type }, { f: "valid_to", op: "empty" as const }] };
      for (const r of await liveRows(tx, sys, "ci_rel", cond, { limit: 5000 })) {
        if (!String(r.note ?? "").includes(`«${rule.name}»`)) continue;
        if (want.has(`${r.parent_id}|${r.child_id}`)) continue;
        // the pair was not in this run's candidates: re-check it exactly
        const sRow = await liveRow(tx, sys, "ci", r.parent_id);
        const dRow = await liveRow(tx, sys, "ci", r.child_id);
        const sv = sRow ? String((String(rule.source_attr).startsWith("attrs.") ? sRow.attrs?.[String(rule.source_attr).slice(6)] : sRow[rule.source_attr] ?? sRow.attrs?.[rule.source_attr]) ?? "").toLowerCase() : "";
        const dv = dRow ? String((String(rule.target_attr).startsWith("attrs.") ? dRow.attrs?.[String(rule.target_attr).slice(6)] : dRow[rule.target_attr] ?? dRow.attrs?.[rule.target_attr]) ?? "").toLowerCase() : "";
        if (sv && sv === dv) continue;
        await updateIn(tx, sys, "ci_rel", r.id, { valid_to: at }, { trusted: true });
        ended++;
      }
    }
    await updateIn(tx, sys, "ci_rel_rule", rule.id, { last_run_at: at, last_result: `${created} رابطهٔ تازه، ${ended} پایان‌یافته` }, { trusted: true, keepVersion: true });
  }
  return { created, ended };
}

export { eqAll };
