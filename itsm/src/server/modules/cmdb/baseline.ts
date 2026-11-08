// Configuration baselines and configuration control (catalogue CMDB-037/038): a baseline snapshots the attributes and
// relationships of its scope (a class with its subclasses, a CI group, or named CIs — what the person taking it may
// read, at most 2000 CIs); it is compared with the current state or with another baseline (added, removed, modified
// fields and relationships); differences of an approved baseline become drift records, and so do changes to controlled
// attributes made without an authorising change (the `cmdb.drift` job the CI hook queues).
import { diffSnapshots, type SnapItem, type SnapRel } from "@shared/cmdb/logic";
import type { CompareResult } from "@shared/cmdb/api";
import { tableDef } from "@shared/tables";
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { conflict, forbidden, notFound } from "../../http/errors";
import { createIn, orgSchema, updateIn } from "../../engine";
import { access } from "../../access/provider";
import { classTree, eqAll, isUuid, liveRow, liveRows, sysOf, type Row } from "./common";
import { edgesAround } from "./graph";

export const MAX_BASELINE = 2000;

/** The CI fields a baseline keeps (identity, technical data, ownership and lifecycle). */
export const SNAP_FIELDS = [
  "environment", "criticality", "operational_status", "install_status", "owned_by", "support_group_id", "location_id", "serial_number", "asset_tag",
  "manufacturer", "model_name", "hostname", "fqdn", "ip_address", "mac_address", "os", "os_version", "sw_version", "cpu_count", "ram_mb", "disk_gb", "expires_at",
];

/** Snapshots of CIs (the caller's view: `liveRows` with their context; relationships only to CIs they may read). */
export async function snapshotOf(q: Queryable, ctx: Ctx, cis: Row[], withRels: boolean): Promise<SnapItem[]> {
  const ids = cis.map((c) => c.id);
  const rels = new Map<string, SnapRel[]>();
  if (withRels && ids.length) {
    const edges = await edgesAround(q, ctx, ids);
    const others = [...new Set(edges.flatMap((e) => [e.parent_id, e.child_id]))];
    const readable = new Map((await liveRows(q, ctx, "ci", { f: "id", op: "in", v: others.slice(0, 10000) })).map((r) => [r.id, r]));
    for (const e of edges) {
      if (!readable.has(e.parent_id) || !readable.has(e.child_id)) continue;
      const add = (id: string, dir: "out" | "in", other: string) => {
        if (!ids.includes(id)) return;
        const list = rels.get(id) ?? [];
        list.push({ type: e.type, dir, other, other_label: String(readable.get(other)?.name ?? "") });
        rels.set(id, list);
      };
      add(e.parent_id, "out", e.child_id);
      add(e.child_id, "in", e.parent_id);
    }
  }
  return cis.map((c) => {
    const values: Record<string, unknown> = {};
    for (const f of SNAP_FIELDS) if (c[f] !== null && c[f] !== undefined && c[f] !== "") values[f] = c[f];
    for (const [k, v] of Object.entries((c.attrs ?? {}) as Record<string, unknown>)) if (v !== null && v !== undefined && v !== "") values[`attrs.${k}`] = v;
    return { id: c.id, number: c.number ?? null, name: c.name, class: c.class, state: c.state, values, rels: (rels.get(c.id) ?? []).sort((a, b) => `${a.dir}${a.type}${a.other}`.localeCompare(`${b.dir}${b.type}${b.other}`)) };
  });
}

