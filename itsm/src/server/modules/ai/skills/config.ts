// An organisation's configuration of its skills: the built-in default (code) with the organisation's `ai_skill` row
// over it, and the version a run uses — the published one, or the code's default prompts when none is published (so
// improved defaults reach every organisation that has not written its own). Rows are read as the system: they are
// configuration, and who may run a skill is decided by the skill's own rules (enabled, roles), not by who may open
// the row through the generic API.
import type { Ctx } from "../../../context";
import type { SkillConfig, SkillEventKind, SkillGrounding, SkillTier, SkillTrigger } from "@shared/ai/skills";
import { SKILL_EVENTS, SKILL_FIELD_GROUPS, SKILL_GROUNDINGS, SKILL_TIERS, SKILL_TRIGGERS } from "@shared/ai/skills";
import { AI_SKILL, AI_SKILL_VERSION } from "@shared/tables/ai";
import { notFound } from "../../../http/errors";
import { liveRow, liveRows, sysOf } from "../../incident/common";
import { builtinSkills, outputFieldsOf, skillDef } from "./registry";
import type { SkillDef } from "./types";

type Row = Record<string, unknown>;

export interface VersionData {
  id: string | null;
  version: number;
  state: "draft" | "published" | "retired" | "default";
  system: string;
  template: string;
  output_schema: unknown;
  temperature: number | null;
  max_tokens: number | null;
  note: string | null;
}

export interface ResolvedSkill {
  def: SkillDef;
  cfg: SkillConfig;
  row: Row | null;
  version: VersionData;
}

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const pick = <T extends string>(v: unknown, allowed: Record<T, unknown>, d: T): T => (typeof v === "string" && v in allowed ? (v as T) : d);
const picks = <T extends string>(v: unknown, allowed: Record<T, unknown>): T[] => arr(v).filter((x): x is T => x in allowed);

/** The built-in configuration of a skill (no organisation row yet). */
export function defaultConfig(def: SkillDef): SkillConfig {
  return {
    key: def.key,
    name: def.name,
    description: def.description,
    module: def.module,
    base_key: def.key,
    builtin: true,
    enabled: true,
    target: def.target,
    output: def.output,
    tables: def.tables === "*" ? ["*"] : [...def.tables],
    tier: def.tier,
    grounding: def.grounding?.kind ?? "none",
    grounding_k: def.grounding?.k ?? 5,
    collections: [],
    triggers: def.triggers?.length ? [...def.triggers] : ["manual"],
    events: def.events ? [...def.events] : [],
    condition: null,
    schedule_minutes: null,
    schedule_filter: null,
    roles: def.roles ? [...def.roles] : [],
    field_groups: def.fieldGroups ? [...def.fieldGroups] : [],
    auto_apply: [],
    daily_limit: null,
    user_daily_limit: null,
    active_version_id: null,
    has_fallback: !!def.fallback,
    catalog: def.catalog ?? [],
    surfaces: def.surfaces ?? ["panel"],
    output_fields: outputFieldsOf(def, null),
  };
}

/** The organisation's row over the built-in default (unknown values fall back to the default). */
export function configOf(def: SkillDef, row: Row | null): SkillConfig {
  const d = defaultConfig(def);
  if (!row) return d;
  const groups = arr(row.field_groups).filter((g) => (SKILL_FIELD_GROUPS as readonly string[]).includes(g));
  return {
    ...d,
    key: String(row.key ?? d.key),
    name: String(row.name ?? d.name),
    description: typeof row.description === "string" && row.description ? row.description : d.description,
    builtin: !!row.builtin,
    base_key: String(row.base_key ?? def.key),
    enabled: row.enabled !== false,
    tables: arr(row.tables).length ? arr(row.tables) : d.tables,
    tier: pick<SkillTier>(row.tier, SKILL_TIERS, d.tier),
    grounding: pick<SkillGrounding>(row.grounding, SKILL_GROUNDINGS, d.grounding),
    grounding_k: Math.max(1, Math.min(12, num(row.grounding_k) ?? d.grounding_k)),
    collections: arr(row.collections),
    triggers: picks<SkillTrigger>(row.triggers, SKILL_TRIGGERS).length ? picks<SkillTrigger>(row.triggers, SKILL_TRIGGERS) : ["manual"],
    events: picks<SkillEventKind>(row.events, SKILL_EVENTS),
    condition: row.condition ?? null,
    schedule_minutes: num(row.schedule_minutes),
    schedule_filter: row.schedule_filter ?? null,
    roles: arr(row.roles),
    field_groups: groups,
    auto_apply: arr(row.auto_apply),
    daily_limit: num(row.daily_limit),
    user_daily_limit: num(row.user_daily_limit),
    active_version_id: typeof row.active_version_id === "string" ? row.active_version_id : null,
  };
}

