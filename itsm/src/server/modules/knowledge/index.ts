// Knowledge management (docs/modules/knowledge_FA.md): tables in src/shared/tables/knowledge.ts, screens in
// src/ui/modules/knowledge, HTTP API in src/server/routes/knowledge.ts. `installKnowledgeModule()` (once per process,
// src/server/routes/modules.ts, after the RAG index) wires the module into the platform:
//   · hooks of its tables (hooks.ts), the contributors compiled onto rows for the row rules (contrib.ts), its link
//     kinds (links.ts), jobs and subscribers (jobs.ts, capture.ts)
//   · the AI index: articles and answer snippets are RAG sources with their own builders — only live content, the
//     internal section in the `internal` partition, an article or base answering agents only puts everything there,
//     «فقط ارجاع» indexes the title and summary only — and an AI-channel rule checked with every question (state,
//     the article's and the base's AI switches, «سری»); retrieval joins every chunk to its article through the
//     reader's access, so audiences restrict AI answers exactly as they restrict reading
//   · record meta `knowledge` on GET /r/kb_article/:id (may the caller write, the open draft, the base)
//   · the notification templates' block `{{block.kb_suggestions}}` (suggest.ts, KB-051)
//   · the seed of a new organisation (seed.ts), queued after the SLA service's calendars
// Extension points: `registerKnowledgeAi` (ai.ts) for the AI layer's knowledge skills; other modules link records to
// articles with the engine's links of the kinds in KB_LINK_KINDS and ask for suggestions with `suggestForRecord`.
import { blockRefs } from "@shared/knowledge/logic";
import { LIVE_STATES } from "@shared/tables/knowledge";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { registerRecordMeta, systemCtx } from "../../engine";
import { enqueue, registerJobHandler, type JobConfig } from "../../jobs";
import { registerOrgSeed } from "../orgs/service";
import { SEED_DELAY_MS } from "../sla";
import { registerRagSource, type RagPart } from "../ai/rag";
import type { SeedCounts } from "../incident";
import { baseOf, categoryOf, contributesTo, liveRows, type Row } from "./common";
import { installKnowledgeHooks } from "./hooks";
import { installContributors } from "./contrib";
import { installLinkKinds } from "./links";
import { installKnowledgeJobs } from "./jobs";
import { installCaptureSubscribers } from "./capture";
import { openVersion } from "./versions";
import { registerKnowledgeAiFeatures, knowledgeAiCapabilities } from "./ai";
import { seedKnowledgeDefaultsIn } from "./seed";
import { installKbTemplateBlock } from "./suggest";

let installed = false;

export async function seedKnowledgeDefaults(cfg: JobConfig, orgId: string, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = await systemCtx(cfg, orgId);
  return sys.write((tx) => seedKnowledgeDefaultsIn(tx, sys, opts));
}

/** Published blocks of a text, split by who may see them (for the AI index, as the system). */
async function blocksFor(q: Queryable, sys: Ctx, md: string): Promise<{ public: string[]; internal: string[] }> {
  const refs = blockRefs(md);
  if (!refs.length) return { public: [], internal: [] };
  const rows = await liveRows(q, sys, "kb_block", { and: [{ f: "number", op: "in", v: refs }, { f: "state", op: "eq", v: "published" }] }, { limit: 200 });
  return { public: rows.filter((b) => !b.confidential).map((b) => String(b.body ?? "")), internal: rows.filter((b) => b.confidential).map((b) => String(b.body ?? "")) };
}

