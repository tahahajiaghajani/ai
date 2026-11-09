// Which models an organisation has (docs/spec/AI.md §13.1), generated from the metadata so that a table added later
// (ESM, security, ITAM…) is covered as it is:
//   · classifiers — every task table (`extends: "task"`) with a text to read gets one per target field it has among
//     category, assignment group, priority and service (`TARGET_INPUTS`), plus what modules register with
//     `registerPredictionTarget`;
//   · duplicates — every task table with a text: new records against the recent ones of the same table; knowledge
//     articles of one base by meaning (./kbdup.ts, with the organisation's embedding model);
//   · clusters — task tables with a problem reference (`problem_id`): unlinked records of the last 60 days;
//   · risk models — SLA breach for every table whose records carry SLAs (`features.sla`), and those registered with
//     `registerRiskModel` (the change failure model below, registered when the change table exists).
// A field reaches a model only when a generated AI tool could show it (`toolField`: never a secret, `ai_private`, a
// field kept from prompts or out of replicas) and it belongs to no field group — so «چرا؟», which names the words and
// values behind a prediction, never shows what a reader of the record may not see.
import type { FieldDef, TableDef } from "@shared/model/types";
import { TABLES } from "@shared/tables";
import type { Ctx } from "../../../context";
import type { OrgSchema } from "../../../engine";
import { toolField } from "../tools/fields";
import type { FeatureSpec, RiskExample } from "./core/risk";

export type ModelKind = "classifier" | "risk" | "duplicate" | "cluster";

export const MODEL_KINDS: Record<ModelKind, string> = {
  classifier: "طبقه‌بندی متن",
  risk: "احتمال پیشامد",
  duplicate: "کشف تکراری",
  cluster: "خوشه‌بندی و نامزد مسئله",
};

/** Target fields of the built-in classifiers and the categorical inputs each reads besides the text. */
export const TARGET_INPUTS: Record<string, string[]> = {
  category: ["channel"],
  assignment_group_id: ["category", "subcategory", "service_id", "channel"],
  priority: ["impact", "urgency", "category", "service_id", "channel"],
  service_id: ["category", "channel"],
};

const TEXT_TYPES = new Set(["string", "text", "markdown"]);
const TARGET_TYPES = new Set(["choice", "group", "ref", "user"]);

interface BaseSpec {
  key: string;
  kind: ModelKind;
  name: string;
  table: string;
  target: string | null;
  inputs: string[];
}

export interface ClassifierSpec extends BaseSpec {
  kind: "classifier";
  target: string;
  text: string[];
}

export interface DuplicateSpec extends BaseSpec {
  kind: "duplicate";
  text: string[];
  /** a pass over a whole table instead of new records against recent ones (./kbdup.ts: knowledge articles by meaning) */
  pass?: "kb_semantic";
}

export interface ClusterSpec extends BaseSpec {
  kind: "cluster";
  text: string[];
  /** the field that links a record to a problem (records already linked are not clustered) */
  link: string;
}

/** A training example and the rows a risk model scores, read by its definition. */
export interface RiskModelDef {
  key: string;
  name: string;
  table: string;
  /** Persian: what the probability is of («نقض توافق»، «شکست تغییر») */
  outcome: string;
  features: FeatureSpec[];
  /** Persian labels of the features (for «چرا؟») */
  labels: Record<string, string>;
  /** default threshold above which a record is marked «پرخطر» */
  alert?: number;
  when?: (schema: OrgSchema) => boolean;
  /** training examples, read as the system (confidential rows and secure workspaces left out: ./data.ts) */
  examples?: (sys: Ctx, def: RiskModelDef) => Promise<RiskExample[]>;
  /** the open records to score now, with their features (and a Persian note per record, optional) */
  open?: (sys: Ctx, def: RiskModelDef) => Promise<RiskRow[]>;
}

/** A record a risk model scores: its id, its features now, and what each of its parts scored (SLAs of a record). */
export interface RiskRow {
  record_id: string;
  x: Record<string, unknown>;
  /** a record with several parts (several running SLAs): each part and its own features */
  parts?: { key: string; label: string; x: Record<string, unknown> }[];
}

export interface RiskSpec extends BaseSpec {
  kind: "risk";
  def: RiskModelDef;
}

export type ModelSpec = ClassifierSpec | DuplicateSpec | ClusterSpec | RiskSpec;

const extraTargets: { table: string; field: string; inputs: string[] }[] = [];
const riskModels = new Map<string, RiskModelDef>();

/** A module's own classifier target (a field of a task table to predict from its text and `inputs`). */
export function registerPredictionTarget(table: string, field: string, inputs: string[] = []): () => void {
  const entry = { table, field, inputs };
  extraTargets.push(entry);
  return () => {
    const i = extraTargets.indexOf(entry);
    if (i >= 0) extraTargets.splice(i, 1);
  };
}

/** A module's own probability model (its training rows and scoring are implemented in ./risk-models.ts). */
export function registerRiskModel(def: RiskModelDef): () => void {
  riskModels.set(def.key, def);
  return () => {
    if (riskModels.get(def.key) === def) riskModels.delete(def.key);
  };
}

