// The built-in skills (code): modules' AI layers declare theirs with `registerSkill` (src/server/modules/ai/skills/
// builtin). An organisation configures each through its `ai_skill` row and may copy one under a key of its own.
import type { TableDef } from "@shared/model/types";
import type { SkillDef } from "./types";

const SKILLS = new Map<string, SkillDef>();
const KEY_RE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+){0,3}$/;

/** Declare a built-in skill (a later one with the same key replaces it). Returns its removal. */
export function registerSkill(def: SkillDef): () => void {
  if (!KEY_RE.test(def.key) || def.key.length > 80) throw new Error(`skill key «${def.key}» is not valid`);
  if (def.output === "fields" && !def.outputFields) throw new Error(`skill ${def.key}: a «fields» skill names its output fields`);
  if ((def.output === "json" || def.output === "record") && !def.schema) throw new Error(`skill ${def.key}: a ${def.output} skill has a schema`);
  SKILLS.set(def.key, def);
  return () => {
    if (SKILLS.get(def.key) === def) SKILLS.delete(def.key);
  };
}

export const defineSkill = (def: SkillDef): SkillDef => def;

export const skillDef = (key: string): SkillDef | undefined => SKILLS.get(key);

export const builtinSkills = (): SkillDef[] => [...SKILLS.values()];

export const isSkillKey = (key: string) => KEY_RE.test(key) && key.length <= 80;

/** Does a skill work on records of this table? */
export function appliesTo(def: Pick<SkillDef, "tables" | "when">, tables: string[] | null, table: TableDef): boolean {
  const list = tables && tables.length ? tables : def.tables === "*" ? ["*"] : def.tables;
  if (!(list.includes("*") || list.includes(table.key))) return false;
  if (list.includes(table.key)) return true;
  return def.when ? def.when(table) : true;
}

/** Fields a «fields» skill may suggest on a table. */
export function outputFieldsOf(def: SkillDef, table: TableDef | null): string[] {
  if (!def.outputFields) return [];
  const names = typeof def.outputFields === "function" ? (table ? def.outputFields(table) : []) : def.outputFields;
  return table ? names.filter((n) => table.fields.some((f) => f.name === n)) : names;
}
