// Content blocks of notification templates (docs/spec/services/notify.md §5): a module registers a block that renders
// content of its own for one recipient — `{{block.kb_suggestions}}` puts the articles that recipient may read and that
// best match the record into «درخواست شما ثبت شد» (KB-051). A block renders under the recipient's access (their
// `ctx`), returns safe Markdown (and plain text for subjects and SMS) and may return nothing, which leaves the
// placeholder empty (`{{#if block.kb_suggestions}}…{{/if}}` hides its heading). A block that fails renders nothing:
// the message still goes out.
import type { TableDef } from "@shared/model/types";
import type { Ctx } from "../../context";

export interface TemplateBlockInput {
  /** the recipient's context: what the block reads, it reads as them */
  ctx: Ctx;
  /** the record's table (the organisation's schema) */
  def: TableDef;
  id: string;
  /**
   * the record as the recipient sees it: the fields the template names, the display field, the state and the block's
   * own `fields` (fields they may not see are absent)
   */
  row: Record<string, unknown>;
  /** the notification event (created, updated, …, or custom) */
  event: string;
  /** an absolute link to an organisation-relative app path (`kb/a/<id>`), or the app path when the address is unknown */
  link(path: string): string;
}

export interface TemplateBlock {
  /** what the template editor shows */
  label: string;
  description?: string;
  /** the tables it applies to: their keys or a test of the table (every table when absent) */
  tables?: string[] | ((def: TableDef) => boolean);
  /** fields of the record it reads, fetched with the template's under the recipient's access */
  fields?: string[];
  /** safe Markdown (values escaped by the module) and plain text, or null for nothing */
  render(input: TemplateBlockInput): Promise<{ markdown: string; text?: string } | null>;
}

const blocks = new Map<string, TemplateBlock>();
const KEY = /^[a-z][a-z0-9_]{1,60}$/;
const PREFIX = "block.";

/** Register a block (`{{block.<key>}}` in templates); returns an unregister function. */
export function registerTemplateBlock(key: string, block: TemplateBlock): () => void {
  if (!KEY.test(key)) throw new Error(`template block key "${key}" must be lower-case letters, digits and _`);
  blocks.set(key, block);
  return () => {
    if (blocks.get(key) === block) blocks.delete(key);
  };
}

const applies = (b: TemplateBlock, def: TableDef) => !b.tables || (typeof b.tables === "function" ? b.tables(def) : b.tables.includes(def.key));
const blockOf = (path: string) => (path.startsWith(PREFIX) ? blocks.get(path.slice(PREFIX.length)) : undefined);

export interface TemplateBlockInfo {
  key: string;
  /** what goes between the braces */
  path: string;
  label: string;
  description: string | null;
}

/** The registered blocks (those that apply to `def` when given), for the template editor (`GET /notify/blocks`). */
export function templateBlocks(def?: TableDef | null): TemplateBlockInfo[] {
  return [...blocks.entries()]
    .filter(([, b]) => !def || applies(b, def))
    .map(([key, b]) => ({ key, path: `${PREFIX}${key}`, label: b.label, description: b.description ?? null }))
    .sort((a, b) => a.label.localeCompare(b.label, "fa"));
}

/** Fields the blocks a template names read (added to what the recipient's view of the record fetches). */
export function blockFields(paths: readonly string[], def: TableDef): string[] {
  const out = new Set<string>();
  for (const p of paths) {
    const b = blockOf(p);
    if (b && applies(b, def)) for (const f of b.fields ?? []) out.add(f);
  }
  return [...out];
}

/**
 * The blocks a template names, rendered for one recipient (path → content). Unknown blocks, blocks of other tables,
 * empty and failing ones are left out (their placeholders render empty).
 */
export async function renderBlocks(paths: readonly string[], input: TemplateBlockInput, log?: (msg: string, data: Record<string, unknown>) => void): Promise<Map<string, { markdown: string; text: string }>> {
  const out = new Map<string, { markdown: string; text: string }>();
  for (const path of new Set(paths)) {
    const b = blockOf(path);
    if (!b || !applies(b, input.def)) continue;
    try {
      const r = await b.render(input);
      if (!r || !r.markdown.trim()) continue;
      out.set(path, { markdown: r.markdown.trim(), text: (r.text ?? r.markdown).trim() });
    } catch (e) {
      log?.("notification block failed", { block: path, table: input.def.key, error: String((e as Error)?.message ?? e) });
    }
  }
  return out;
}