export const riskModelDef = (key: string): RiskModelDef | undefined => riskModels.get(key);

/** May this field be a model's text or input (see the file's head)? */
export function modelField(def: TableDef, f: FieldDef | undefined): f is FieldDef {
  return !!f && !f.group && !f.custom && toolField(def, f);
}

/** The text fields a model of this table reads: its RAG text when declared, else title and description. */
export function textFields(def: TableDef): string[] {
  const names = def.ai?.text?.length ? [def.display, ...def.ai.text] : ["short_description", "description"];
  return [...new Set(names)].filter((n) => {
    const f = def.fields.find((x) => x.name === n);
    return modelField(def, f) && TEXT_TYPES.has(f.type);
  });
}

const isTask = (def: TableDef) => def.extends === "task" && !def.virtual && def.module !== "ai";

/** Every model the organisation's schema calls for (stable order). */
export function modelSpecs(schema: OrgSchema): ModelSpec[] {
  const out: ModelSpec[] = [];
  for (const t of TABLES.values()) {
    const def = schema.def(t.key);
    if (!def || !isTask(def)) continue;
    const text = textFields(def);
    if (!text.length) continue;
    const field = (n: string) => def.fields.find((f) => f.name === n);
    const targets = [
      ...Object.entries(TARGET_INPUTS).map(([target, inputs]) => ({ target, inputs })),
      ...extraTargets.filter((e) => e.table === def.key).map((e) => ({ target: e.field, inputs: e.inputs })),
    ];
    for (const { target, inputs } of targets) {
      const f = field(target);
      if (!modelField(def, f) || !TARGET_TYPES.has(f.type) || f.system) continue;
      out.push({
        key: `classify:${def.key}:${target}`,
        kind: "classifier",
        name: `پیش‌بینی «${f.label}» در ${def.plural}`,
        table: def.key,
        target,
        text,
        inputs: inputs.filter((n) => n !== target && modelField(def, field(n))),
      });
    }
    out.push({ key: `duplicate:${def.key}`, kind: "duplicate", name: `کشف ${def.plural} تکراری`, table: def.key, target: null, text, inputs: [] });
    const link = field("problem_id");
    if (link && link.type === "ref" && link.ref === "problem") {
      out.push({ key: `cluster:${def.key}`, kind: "cluster", name: `خوشه‌های ${def.plural} (نامزد مسئله)`, table: def.key, target: null, text, inputs: [], link: "problem_id" });
    }
    if (def.features?.sla && schema.def("task_sla")) {
      const r = slaRiskDef(def);
      out.push({ key: r.key, kind: "risk", name: r.name, table: def.key, target: "breach", inputs: r.features.map((x) => x.name), def: r });
    }
  }
  // knowledge articles that say the same in other words, when the knowledge module is there (./kbdup.ts)
  const kb = schema.def("kb_article");
  if (kb && schema.def("kb_duplicate")) {
    out.push({ key: "duplicate:kb_article", kind: "duplicate", name: `${kb.plural} هم‌معنا (تکراری)`, table: kb.key, target: null, text: ["title", "body"], inputs: [], pass: "kb_semantic" });
  }
  for (const r of riskModels.values()) {
    if (!schema.def(r.table) || (r.when && !r.when(schema))) continue;
    out.push({ key: r.key, kind: "risk", name: r.name, table: r.table, target: "outcome", inputs: r.features.map((x) => x.name), def: r });
  }
  return out;
}

/** The SLA breach model of a table (features at a point in an SLA's life). */
export function slaRiskDef(def: TableDef): RiskModelDef {
  const has = (n: string) => modelField(def, def.fields.find((f) => f.name === n));
  const cats = ["priority", "category", "assignment_group_id", "service_id", "channel"].filter(has);
  const labelOf = (n: string) => def.fields.find((f) => f.name === n)?.label ?? n;
  return {
    key: `risk:sla:${def.key}`,
    name: `خطر نقض توافق در ${def.plural}`,
    table: def.key,
    outcome: "نقض توافق سطح خدمت",
    alert: 0.6,
    features: [
      ...cats.map((name) => ({ name, kind: "cat" as const })),
      { name: "sla", kind: "cat" },
      { name: "elapsed", kind: "num" },
      { name: "age_hours", kind: "num" },
      { name: "backlog", kind: "num" },
      { name: "start_hour", kind: "num" },
      { name: "start_weekday", kind: "cat" },
      { name: "off_hours", kind: "bool" },
    ],
    labels: {
      ...Object.fromEntries(cats.map((n) => [n, labelOf(n)])),
      sla: "توافق",
      elapsed: "سهم سپری‌شده از زمان توافق",
      age_hours: "سن رکورد (ساعت)",
      backlog: "کارهای باز گروه",
      start_hour: "ساعت شروع",
      start_weekday: "روز شروع",
      off_hours: "شروع بیرون از ساعت کاری",
    },
  };
}
