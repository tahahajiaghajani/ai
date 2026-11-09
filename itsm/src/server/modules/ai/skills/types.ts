// Types of the skills framework (docs/spec/AI.md §11). A skill is declared in code (`defineSkill`) — its inputs, output,
// tier, grounding, default triggers and roles, its Persian prompts (the default version) and optional code hooks
// (facts computed with the caller's access, a rule-based fallback, post-processing) — and configured per organisation
// through its `ai_skill` row (src/shared/tables/ai.ts).
import type { z } from "zod";
import type { Ctx } from "../../../context";
import type { FieldGroup, TableDef } from "@shared/model/types";
import type {
  SkillEventKind, SkillGrounding, SkillOutputKind, SkillParamDef, SkillSurface, SkillTarget, SkillTier, SkillTrigger,
} from "@shared/ai/skills";
import type { RetrievedPassage } from "../rag";

/** One field of a record as the prompt shows it: the caller's visible value, formatted (choices and refs by label). */
export interface PromptField {
  name: string;
  label: string;
  type: string;
  group: FieldGroup | null;
  /** the stored value (ids for references) */
  raw: unknown;
  /** what the model reads */
  value: unknown;
}

/** The record a skill works on, loaded with the caller's access and trimmed to what a model may read. */
export interface RecordData {
  table: string;
  table_label: string;
  id: string;
  number: string | null;
  title: string;
  /** the row as the caller reads it (visible fields only) */
  row: Record<string, unknown>;
  display: Record<string, string>;
  def: TableDef;
  /** the fields that may reach the model, in form order */
  fields: PromptField[];
  version: number | null;
}

export interface JournalData {
  kind: string;
  kind_label: string;
  visibility: "public" | "internal";
  author: string | null;
  /** when, in the organisation's local Jalali time (as the prompt shows every date) */
  at: string;
  body: string;
}

/** What a skill's code hooks receive: everything was read with the caller's (or the service member's) access. */
export interface SkillRuntimeInput {
  key: string;
  table: string | null;
  id: string | null;
  text: string | null;
  params: Record<string, unknown>;
  record: RecordData | null;
  journal: JournalData[];
  related: Record<string, Record<string, unknown>[]>;
  links: { kind: string; table: string; number: string | null; title: string; state: string | null }[];
  /**
   * The rows behind `related` and `links` (`@r:<table>:<id>` tokens, never shown to the model): whoever sees a proposal
   * built from a template that showed them must read them too.
   */
  reads: { related: string[]; links: string[] };
  passages: RetrievedPassage[];
  language: "fa" | "en";
  /** true when an event or a schedule started the run (the service member's access) */
  triggered: boolean;
  /** the field groups this skill may read (its configuration; never `ai_private`) — on top of what the caller sees */
  fieldGroups: FieldGroup[];
}

/** What a skill (the model, a fallback or a post-processor) answered, before the runtime shapes and checks it. */
export interface SkillRawOutput {
  text?: string | null;
  json?: unknown;
  suggestions?: { field: string; value: unknown; confidence?: number | null; reason?: string | null }[];
  journal?: { kind: "comment" | "work_note"; body: string } | null;
  record?: Record<string, unknown> | null;
}

export interface SkillDef {
  /** stable key, «module.name» (lower case, digits, dots and _) */
  key: string;
  name: string;
  description: string;
  module: string;
  /** catalogue references (AI-023, INC-067 …) */
  catalog?: string[];
  target: SkillTarget;
  /** tables whose records it works on; "*" = any table (narrowed by `when`) */
  tables: string[] | "*";
  when?: (def: TableDef) => boolean;
  output: SkillOutputKind;
  /** json / record outputs: the zod schema of the answer */
  schema?: z.ZodTypeAny;
  /** «fields»: the fields it may suggest (per table) */
  outputFields?: string[] | ((def: TableDef) => string[]);
  /** «journal»: the entry it drafts */
  journalKind?: "comment" | "work_note";
  /** «record»: the table of the record it drafts */
  recordTable?: string;
  tier: SkillTier;
  grounding?: { kind: SkillGrounding; k?: number };
  inputs?: {
    /** only these fields of the record (default: every field the caller sees that a model may read) */
    fields?: string[];
    /** journal entries: all the caller may read, public replies only, or none (default: all) */
    journal?: "all" | "public" | "none";
    journalLimit?: number;
    related?: { table: string; field: string; label: string; fields?: string[]; limit?: number }[];
    links?: boolean;
  };
  params?: SkillParamDef[];
  /** default configuration of the organisation's row */
  roles?: string[];
  fieldGroups?: FieldGroup[];
  triggers?: SkillTrigger[];
  events?: SkillEventKind[];
  surfaces?: SkillSurface[];
  composer?: "comment" | "work_note" | "both";
  icon?: string;
  order?: number;
  /** the default version (Persian prompts) */
  system: string;
  template: string;
  maxTokens?: number;
  temperature?: number | null;
  /** facts computed in code with the caller's access (numbers come from code; the model narrates) */
  facts?: (ctx: Ctx, input: SkillRuntimeInput) => Promise<Record<string, unknown>>;
  /** the placeholders `facts` fills (template validation) */
  factKeys?: string[];
  /** the rule-based answer when no model can answer (the UI says so) */
  fallback?: (ctx: Ctx, input: SkillRuntimeInput) => Promise<SkillRawOutput>;
  /** post-processing of an answer (map names to ids the caller may read, clamp values) */
  post?: (ctx: Ctx, out: SkillRawOutput, input: SkillRuntimeInput) => Promise<SkillRawOutput>;
  /** the search of a grounded skill (default: the record's title and description, or the text) */
  query?: (input: SkillRuntimeInput) => string;
}

/** Options of a run (routes, module integrations, triggers, the admin's test run, evals). */
export interface RunOptions {
  /** a version to run instead of the published one (the admin's test run, evals) */
  versionId?: string | null;
  /** run a disabled skill too (the admin's test run) */
  ignoreEnabled?: boolean;
  /** store the output's writes as a proposal on the record (record panel); module integrations return drafts */
  propose?: boolean;
  /** the run was started by an event or a schedule (the caller is the service member) */
  triggered?: boolean;
  /** never fall back to rules (evals measure the model) */
  noFallback?: boolean;
  /** do not store a run (module checks that only need the answer) */
  ephemeral?: boolean;
  /** facts a module computed for this run (numbers from code: a scorecard, health facts, a form) — data blocks too */
  facts?: Record<string, unknown>;
  signal?: AbortSignal;
  onText?: (delta: string) => void;
}