/** The CIs a baseline covers now, as the caller may read them. */
async function scopeCis(q: Queryable, ctx: Ctx, b: Row): Promise<Row[]> {
  if (b.scope_kind === "class" && b.class) {
    const tree = await classTree(q, ctx);
    return liveRows(q, ctx, "ci", { and: [{ f: "class", op: "in", v: tree.descendants(b.class) }, { f: "state", op: "nin", v: ["disposed", "canceled"] }] }, { order: "t.name", limit: MAX_BASELINE });
  }
  if (b.scope_kind === "group" && isUuid(b.group_id)) {
    const g = await liveRow(q, ctx, "ci_group", b.group_id);
    if (!g) return [];
    if (g.kind === "dynamic" && g.condition) return liveRows(q, ctx, "ci", g.condition, { order: "t.name", limit: MAX_BASELINE });
    const members = (g.members ?? []).filter(isUuid);
    return members.length ? liveRows(q, ctx, "ci", { f: "id", op: "in", v: members.slice(0, MAX_BASELINE) }, { order: "t.name" }) : [];
  }
  const list = (b.ci_ids ?? []).filter(isUuid);
  return list.length ? liveRows(q, ctx, "ci", { f: "id", op: "in", v: list.slice(0, MAX_BASELINE) }, { order: "t.name" }) : [];
}

async function writableBaseline(tx: Tx, ctx: Ctx, id: string): Promise<Row> {
  const b = await liveRow(tx, ctx, "ci_baseline", id);
  if (!b) throw notFound("خط مبنا پیدا نشد");
  const schema = await orgSchema(ctx, tx);
  if (ctx.actor !== "system" && !access().canWrite(ctx, schema.def("ci_baseline") ?? tableDef("ci_baseline")!, b)) throw forbidden("اجازهٔ تغییر این خط مبنا را ندارید");
  return b;
}

/** Take (or retake) the snapshot of a draft baseline. */
export async function takeSnapshot(ctx: Ctx, id: string): Promise<Row> {
  return ctx.write(async (tx) => {
    const b = await writableBaseline(tx, ctx, id);
    if (b.state !== "draft") throw conflict("خط مبنای تأییدشده تغییر نمی‌کند؛ خط مبنای تازه بسازید");
    const cis = await scopeCis(tx, ctx, b);
    const items = await snapshotOf(tx, ctx, cis, b.include_relations !== false);
    return updateIn(tx, sysOf(ctx, ctx.actor === "system" ? null : ctx.user.id), "ci_baseline", id, { items, item_count: items.length, taken_at: new Date().toISOString() }, { trusted: true });
  });
}

const FIELD_LABELS = (): Record<string, string> => Object.fromEntries((tableDef("ci")?.fields ?? []).map((f) => [f.name, f.label]));

/** Compare a baseline with the current state (`against` null) or with another baseline. */
export async function compareBaseline(ctx: Ctx, id: string, against: string | null): Promise<CompareResult> {
  const q = ctx.db;
  const b = await liveRow(q, ctx, "ci_baseline", id);
  if (!b) throw notFound("خط مبنا پیدا نشد");
  const before: SnapItem[] = Array.isArray(b.items) ? b.items : [];
  let after: SnapItem[];
  let afterLabel = "وضعیت فعلی";
  let afterAt: string | null = new Date().toISOString();
  if (against) {
    const o = await liveRow(q, ctx, "ci_baseline", against);
    if (!o) throw notFound("خط مبنای دوم پیدا نشد");
    after = Array.isArray(o.items) ? o.items : [];
    afterLabel = `${o.number ?? ""} ${o.name}`.trim();
    afterAt = o.taken_at ?? null;
  } else {
    const current = b.scope_kind === "cis" ? await liveRows(q, ctx, "ci", { f: "id", op: "in", v: before.map((x) => x.id).filter(isUuid).slice(0, MAX_BASELINE) }) : await scopeCis(q, ctx, b);
    after = await snapshotOf(q, ctx, current, b.include_relations !== false);
  }
  const diff = diffSnapshots(before, after, { includeAdded: b.scope_kind !== "cis" || !!against });
  const tree = await classTree(q, ctx);
  const labels: Record<string, string> = { ...FIELD_LABELS(), name: "نام", class: "کلاس", state: "وضعیت" };
  for (const c of tree.byKey.values()) for (const a of c.attrs) labels[`attrs.${a.name}`] = a.label;
  return { diff, labels, before: { label: `${b.number ?? ""} ${b.name}`.trim(), at: b.taken_at ?? null }, after: { label: afterLabel, at: afterAt } };
}