function installRagSources(): void {
  registerRagSource({
    table: "kb_article",
    // k2: attachments indexed with the article (re-indexes every article once)
    version: "k2",
    async build({ ctx, q, row }) {
      if (!LIVE_STATES.includes(String(row.state))) return null;
      const base = await baseOf(q, ctx, row.base_id);
      const agentsOnly = row.ai_requesters === false || base?.ai_requesters === false;
      const group = agentsOnly ? ("internal" as const) : null;
      const title = String(row.title ?? "").trim();
      const parts: RagPart[] = [];
      if (row.summary) parts.push({ field: "summary", label: "خلاصه", text: String(row.summary), group, format: "text" });
      if (row.ai_use !== "link_only") {
        const body = String(row.body ?? "");
        const internal = String(row.internal_body ?? "");
        const blocks = await blocksFor(q, ctx, `${body}\n${internal}`);
        const strip = (s: string) => s.replace(/\{\{\s*block\s*:[^}]*\}\}/g, "");
        if (body.trim() || blocks.public.length) parts.push({ field: "body", label: "متن", text: [strip(body), ...blocks.public].join("\n\n"), group, format: "markdown" });
        if (internal.trim() || blocks.internal.length) parts.push({ field: "internal_body", label: "بخش داخلی", text: [strip(internal), ...blocks.internal].join("\n\n"), group: "internal", format: "markdown" });
        const kw = Array.isArray(row.keywords) ? (row.keywords as string[]).filter(Boolean) : [];
        if (kw.length) parts.push({ field: "keywords", label: "کلیدواژه‌ها", text: kw.join("، "), group, format: "text" });
      }
      if (!parts.length && title) parts.push({ field: "title", label: "عنوان", text: title, group, format: "text" });
      // attachments (KB-010) answer with the article's audience; «فقط ارجاع» leaves them out like the body
      const attachments = row.ai_use === "link_only" ? (false as const) : { group };
      return { title, titleField: "title", titleGroup: group, number: (row.number as string) ?? null, lang: (row.language as string) ?? null, parts, attachments };
    },
    path: (id) => `knowledge/a/${id}`,
    aiWhere: (t) =>
      `${t}.state in ('published', 'pending_retirement') and coalesce(${t}.ai_use, 'answer') <> 'none' and coalesce(${t}.classification, '') <> 'secret' and exists (select 1 from sm_kb_bases kb where kb.id = ${t}.base_id and kb.org_id = ${t}.org_id and kb.deleted_at is null and kb.ai_enabled and coalesce(kb.classification, '') <> 'secret')`,
  });
  registerRagSource({
    table: "kb_snippet",
    version: "s1",
    async build({ ctx, q, row }) {
      if (row.state !== "published") return null;
      const base = row.base_id ? await baseOf(q, ctx, row.base_id) : null;
      const group = base?.ai_requesters === false ? ("internal" as const) : null;
      return { title: String(row.question ?? ""), titleField: "question", titleGroup: group, number: (row.number as string) ?? null, lang: (row.language as string) ?? null, parts: [{ field: "answer", label: "پاسخ", text: String(row.answer ?? ""), group, format: "text" }] };
    },
    path: (id) => `knowledge/snippets/${id}`,
    aiWhere: (t) =>
      `${t}.state = 'published' and (${t}.valid_to is null or ${t}.valid_to >= current_date) and (${t}.base_id is null or exists (select 1 from sm_kb_bases kb where kb.id = ${t}.base_id and kb.org_id = ${t}.org_id and kb.deleted_at is null and kb.ai_enabled and coalesce(kb.classification, '') <> 'secret'))`,
  });
}

export function installKnowledgeModule(): void {
  if (installed) return;
  installed = true;
  installKnowledgeHooks();
  installContributors();
  installLinkKinds();
  installKnowledgeJobs();
  installCaptureSubscribers();
  installRagSources();
  installKbTemplateBlock();
  registerKnowledgeAiFeatures();
  registerRecordMeta("kb_article", async ({ q, ctx, row }) => {
    const base = await baseOf(q, ctx, row.base_id);
    const category = row.category_id ? await categoryOf(q, ctx, row.category_id) : null;
    const contributor = contributesTo(ctx, base, { category, article: row as Row });
    const open = contributor ? await openVersion(q as never, ctx, String(row.id)) : null;
    return { knowledge: { contributor, draft: open ? { id: open.id, state: open.state, version_label: open.version_label ?? null } : null, base: base ? { id: base.id, name: base.name, kind: base.kind, retire_approval: !!base.retire_approval } : null, ai: knowledgeAiCapabilities() } };
  });
  registerJobHandler("kb.seed", async (job, jctx) => {
    if (!job.org_id) return;
    await seedKnowledgeDefaults(jctx.cfg, job.org_id);
  });
  registerOrgSeed((tx, orgId) => enqueue(tx, { kind: "kb.seed", orgId, delayMs: SEED_DELAY_MS + 120_000, dedupeKey: "kb.seed", maxAttempts: 5 }).then(() => undefined));
}

export { seedKnowledgeDefaultsIn, KNOWLEDGE_SEED_VERSION, BUILTIN_TEMPLATES } from "./seed";
export { createArticleIn, newDraftIn, publishIn, submitVersion, diffVersions, openVersion, type NewArticleInput } from "./versions";
export { searchKnowledge, cardsByIds, cardOf, labelsOf, expandTerms, normExpr } from "./search";
export { readArticle, expandBlocks } from "./render";
export { vote, rate, flagArticle, reportGap, deflect, topicSignature } from "./feedback";
export { attachArticle, detachArticle, linkedArticles, recountReuse, reuseOf, KB_LINK_KINDS, REUSE_KINDS, type KbLinkKind } from "./links";
export { captureFromRecord, articleFromKnownError, draftOfRecord } from "./capture";
export { retireArticle, restoreArticle, reviewArticle, reownArticles } from "./lifecycle";
export { checkVersion, computeHealth, findDuplicates, integrityChecks, sampleAqi, detectGaps } from "./quality";
export { kbHome, kbDashboard, kbWorkspace } from "./dashboard";
export { kbSweep, ensureKbSweep, resetKbSweepThrottle, KB_SWEEP_EVERY, type KbSweepResult } from "./jobs";
export { acknowledge, myAttestations, attestationStatus, audienceOf, remindAttestations } from "./attest";
export { explainAccess } from "./explain";
export { licenceLevel, coachesOf, runPublishingModels } from "./kcs";
export { registerKnowledgeAi, knowledgeAi, knowledgeAiCapabilities, writeAssist, translateDraft, draftWithAi, WRITE_ACTIONS, type KnowledgeAi, type WriteAction } from "./ai";
export { recountFeedback, approversFor } from "./hooks";
export { kbConfig, contributesTo, managesBase, isKbAdmin, holdsInternal } from "./common";
export { logEvent, queryStats, recentlyViewed } from "./events";
export { suggestForRecord, suggestForText } from "./suggest";