/** The default version of a skill (its code prompts). */
export function defaultVersion(def: SkillDef): VersionData {
  return { id: null, version: 0, state: "default", system: def.system, template: def.template, output_schema: null, temperature: def.temperature ?? null, max_tokens: def.maxTokens ?? null, note: null };
}

export function versionOf(row: Row): VersionData {
  return {
    id: String(row.id),
    version: num(row.revision) ?? 0,
    state: pick<"draft" | "published" | "retired">(row.state, { draft: 1, published: 1, retired: 1 }, "draft"),
    system: String(row.system ?? ""),
    template: String(row.template ?? ""),
    output_schema: row.output_schema ?? null,
    temperature: num(row.temperature),
    max_tokens: num(row.max_tokens),
    note: typeof row.note === "string" ? row.note : null,
  };
}

/** Every live `ai_skill` row of the organisation (system read). */
export async function orgSkillRows(ctx: Ctx): Promise<Row[]> {
  return liveRows(ctx.db, sysOf(ctx), AI_SKILL, null, { order: "t.key", limit: 2000 });
}

export async function skillRow(ctx: Ctx, key: string): Promise<Row | null> {
  const rows = await liveRows(ctx.db, sysOf(ctx), AI_SKILL, { f: "key", op: "eq", v: key }, { limit: 1 });
  return rows[0] ?? null;
}

export async function versionRow(ctx: Ctx, id: string): Promise<Row | null> {
  return liveRow(ctx.db, sysOf(ctx), AI_SKILL_VERSION, id);
}

async function resolveWith(ctx: Ctx, def: SkillDef, row: Row | null, versionId?: string | null): Promise<ResolvedSkill> {
  const cfg = configOf(def, row);
  const want = versionId ?? cfg.active_version_id;
  let version = defaultVersion(def);
  if (want) {
    const v = await versionRow(ctx, want);
    if (v && (!row || v.skill_id === row.id)) version = versionOf(v);
    else if (versionId) throw notFound("نسخهٔ مهارت پیدا نشد");
  }
  return { def, cfg, row, version };
}

/** A skill of the organisation by key (a built-in, or a copy of one), with the version a run uses. */
export async function resolveSkill(ctx: Ctx, key: string, versionId?: string | null): Promise<ResolvedSkill> {
  const row = await skillRow(ctx, key);
  const def = skillDef(String(row?.base_key ?? key));
  if (!def) throw notFound("مهارت پیدا نشد");
  if (!row && def.key !== key) throw notFound("مهارت پیدا نشد");
  return resolveWith(ctx, def, row, versionId);
}

/** Every skill of the organisation: the built-ins (with their rows when they have one) and its copies. */
export async function allSkills(ctx: Ctx): Promise<ResolvedSkill[]> {
  const rows = await orgSkillRows(ctx);
  const byKey = new Map(rows.map((r) => [String(r.key), r]));
  const out: ResolvedSkill[] = [];
  for (const def of builtinSkills()) {
    const r = byKey.get(def.key) ?? null;
    out.push({ def, cfg: configOf(def, r), row: r, version: defaultVersion(def) });
  }
  for (const r of rows) {
    if (skillDef(String(r.key))) continue;
    const def = skillDef(String(r.base_key ?? ""));
    if (def) out.push({ def, cfg: configOf(def, r), row: r, version: defaultVersion(def) });
  }
  return out;
}

/** The version a resolved list entry runs (lists resolve versions lazily: most screens never need the prompts). */
export async function withVersion(ctx: Ctx, s: ResolvedSkill): Promise<ResolvedSkill> {
  if (!s.cfg.active_version_id) return s;
  return resolveWith(ctx, s.def, s.row);
}