const text = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)).slice(0, 2000);

/** Open a drift record per modified field of an approved baseline (one per CI, field and baseline). */
export async function driftFromBaseline(ctx: Ctx, id: string): Promise<{ created: number; existing: number }> {
  const r = await compareBaseline(ctx, id, null);
  const b = await liveRow(ctx.db, ctx, "ci_baseline", id);
  if (!b) throw notFound("خط مبنا پیدا نشد");
  if (b.state !== "approved") throw conflict("انحراف فقط از خط مبنای تأییدشده ثبت می‌شود");
  return ctx.write(async (tx) => {
    let created = 0;
    let existing = 0;
    const sys = sysOf(ctx, ctx.actor === "system" ? null : ctx.user.id);
    for (const m of r.diff.modified) {
      const ci = await liveRow(tx, sysOf(ctx), "ci", m.id);
      for (const f of m.fields) {
        const key = `baseline:${id}:${m.id}:${f.field}`;
        const [open] = await liveRows(tx, sysOf(ctx), "ci_drift", { and: [{ f: "dedupe_key", op: "eq", v: key }, { f: "active", op: "eq", v: true }] }, { limit: 1 });
        if (open) {
          existing++;
          continue;
        }
        await createIn(tx, sys, "ci_drift", {
          short_description: `«${m.name}»: «${r.labels[f.field] ?? f.field}» با خط مبنا فرق دارد`.slice(0, 200),
          ci_id: m.id, attribute: f.field, expected: text(f.before), actual: text(f.after), baseline_id: id, dedupe_key: key,
          assignment_group_id: ci?.support_group_id ?? null, assigned_to: ci?.owned_by ?? null,
        }, { trusted: true });
        created++;
      }
    }
    return { created, existing };
  });
}

/** The drift of controlled attributes changed without an authorising change (from the CI hook's job). */
export async function recordDrift(tx: Tx, ctx: Ctx, ciId: string, changes: { attribute: string; expected: unknown; actual: unknown }[], via: string): Promise<number> {
  const sys = sysOf(ctx);
  const ci = await liveRow(tx, sys, "ci", ciId);
  if (!ci) return 0;
  const tree = await classTree(tx, ctx);
  const cls = tree.resolve(ci.class);
  let n = 0;
  for (const c of changes) {
    const key = `control:${ciId}:${c.attribute}`;
    const [open] = await liveRows(tx, sys, "ci_drift", { and: [{ f: "dedupe_key", op: "eq", v: key }, { f: "active", op: "eq", v: true }] }, { limit: 1 });
    const label = c.attribute.startsWith("attrs.") ? cls?.allAttrs.find((a) => a.name === c.attribute.slice(6))?.label ?? c.attribute : tableDef("ci")?.fields.find((f) => f.name === c.attribute)?.label ?? c.attribute;
    if (open) {
      await updateIn(tx, sys, "ci_drift", open.id, { actual: text(c.actual) }, { trusted: true });
      continue;
    }
    await createIn(tx, sys, "ci_drift", {
      short_description: `«${ci.name}»: «${label}» بدون تغییر مجاز عوض شد`.slice(0, 200),
      ci_id: ciId, attribute: c.attribute, expected: text(c.expected), actual: text(c.actual), dedupe_key: key,
      description: via === "manual" ? "ویرایش دستی" : "گزارش منبع داده",
      assignment_group_id: ci.support_group_id ?? null, assigned_to: ci.owned_by ?? null, source_id: ci.discovery_source_id ?? null,
    }, { trusted: true });
    n++;
  }
  return n;
}

export { eqAll };
