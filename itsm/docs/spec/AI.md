# The AI layer

The organisation brings its own models — cloud services, domestic gateways or models on its own computers — and every
AI feature of the product runs on them. One promise holds everywhere: **AI never reveals anything outside the asking
member's access** (org tree, roles, data scopes, workspaces, field groups, confidential rows). This document is the
contract for later modules and agents. Persian admin and user guide: `docs/AI_FA.md`.

Code: `src/shared/ai` (contracts: `types.ts`, `api.ts`, `rag.ts`; Persian text services `text.ts`; presets, prices,
errors), `src/server/modules/ai` (connections, adapters, chain, usage, settings, assistant, tools, proposals, relay,
redaction) and `src/server/modules/ai/rag` (index, retrieval, cited answers, smart documents), `src/server/routes/ai.ts`
and `ai-rag.ts`, `src/ui/ai` (assistant, settings, `ask/` — the cited-answer UI), `src/ui/modules/docs` (the library).
Tests: `tests/ai-*.test.ts`, retrieval `tests/ai-rag-*.test.ts`, skills `tests/ai-skills-*.test.ts`.

Contents: [1 Connections and capabilities](#1-connections-and-capabilities) · [2 The index](#2-the-index) ·
[3 Declaring RAG documents](#3-declaring-rag-documents) · [4 retrieve()](#4-retrieve) ·
[5 askWithCitations()](#5-askwithcitations) · [6 Smart documents](#6-smart-documents) ·
[7 Permission rules](#7-permission-rules) · [8 HTTP API](#8-http-api) · [9 UI](#9-ui) · [10 Testing](#10-testing) ·
[11 Skills, agents and tools](#11-skills-agents-and-tools) · [12 Not built yet](#12-not-built-yet)

---

## 1. Connections and capabilities

A connection (`sm_ai_connections`, local to each runtime, key sealed with AES-256-GCM) is a provider preset
(`src/shared/ai/presets.ts`), a base URL, a write-only key and the models of each capability:

| Capability | Where it is configured | Used by |
| --- | --- | --- |
| **chat** — tiers `smart`, `fast`, `vision` | the connection's model rows; jobs `assistant`, `analysis`, `fast`, `vision` map to chains in «کارها و مدل‌ها» | the assistant (`agent.ts`), `generate()` (`engine.ts`) for module features, cited answers, re-ranking, summaries |
| **embed** — `{ model, dims, api }` | the connection's «مدل بردارسازی» (optional; the only model of an embedding-only preset) and «نمایه و بازیابی» → «اتصال بردارسازی» | the index (`rag/embed.ts`) |
| **vision** — images and PDFs | the `vision` tier; presets declare `media: { images, pdf }` | OCR of scanned documents and images, questions with files |

- Chat goes through `runTurn` (`chain.ts`): the job's chain with fallbacks, one retry of passing failures, holds per
  (connection, model) in `sm_ai_holds` on rate limits and quotas, budgets (`assertUsable`), the usage ledger
  (`recordUsage`), the data policy (`redact.ts`), and on the Windows app the web version's connections (`relay.ts`).
  Module features call `generate(ctx, { job, feature, system, prompt, schema?, attachments?, onText? })` and register
  their ledger label with `registerAiFeature(label, switch)`.
- Embeddings go through `embedTexts(ctx, embedder, texts, kind)`: Persian normalisation (`normalizeFa`) and the data
  policy before anything leaves (local presets excepted), batches per API style, one retry of passing failures, the same
  holds and budgets, usage under feature `rag_embed`. API styles (`adapters/embed.ts`): OpenAI-compatible
  `/embeddings` (OpenAI, Ollama, LM Studio, llama.cpp, vLLM, Together, Mistral, DashScope, the domestic gateways), Jina
  (the same with `task`), Gemini `batchEmbedContents` (`taskType`, `outputDimensionality`), Voyage (`input_type`,
  `output_dimension`) and Cohere `/v2/embed` (`input_type`, `embedding_types`). A batch refused as invalid is retried
  text by text, so one bad text never blocks the rest. Anthropic has no embeddings (pair it with any embedding preset).
- The active embedder (`activeEmbedder`) is the connection named in the settings, else the first enabled connection
  with an embedding model. Its key is `<preset>:<model>:<dims|n>`; vectors are comparable only within one key. A change
  of key (settings or connection saved) queues `rag.embed`, which re-embeds every chunk in the background; until then
  full text and the local vectors answer.
- Test mode (`ITSM_AI_FAKE=1`): the `fake` preset answers deterministically (`adapters/fake.ts`) — including grounded,
  cited answers from a `<data name="sources">` block — and embeds with `api: "fake"` (folded local vectors;
  `[embed-error:KIND]` in a text simulates provider errors).

## 2. The index

Each runtime indexes the records **it holds** (the Windows app only what its linked account may read) into local
tables (migration `0020_ai_rag`, listed as local in `tests/sync-registry.test.ts`):

| Table | What |
| --- | --- |
| `sm_ai_rag_docs` | one row per indexed record: version, content hash, title line, chunk count, status ok/empty/error, the provider key of its vectors, `vec_pending`, access anchors |
| `sm_ai_chunks` | chunks (`kind` chunk or parent): table, record, `fields`, `groups` (field groups whose values the chunk holds), heading, page anchors, language, text, `norm` (search form) with a generated `tsvector`, content hash, record version, anchors (workspace, unit, domain), the local vector and the provider vector with its key |
| `sm_ai_doc_pages` | text read from smart documents, page by page (per runtime) |
| `sm_ai_rag_runs` | backfills, re-embedding and reconciliation runs (the admin page) |

**Vector backend** (`store.ts`, chosen once per database, reported on the admin page): pgvector when the database has
it — Supabase (`create extension vector`, schema-qualified type and operator), PGlite with
`@electric-sql/pglite-pgvector` (loaded by `createPgliteDb`, shipped by `scripts/build-desktop.mjs`). The vector columns
`lvec_v vector(384)` and `vec_v vector` are added at startup; search is exact, and once an embedding key (or the local
vectors) has `ANN_MIN_ROWS` (20 000) chunks an HNSW index is created per key (`((vec_v::vector(d)) vector_cosine_ops)
where vec_key = '<key>'`, d ≤ 2000) and queried with `hnsw.iterative_scan = relaxed_order` so filters keep recall.
Without pgvector the **portable store** keeps `real[]` arrays and compares vectors in the server over the
access-filtered candidates (full text, LIKE, the newest 300 chunks). `forceStoreBackend(db, "portable")` runs a
database that way (desktop parity tests).

**Full text**: `to_tsvector('simple', norm)` over the search form (`searchForm`: lower-case, ي/ى → ی، ك → ک, digits
→ Latin, diacritics and tatweel removed, ZWNJ joined, hamza seats, «ة»، «ۀ»، «آ» folded, punctuation as spaces, identifiers
kept); queries are stop-word-free terms (`queryTerms`), lightly stemmed (`stem`) and prefix-matched (`term:*`, OR);
a LIKE fallback catches parts of words when full text finds little.

**Local embedder** (`local-embed.ts`): hashed words, word pairs and character 3/4-grams of the search form, signed
FNV-1a into 384 dimensions, log-damped, unit length — deterministic, offline, no model; stored for every chunk (key
`local:hash-v1:384`). The UI shows it as «کیفیت پایه».

**Chunking** (`chunker.ts`): text of different field groups is never mixed (one partition per group; the title, which
prefixes every chunk's embedded text, adds its own group); markdown headings form a breadcrumb; lists, tables and code
stay whole; chunks of ~700 tokens (sections merged up to ~350, never across pages, and text without a page — a
document's summary — never shares a chunk with a page, so a citation's page holds for its whole passage), up to 80
tokens of overlap inside a
section, long blocks split by sentences; a section split over several chunks gets a `parent` chunk (small-to-big:
answers carry the section). Passages keep the text as written; embedding and search normalise it.

**Indexer** (`indexer.ts`), always as the system, outside write transactions:

- `record.created/updated/deleted` events of indexed tables (subscriber `ai.rag`; never throws — a failure is retried by
  `rag.index`) → `indexRecord`: build the document, skip it when the content hash is unchanged (only version and
  anchors move), chunk, reuse the provider vectors of unchanged chunks, embed the rest (local always; provider when it
  answers, else `vec_pending` and `rag.embed` later), replace the record's chunks in one transaction.
- `rag.backfill` (a table or everything, resumable; «بازسازی»), `rag.embed` (missing vectors, model changes),
  `rag.reconcile` (nightly at 02:30 organisation time and on demand: removes chunks of deleted records and of tables no
  longer indexed — fail closed —, indexes missing, stale and failed records, re-keys moved access anchors, creates ANN
  indexes), `rag.sweep` (Windows app, every 3 minutes: records the sync pull changed — pulls emit no events).

**Freshness is enforced at query time**: a chunk is served only while its version equals the record's current version
(`c.version = t.version`), and readability is evaluated live against the source row (§7) — a record that leaves a
member's scope, gets a new requester or becomes confidential is out of their answers at once, before any re-index.

## 3. Declaring RAG documents

A table is indexed when it has a registered builder, or `ai` without `features.rag: false`, or `features.rag: true`:

```ts
// src/shared/tables/<module>.ts
{
  key: "kb_article", …,
  fields: [
    { name: "body", type: "markdown", … },
    { name: "internal_notes", type: "text", group: "internal" },          // its own partition: agents only
    { name: "author_phone", type: "string", ai: { index: true, redact: true } }, // indexed masked (***1234)
    { name: "draft_reason", type: "text", ai: { index: false } },          // never indexed
  ],
  features: { rag: true },
  ai: { title: "title", text: ["body", "internal_notes"] },
}
```

- Default document (`defaultDocument`): the title field (`ai.title`, else `display`) and the text fields of `ai.text` plus
  fields with `ai: { index: true }`; never `secret` fields, fields of the `ai_private` group or `ai.index: false`.
  `ai.redact` masks identifiers (`maskText`) before indexing.
- A module's own builder (`registerRagSource`) for documents that are not plain fields — pages, digests, related text:

```ts
import { registerRagSource } from "@server/modules/ai/rag";
registerRagSource({
  table: "kb_article",
  version: "k1",                                   // bump to re-index every record of the table once
  async build({ ctx, q, def, row }) {              // system context, any read through `q`
    return { title: row.title, titleField: "title", number: row.number, parts: [
      { field: "body", label: "متن", text: row.body, group: null, format: "markdown" },
      { field: "resolution", label: "راه‌حل", text: digest, group: "internal" },
    ] };
  },
  path: (id, { page, chunk }) => `kb/${id}`,       // where a citation opens (default r/<table>/<id>)
  aiWhere: (t, params) => `${t}.state = 'published'`, // AI-channel rule on the source row, evaluated live
  aiChannel: (t, params) => `${t}.ai_use <> 'none'`,  // the record's own AI use, whatever its state: no skill reads
});                                                   // it when false (default: aiWhere)
```

- **Attachments** (`ai: { …, attachments: true }` on a table with `features.attachments`, KB-010): the text of the
  record's attached files (PDF, Word, Excel, CSV, HTML, text; not images — OCR is per runtime) is part of its document,
  a part per file and page (`field: "attachment:<id>"`, label «پیوست «name»»), cited to the record and answered only to
  those who may read the record (no field group unless the builder says otherwise). At most
  `ATTACHMENT_LIMITS` (20 files, 15 MB each, 200 000 characters per file); a content a Windows app has not fetched yet
  is read at the next index. Adding or removing a file emits `record.attachment_added` / `record.attachment_removed`
  and the record is re-indexed. A builder decides per record: `attachments: false` leaves them out (a «فقط ارجاع»
  article), `attachments: { group: "internal" }` puts their text in a field group (an article answering agents only),
  `attachments: { files: [{ id, group }] }` indexes only those files, each in its group. A table that shows each reader
  only some of its files (`filterSide`) indexes only the files its builder names — never one the attachments API would
  hide: a knowledge article indexes the files its body shows (with the article's audience) and those only its internal
  part shows (group `internal`), and nothing else.

Every part carries its field group; a part whose field is not a real field of the table (e.g. `content` pages) is
governed by the record's readability only. Builders must be deterministic (the hash decides re-indexing).

## 4. retrieve()

```ts
import { retrieve } from "@server/modules/ai/rag";
const { passages, info } = await retrieve(ctx, "VPN خطای 619", {
  tables?, collections?, documents?, records?: [{ table, id }], k?, rerank?, signal?,
});
// passages: [{ n, chunk_id, text, heading, score, context /* the section, for prompts */, version,
//              citation: { n, table, table_label, id, number, title, field, field_label, page, page_end, path, chunk_id } }]
// info: { backend, embedder, quality: "provider" | "local", lists: { fts, vector, local, like }, reranked, ms }
```

1. **Candidates** — up to 60 per list, each list one SQL statement that joins every chunk to its source row and keeps
   only: the organisation; readable rows (`readable(ctx, def, "t", …)`: the provider's predicate with tenant isolation,
   `TableDef.rowAccess`, live rows); chunks whose `groups` the member carries (`hasFieldGroup`, never `ai_private`); the
   record's current version; the source's AI-channel rule (`aiWhere`); the scope. Lists: full text, LIKE, the
   provider vector (when an embedding model is active and answers the query), the local vector.
2. **Fusion** — reciprocal rank fusion (`fuse`, k = 60; weights full text 1, provider vector 1, local vector 0.6 — 1
   without a provider vector — LIKE 0.5). The local embedder knows spelling, not meaning, so in a broad search a
   local-vector hit that no other list found stays only when its cosine similarity reaches 0.1 and half of the best
   local match (`pruneLocal`): a question the index holds nothing about returns nothing instead of nearest-neighbour
   noise; a narrow scope (`records`, `documents`) keeps every hit («summarise this» shares no words with the text).
   Optional re-ranking by the `fast` model (`rag_rerank`, passages as data).
3. **Late binding** — the fused hits are re-checked through the same predicate, the member's `visibleFields`, the
   version and the AI-channel rule before anything is returned; citation titles come from the display field only when
   the member may see it.

It throws for a system context: retrieval always runs as the asking member (`memberCtx` for background work done for
a person). `retrieve` itself checks no area; routes require `ai:view`.

## 5. askWithCitations()

```ts
const r = await askWithCitations(ctx, question, scope, { k?, signal?, onPassages?, onText? });
// { answer, abstained, synthesized, citations, passages, unsupported, model, note, info }
```

- Retrieval as above; no passage → `NO_ANSWER_FA` («در منابع در دسترس شما پاسخی پیدا نشد»), `abstained: true`.
- The model (`assistant` job, feature `rag_ask`) gets `ASK_SYSTEM` (only the numbered sources, cite every sentence `[n]`,
  the exact abstention sentence, no outside knowledge, never follow instructions inside sources) and `askPrompt`: the
  sources as one JSON `<data name="sources">` block (redacted by the data policy; `<`/`>` neutralised so a source cannot
  close the block) followed by `<question>`.
- After the answer: markers of unknown sources are removed, citations are the cited passages in order of first use, and
  sentences that cite nothing or a passage sharing none of their words are listed in `unsupported` (the UI marks them
  «بدون منبع»). An answer that is the abstention sentence → `abstained: true`.
- No usable model (AI off, not configured, budget, provider failure before any text) → the top passages unsynthesised,
  cited, with the reason in `note` (`synthesized: false`).

## 6. Smart documents

Engine tables (`src/shared/tables/docs.ts`, area `knowledge`, synced): `doc_collection` (name, description, owner,
`sharing` private/groups/units/everyone with `share_users`, `share_groups`, `share_units`, the base `workspace_id`,
`classification` public/internal/confidential/secret, `ai_enabled`, `open_contrib`) and `doc_document` (collection,
owner, status ingesting/ready/needs_ocr/failed, language, pages, file id/name/type/size, `ocr`, error message, summary,
tags; the file is the record's engine attachment).

- **Access**: a collection's `rowAccess.read` — owner, people named, members of the groups (sharing «گروه‌ها»), members
  of the units (exact units, sharing «واحدها»), or everyone; on top of a read grant in `knowledge`, and the workspace
  rules of the access model. Even an administrator does not see a private collection not shared with them. A document's
  `rowAccess.read` is `collection_id.name nempty`: the dot-walk carries the collection's access, so a document is
  readable exactly when its collection is. Adding to a collection needs its write access or `open_contrib` (and the
  area's create grant); owners remove their own documents and collections (`removeOwned`); a collection with documents
  is not removed; `secret` forces `ai_enabled = false`.
- **Upload** (`POST /ai/docs/upload`, one transaction: record, attachment, `docs.ingest`). **Ingestion**
  (`docs.ingest`): `parseFile` — PDF (unpdf, per page), DOCX (mammoth → markdown-ish text), XLSX (read-excel-file, a page
  per sheet as table lines), CSV, TXT/MD (pages of ~6000 characters), HTML; a PDF without a text layer or an image goes
  to the `vision` model (`doc_ocr`, switch «فایل و تصویر», ≤ 12 MB, PDFs only through presets that read PDFs) or stays
  `needs_ocr`; an optional summary by the `fast` model (`doc_summary`, setting «خلاصهٔ اسناد»); the record's status,
  pages, language, OCR flag and message are updated as the system, which re-indexes it. A document that arrives by sync
  is read again where it arrives (scans only where a vision model reads them).
- **AI-channel rule**: documents of collections with `ai_enabled = false` or `classification = 'secret'` are never
  retrieved (checked live with every question). Citations open `docs/d/<id>?page=<n>&hl=<chunk>`; the viewer highlights
  the cited paragraphs (`GET /ai/docs/:id/pages?chunk=`).

## 7. Permission rules

1. Retrieval and answers run with the **asking member's context** — never `systemCtx` (`retrieve` refuses it).
2. **Early binding**: every candidate query joins chunks to their source rows through `readable(ctx, …)` in the same
   SQL. **Late binding**: the final hits are re-checked through the same predicate and the member's visible fields.
3. **Field groups**: a chunk holds values of exactly one field group (plus the title's); it is returned only when the
   member carries every group in `chunks.groups`. `ai_private` and `secret` values are never indexed.
4. **Citations only to readable records**; titles only from visible display fields; counts are never taken from
   pre-filtered candidates (the admin page counts index rows, not what members could read).
5. **Fail closed**: a stale chunk (older version) is not served; chunks of unknown tables are removed by reconciliation;
   an AI-channel rule that does not hold excludes the record; an unavailable embedding model degrades to full text and
   local vectors, never to a wider search.
6. **Untrusted text**: record and document text reaches models only inside data blocks, under instructions that forbid
   following it; the data policy masks identifiers before anything leaves for an external provider.
7. Admin views show only what the admin may read (the collections list of «نمایه و بازیابی» is access-filtered).

## 8. HTTP API

Under `/api/o/:org/ai` (contracts in `src/shared/ai/rag.ts`):

| Method and path | Who | Body / answer |
| --- | --- | --- |
| `POST /ask` | ai:view | `{ question, scope?, k? }` → `AiAskResult` |
| `POST /ask/stream` | ai:view | same → SSE `passages`, `text`…, `done` (`AiAskResult`) or `error` |
| `POST /retrieve` | ai:view | `{ query, scope?, k?, rerank? }` → `{ passages, info }` |
| `GET /rag/status` | ai:full | `AiRagStatus`: backend, embedder and its problem, tables, readable collections, runs, pending vectors |
| `POST /rag/rebuild` | ai:full | `{ table?, force? }` → `{ queued }` |
| `POST /rag/reconcile` | ai:full | → `{ queued }` |
| `POST /docs/upload` | collection write or `open_contrib` | multipart `collection_id`, `file`, `title?` → `{ document }` |
| `GET /docs/:id/pages` | reads the document | `?chunk=` → `AiDocPages` (+ `highlight`) |
| `POST /docs/:id/reingest` | writes it or owns it | → `{ ok }` |
| `DELETE /docs/:id`, `DELETE /docs/collections/:id` | delete grant or owner | → `{ ok }` |

Settings: `PUT /ai/settings { rag: { enabled, embed_connection_id, rerank, summaries, top_k } }` (ai:full). Connections:
`embed: { model, dims, api? } | null` on `POST`/`PATCH /ai/connections`; «آزمایش اتصال» adds a row for the embedding
model.

## 9. UI

- `<AskPanel scope? placeholder? initialQuestion? intro? compact? disabledReason? />` (`src/ui/ai/ask/AskPanel.tsx`):
  streams passages then the answer, `[n]` markers open the cited passage, sources listed with their labels, «بدون منبع»,
  «جست‌وجوی پایه» when only the local embedder answered, AI text labelled. Modules embed it with their scope, e.g. a
  knowledge base `scope={{ tables: ["kb_article"] }}` or a record's context `scope={{ records: [{ table, id }] }}`.
- `src/ui/modules/docs`: «اسناد هوشمند» (`docs`), the viewer (`docs/d/:id`), «پرسش از اسناد» (`docs/ask`),
  «پرسش از هوش مصنوعی» (`ask`, `?q=` asks at once; also a command-palette row for every typed question), collection
  forms at `docs/collections` with UI policies for the sharing fields.
- «تنظیمات ← هوش مصنوعی ← نمایه و بازیابی» (`src/ui/ai/settings/Retrieval.tsx`) and the «مدل بردارسازی» row of the
  connection sheet. Pure logic: `src/ui/ai/ask/model.ts`.

## 10. Testing

`ai-rag-text` (normaliser, search form, terms, stems, chunker, local embedder, fusion, tsquery, parsers, citation
checks, prompt wrapping), `ai-rag-embed` (each API style's request against stubbed HTTP, error classes, the connection
capability, settings), `ai-rag-index` (indexing by events, hash skip, deletes, stale versions, hybrid retrieval on
pgvector and the portable store, provider vectors with holds and re-embedding, reconciliation, backfill),
`ai-rag-leak` (canary records — a unique token per field group — probed by every built-in role on a hand-built
organisation and by every member of seeded random organisations, through `retrieve`, `askWithCitations` with the fake
model and HTTP; prompt injection stays data), `ai-rag-docs` (sharing, uploads, PDF pages, OCR, answers over
collections, AI-channel rule, owners), `ai-rag-ui` (UI logic and shell entries).

A module that indexes a table adds its canaries to a leak test: register the table (fixture), create records with a
unique token per field group in the access situations the module adds, drain the jobs, and assert with `probe`-style
checks (`tests/ai-rag-leak.test.ts`) that every returned record is in `readableIds(ctx, table, ids)` and no token of a
group the member lacks appears.

## 11. Skills, agents and tools

A **skill** (catalogue AI-006/007/154/155/159/164/165/169/170) is a prompt-backed feature: inputs read from a record,
a versioned prompt, a model tier, an output kind with its schema, optional grounding, triggers and who may use it.
Code: `src/shared/ai/skills.ts` (contracts, labels, templates, the line diff, JSON checks, eval scoring),
`src/shared/tables/ai.ts` (tables), `src/server/modules/ai/skills` (registry, configuration, runtime, proposals,
triggers, service member, administration, `builtin/` — every built-in skill and the modules' extension points they
implement), `src/server/routes/ai-skills.ts` (HTTP), `src/ui/ai/skills` (record panel, inline AI, admin). Tests:
`tests/ai-skills-*.test.ts`.

### 11.1 Tables

| Key | Synced | What |
| --- | --- | --- |
| `ai_skill` | yes | the organisation's configuration of a skill: `key`, Persian `name`/`description`, `module`, `base_key` (the built-in it is or copies), `builtin`, `enabled`, `target`, `output`, `tables`, `tier`, `grounding` + `grounding_k` + `collections`, `triggers` (manual / event / schedule), `events`, `condition` (a condition on the record), `schedule_minutes` + `schedule_filter`, `roles`, `field_groups` (groups whose values may reach the model — never `ai_private`), `auto_apply`, `daily_limit`, `user_daily_limit`, `active_version_id` |
| `ai_skill_version` | yes | a prompt: `system`, `template`, `output_schema` (JSON Schema, structured outputs only), `temperature`, `max_tokens`, `note` (change note), `revision`, `state` draft / published / retired, `published_at/by` |
| `ai_skill_eval` | yes | an offline evaluation set of a skill: `cases` (input — record, text or parameters — and expected properties), `last_score`, `last_results`, `last_model`, `last_run_at` |
| `ai_skill_run` | **no** (local, like the usage ledger) | one run: invoker, principal (person / service), skill and version, table and record, `input_hash` (of the exact model input), params, status ok / fallback / error, output text or JSON, citations, model, connection, tokens, cost, latency, proposal, feedback (1 / −1) and comment |

All in area `ai`. Whatever a role grants there, only AI administrators (`ai:full`) or the platform change skills,
versions and evaluation sets — a hook holds every write path (`skills/hooks.ts`): keys never change, a built-in's row
is not deleted (switch it off), a published version is never edited. `ai_skill_run` has the row rule
`invoker_id is_me` and is written only by the runtime (as the system on the invoker's behalf): a summary built from
fields its author could see never becomes readable by anyone else through the record API. AI administrators see
everyone's runs only through `GET /ai/skills/runs?all=1`. A run keeps what it read (`clearance`, the proposals' tokens
below); the runs list shows its output — text, structured answer, sources, record and the feedback's comment — only to
a caller who may read its record and everything it read now, its author included, and otherwise only its metadata
(skill, status, model, tokens, cost, time, rating; `restricted: true`). A run stored before runs kept what they read
shows its output only to its author.

### 11.2 Built-in skills, copies and versions

Built-in skills live in code (`registerSkill(defineSkill({...}))`, `builtin/*.ts`) with their default prompts in
Persian. The admin page seeds one `ai_skill` row per built-in idempotently (configuration only); until an organisation
publishes a version of its own the runtime uses the code's prompts, so improved defaults reach everyone. An
organisation writes a version (a draft), test-runs it, publishes it (the previous one retires), compares any two
versions line by line and rolls back to an earlier version or to the built-in default. «رونوشت» copies a skill under
a key of the organisation's own (`org.brief`), with its configuration and current prompt as version 1, switched off
until enabled. A copy keeps its base's output kind, inputs and code hooks.

A module declares a skill like this:

```ts
registerSkill(defineSkill({
  key: "incident.resolution", name: "پیش‌نویس یادداشت حل", description: "…", module: "incident",
  target: "record", tables: ["incident"], output: "fields", outputFields: ["close_notes", "close_code"],
  tier: "standard", grounding: { kind: "similar", k: 3 },
  inputs: { journal: "all", related: [{ table: "incident_task", field: "incident_id", label: "کارها" }] },
  roles: ["agent"], fieldGroups: ["internal"], surfaces: ["panel"],
  system: "کار تو: …", template: "رخداد:\n{{record}}\n\nیادداشت‌ها:\n{{journal}}\n\nگزینه‌ها:\n{{options}}",
  factKeys: ["options"], facts: async (ctx, input) => ({ options: … }),     // computed with the caller's ctx
  fallback: async (ctx, input) => ({ text: … }),                             // the rule-based answer (optional)
  post: async (ctx, out, input) => out,                                       // map names to readable ids (optional)
}));
```

- **Targets**: `record` (a record of `tables`, `"*"` narrowed by `when(def)`), `text` (a piece of text — the composer,
  a field, the KB editor — with an optional record for context) or `none` (parameters only, e.g. the shift handover).
- **Outputs**: `text` (Markdown, streamed), `json` (validated against the zod schema, or the version's JSON Schema),
  `fields` (`{ suggestions: [{ field, value, confidence, reason }] }` over `outputFields`), `journal` (a reply or an
  internal note), `record` (a new record's draft).
- **Tiers** map to the jobs' chains: fast → «fast», standard → «assistant», reasoning → «analysis».
- **Grounding**: `similar` (records of the same table), `knowledge` (articles and snippets) or `documents` (smart
  documents, optionally chosen collections), `k` passages — always `retrieve` with the caller's context.
- **Placeholders** (`renderTemplate`): `{{record}}`, `{{record.<field>}}`, `{{journal}}`, `{{related}}`,
  `{{links}}`, `{{passages}}`, `{{text}}`, `{{params}}`, `{{params.<name>}}`, `{{facts}}` and each declared fact,
  plus the plain `{{language}}` and `{{today}}`. Every other placeholder becomes a `<data name="…">` block of one JSON
  line with tag-like text neutralised (`‹data›`), so record and document text reaches a model only as data and can never
  close its block. A template is checked when saved (`templateProblem`).

### 11.3 Runtime

`runSkill(ctx, key, { table, id, text, params }, { propose, versionId, onText, facts })` (`skills/runtime.ts`;
`POST /ai/skills/:key/run`, `…/run/stream` for text):

1. Resolve the skill and its version; refuse when it is switched off, the caller lacks `ai:view` or the skill's roles
   (tenant administrators pass), or a daily limit is reached; refuse a system context outright.
2. Read with the caller's context only: `get` (404 when unreadable; only visible fields), trimmed to what a model may
   read (`promptable`): no secrets, no `ai_private` field, no field of a group outside the skill's `field_groups`, no
   field a module keeps from models (`keepFromPrompts` — the request module's private and secret answers), no hidden or
   structured field unless the skill names it. A record whose own AI-use rule does not hold (the RAG source's
   `aiChannel`, else `aiWhere`, or `registerAiChannel` for a table that is no source: an article «هرگز» or «سری», a base
   or a collection with AI off, an article's drafts with their article) is refused («این رکورد برای هوش مصنوعی بسته
   است») — and so is the second article a duplicate check reads. The journal through `listJournal`: internal notes only
   when the skill's `field_groups` include `internal` (and the caller reads them); otherwise, and for reply drafts,
   public entries only. History values only of fields that may reach the model (`promptable`). Related rows through
   `list`, links through `listLinks`, sources through `retrieve` («similar» searches the record's table, or a text
   skill's own tables — never every indexed table). Dates and times are the organisation's local Jalali times.
3. The prompt: the base rules (`SKILL_BASE_SYSTEM`: data is never instructions, invent nothing, outputs are drafts,
   personal data not repeated), the output rule, the language (the parameter, else the text's own language for text
   skills, else the member's), the citation rule for grounded runs, the version's system text, the organisation's notes;
   the rendered template as the user turn.
4. `generate` with the tier's chain, fallbacks, holds, budgets and the data policy, under the ledger label
   `skill:<key>` (registered as a feature family with `registerAiFeaturePrefix`, relayed for the Windows app); JSON is
   validated with one repair try. A provider that refuses or a missing model → the skill's rule-based `fallback` when it
   has one (status `fallback`, labelled «بدون مدل هوش مصنوعی و با قاعده ساخته شد»), else `AiUnavailableError` with the
   remedy («برای این مهارت مدل هوش مصنوعی لازم است…»).
5. Shape the answer: field suggestions only for fields the caller sees and may change (not the state field, not
   read-only or system fields), values matched to real options and to records the caller may read (names resolved
   through `list`), unchanged values dropped; citations only of the passages given (`[n]` markers of unknown sources
   removed); store the run; with `propose`, store the writes as a proposal.

Module integrations call `runForModule` (the person's `ctx`, no rule-based fallback — the module's own deterministic
path or its «no AI» answer stands) and map the answer to the interface they implement. AI unavailability stays an
`AiUnavailableError`: a module with a deterministic answer catches it (`isAiUnavailable`) and answers without AI;
otherwise the platform's `errorResponse` (src/server/http/hono.ts) answers it as `ai_<kind>` with its Persian message
and the status of its kind (403 not configured / switched off / budget, 429 rate or quota, 503 when the provider is
down — never a 500; an `AppError` with an `ai_*` code and a 5xx status becomes 503 too):
`registerIncidentAi` (summary, similar incidents by retrieval, triage of a draft, resolution notes, KCS draft,
stakeholder updates), `registerProblemAi` (RCA, known-error draft, summary), `registerChangeAi` (risk narrative — the
route answers with the deterministic explanation and `ai: false` when no model can —, plan drafts, summary, the CAB
pack `change.cab_pack` and the PIR draft `change.pir`: the module's `cabPack` and `draftPir` treat «no AI» — no model,
a provider failure, a person who may not use the skill — as no AI and return their deterministic draft with
`ai: false`, so a draft is marked AI-written only when a model wrote it), `registerRequestAi` (catalogue item from text, order-form
pre-fill over `promptSafe` questions, item matching by retrieval, summary), `registerKnowledgeAi` (KCS draft over the
module's scrubbed capture, AQI pre-scoring, duplicate judge, metadata, validation; the editor's writing assistant runs
the generic writing skills), `registerCmdbAi` (relationship suggestions mapped to readable CIs, duplicate explanation,
quality narrative over computed facts, summary) and `registerPortfolioAi` (description, translation, health narrative
over the scorecard). Generic skills: `record.summary`, `record.history`, `reply.draft`, `note.draft`, `text.improve`,
`text.shorten`, `text.formal`, `text.tone`, `text.fix` (rule-based fallback), `text.translate`, `text.rewrite`. The
assistant's tool `shift_handover_summary` runs `incident.handover` as the caller.

### 11.4 Writes are proposals

A run's field suggestions, drafted note or drafted record become one row of `sm_ai_actions` tied to the record
(`record_table`, `record_id`, migration `0052_ai_skills`). Nothing changes until a person applies it
(`POST /ai/actions/:id/confirm`), and then through the record service with **that person's** context:
`skill.fields` refuses when one of the fields changed since the suggestion (snapshot), `skill.journal` posts the entry
as the person (a public reply is sent only because a person applied it), `skill.record` creates as the person. Who
sees such a proposal: whoever may read the record and every field involved now — the fields it changes and everything
the run read (the record's fields that reached the model, the skill's field groups, `internal` when internal notes were
read, every source with the field groups and fields of its passage, the rows the template showed through `{{related}}`
and `{{links}}`; tokens in `fields`: names, `@g:<group>`, `@f:<table>:<field>`, `@r:<table>:<id>`). An AI
administrator without that access does not see it; its author neither, once they lost the access. Who decides it
(apply or reject): someone who sees it and works the record — full write access (`writeMode` "full": not a reader, not
a requester's own fields), every field it changes writable, «internal» for an internal note, create rights for a
drafted record; `can_decide` tells the panel. A person refused by the record service (403) leaves it open for the
others. A proposer keeps one open proposal per skill, kind and record: the same one again is not stored twice, a
different one replaces it.

### 11.5 Triggered skills and the service member

Event- and schedule-triggered skills run as the organisation's **«دستیار هوش مصنوعی»** service member — a member
account that cannot sign in (no password, an `.invalid` address), created and given ITSM roles by the owner
(`POST /ai/skills/admin/principal`, through the access service: only owners grant roles, nobody grants above their own)
— never as the system. It is found by its membership, never by an address: a new one gets a random
`ai-assistant+<uuid>@service.invalid`, sign-up and invitations refuse every `.invalid` address (`isReservedEmail`),
an existing account is never adopted, and a member with a service address that can sign in (a password, a recovery
code or a session) is never taken for it — setting up refuses while one holds a membership. The subscriber `ai.skills` queues `ai.skill.run` (deduplicated per skill and record) for record
events of the configured kinds on the configured tables, on the runtime that applied the write (`via: "sync"` is
skipped) and never for the member's own writes; `ai.skills.schedule` (every 15 minutes while a scheduled skill exists)
queues the records of each due skill's filter, read with the member's access. The job checks the condition with the
member's access, runs the skill as the member (it reads only what its roles read; a record it cannot read is skipped),
applies only fields named in `auto_apply` with the member's own access (an internal note only with `work_note`; a
public reply never) and against the version it read (a change made while the model answered is never overwritten),
and stores the rest as a proposal on the record (valid seven days) — visible as above. Suggestions are only of fields
the member may change; whatever refuses the auto-apply (403, 409) leaves it in the proposal, and nothing after the
model's answer fails the job (a retry would run the model again). A schedule round skips records not changed since
the member last ran the skill on them.

### 11.6 Privacy, usage and evaluation

- Runs are private to their authors (§11.1); feedback (👍/👎, a comment) only by the author.
- Usage: every model call is in the ledger under `skill:<key>` within the organisation's budgets; per-skill limits
  `daily_limit` (organisation) and `user_daily_limit` (member) count the day's runs; `GET /ai/skills/admin/usage` sums
  runs, errors, rule-based answers, feedback, tokens, cost and latency per skill.
- Evaluation sets (`ai_skill_eval`) run from the admin with the organisation's model and the administrator's access
  (`noFallback`, not stored as runs); each expectation is a check (`contains`, `not_contains`, `min_chars`,
  `max_chars`, `json_keys`, `language`, `cites`) and the score is the share of checks passed (`scoreOutput`).

### 11.7 UI

- The record page's «هوش مصنوعی» side panel (`registerRecordExtensions("*")`, shown when the record meta says
  `ai_skills`): the skills of the table (unavailable ones with the reason and, for administrators, a link to the AI
  settings), parameters, the answer as it is written, sources, suggestions as a diff with the proposal to apply or
  refuse, feedback, the record's open proposals and the member's own runs. Every output carries «ساخته‌شده با هوش
  مصنوعی — پیش از استفاده بازبینی کنید» and its model, or the rule-based label.
- Inline: the composer's `aiDraft` slot (reply or note draft for the tab, writing tools on the text being written) and
  the writing tools in every Markdown field's toolbar (`registerFieldAssist`); the result replaces the text in the
  editor and nothing is posted or saved until the person does it. The KB editor's assistant runs the same skills.
- «تنظیمات ← هوش مصنوعی ← مهارت‌ها»: configuration, prompt editor with versions, diff and rollback, test run with the
  administrator's own access, evaluation sets and scores, usage, copies, and the service member's roles.

### 11.8 Tools, the assistant that operates the app, and agents

**Tools** (`src/server/modules/ai/tools`, catalogue AI-072/075). The platform registers a few generic tools
(organisation context, members, an exact calculator, charts, `search_knowledge` over `retrieve`) and, for EVERY table a
member may read, tools generated from its metadata (`tools/records.ts`, schemas from field types, choices with Persian
labels, references by display value, required fields): `search_<t>` (conditions in the engine's condition language,
sort, limit), `get_<t>` (visible fields only, the transitions the member may take), `aggregate_<t>` (Jalali buckets),
`history_<t>` (field history; internal notes only for those who read them) and, where the member may write and
proposals are on, `draft_create_<t>`, `draft_update_<t>`, `draft_transition_<t>`, `draft_batch_<t>`,
`draft_journal_entry`, `draft_link_records`. A table added later (release, DevOps, analytics…) is covered as it is;
configuration areas get read tools only; `excludeFromTools(table)` keeps a table out. Every tool runs the record service
with the CALLER's context — the engine repeats the route's checks — and returns only fields that may reach a model
(./fields.ts). A draft is checked by running the write and rolling it back, then stored as a proposal
(`sm_ai_actions`) that a person applies with their own access: `record.update` fails closed when a field moved or the
applier's access changed; `record.batch` («همهٔ … را ببند») is ONE proposal with a count, a sample and a plan,
applied row by row with per-row results. Tool results reach the model as `<data name="tool_result">` blocks (tag-like
text neutralised). Modules add tools with `registerTool` and executors with `registerProposalExecutor`; the AI layer
registers `change_risk`, `cmdb_impact` and `draft_order_catalog_item` (ordering for someone: a proposal placed through
the request module's ordering route by the confirming person) over the modules' services (`tools/modules.ts`).

**Tool retrieval** (`tools/select.ts`): a turn is offered every registered tool the member may use plus at most
`TOOLS_PER_TURN` generated tools that fit — the page's record or list (always first), record numbers in the question,
Persian keywords of the tables' and fields' labels, the local embedder's similarity; drafts only when the question asks
for a change, batches when it says «همه»; tools used earlier in the conversation stay. Nothing here widens access: the
catalogue holds only tools the member may use and every call checks again.

**The assistant operates the app** (`agent.ts`, `src/ui/ai/assistant`): the «دستیار» panel (Ctrl+J, the top bar's
button) with threads, streaming, citations and proposal cards — apply / edit in the form / reject, field diffs, a
batch's count and sample and, once applied, every row's result. The page context names the record of a record page
(every `recordModule()` table registers its paths, and `r/<table>/<id>`), the table and filters of a list page, or the
report and its filters. With no model (AI off or not set up) the panel offers the command palette's deterministic
actions instead.

**Agents** (`src/server/modules/ai/agents`, `src/shared/ai/agents.ts`, catalogue AI-074…077, AI-154/157/166/167).

| Table | Synced | What |
| --- | --- | --- |
| `ai_agent` | yes | `key`, Persian `name`/`description`, `module`, `builtin`/`base_key`, `enabled`, `goal` (the administrator's task text), `tables`, `triggers` (manual / event / schedule / conversation), `events`, `condition`, `schedule_minutes` + `schedule_filter`, `tools` (names, `prefix_*` patterns, `skill:<key>`), `autonomy` (suggest / approve / auto), `auto_actions` (the whitelist), `approvers` + `approver_group_id`, `tier`, budgets `max_steps`, `max_tokens`, `max_actions`, `daily_runs`, guardrails `forbidden_tables`, `forbidden_fields` (`field` or `table.field`), `forbidden_states` (`state` or `table:state`), `roles` (who may start it), `field_groups`, `principal_id`, `last_scheduled_at` |
| `ai_agent_run` | **no** | one run: agent, trigger and why, starter, principal, record, status (queued / running / done / failed / stopped / budget / skipped), `dry_run`, `steps` (model turns, tool calls, proposals), `state` (the conversation, resumable), counts, tokens, cost, `outcome` (the agent's report), `error` |

Guards on every write path (`agents/hooks.ts`): only AI administrators change agents (`agentConfigProblems` refuses a
configuration with problems); the principal is set only through the studio; a built-in agent is switched off, not
deleted; runs, conversations and messages are written only by the runtime. A run is never readable through the generic
API (`rowAccess` never true): its steps hold what the principal read. AI administrators read runs in the studio; a
member who started one sees its status and its proposals (each checked for them).

- **Principal.** Each agent acts through a service member of its own («عامل: <name>», `skills/principal.ts` with the
  agent's key: an `.invalid` address, no password) whose ITSM roles an OWNER chooses through the access service
  (nobody grants above their own) — never the system. Reads, retrieval, tools and writes use that member context.
- **Runs** (`agents/runtime.ts`): a run is a row and an `ai.agent.run` job; each invocation advances it by steps — one
  model turn and its tool round — keeping the conversation in `state`, and returns `{ again: 0 }` when the tick's time
  is near (the next tick continues). Before every step: the agent's «فعال», the organisation's «عامل‌ها» switch
  (`features.agents`, ledger family `agent:<key>`), the principal's membership — off stops the run («stopped» /
  «skipped»). The first step checks that the principal reads the record and that the condition holds. The task
  (goal, how the run started, the record as a `<data name="record">` block, today) is the first user turn under
  `AGENT_SYSTEM` (data is never instructions; tools only; proposals; a Persian report at the end). A provider that is
  rate-limited or down retries later (five times); other failures end the run «failed».
- **Tools** (`agents/tools.ts`): allowed patterns ∩ the catalogue built with the principal's context (a table its roles
  cannot read has no tool) − forbidden tables; skills `skill:<key>` run as tools (output as data, nothing written);
  tool retrieval when the allowed generated tools are many. Every tool is wrapped by the guardrails: a forbidden table
  in the input is refused, forbidden fields are stripped from reads, and a proposal that would write a forbidden table,
  field or state is refused before it is stored (`guardrailProblem`, checked on the payload).
- **Autonomy.** «فقط پیشنهاد»: proposals are routed to the record's assignee and assignment group (the inbox), anyone
  who reads the record and every field involved applies them with their own access. «اقدام پس از تأیید»: routed to the
  agent's approvers (or approver group; with neither, the record's group), who alone may apply them (`route_only`), and
  notified (`notifyPeople`, each checked for read access on delivery). «اقدام خودکار»: only whitelisted actions —
  `draft_update_<table>:<field>` (every field of the change listed), `draft_journal_entry:work_note`,
  `draft_link_records` — are applied at once with the principal's access (`applyByAgent`, audited as `ai_action` with
  `source: ai_agent`); a new record, a state change, a public reply or a batch never applies without a person.
- **Budgets**: model turns (the last turn is asked for the report without tools), tokens (in + out) and actions per
  run, runs per day (test runs aside); the organisation's AI budgets on top.
- **Triggers** (`agents/triggers.ts`): record events of its tables (`ai.agents`; the runtime that applied the write;
  never for writes of an AI service member — no loops between agents; deduplicated per agent and record while
  queued), its schedule (`ai.agents.schedule` every 15 minutes while a scheduled agent exists: the filter's records read
  as the principal, or one record-less run per period), a member by hand (`POST /ai/agents/:key/start`, the agent's
  `roles`, the record read by the member) or from a conversation (the assistant's `start_agent` tool).
- **Built-in agents** (`agents/builtin.ts`, seeded switched off, without a principal): incident triage, resolution
  helper, major-incident communications (hourly), pre-CAB change reviewer, request fulfilment helper, knowledge gap
  finder (daily: `kb_gap` drafts), CMDB data quality (daily), SLA watcher (hourly), shift handover (every eight hours).
  `registerAgent(def)` adds a module's own; «بازگشت به پیش‌فرض» copies a definition back.
- **Studio** (`src/ui/ai/agents/Studio.tsx`, settings «عامل‌ها», API `/ai/agents/admin…`, ai:full): the switch, the
  agents by module, settings, the tool picker (what the principal may use is marked), the principal, the test console —
  a dry run on a chosen record (nothing stored, nothing applied) with the record as the administrator and as the
  principal read it, side by side; only on a record the administrator reads, values only the principal reads masked —
  and runs with their steps (stop a running one). Run steps show what the principal's model wrote and which tools it
  called: give a principal no more than its AI administrators may know. «پیشنهادهای هوش مصنوعی»
  (`ai/proposals`, `GET /ai/actions?inbox=1`) lists what is routed to the member.

### 11.9 The virtual agent

`src/server/modules/ai/va` (brain), `src/shared/ai/va.ts` (contracts), `/ai/va/*` (HTTP), `src/ui/ai/va` (the
browser's adapter and a test page; the portal module builds the requester UI). Tables `va_topic` (synced; keywords,
Persian examples, kind: knowledge, status, order, catalog_item, report_issue, handoff, answer; built-ins seeded on first
use), `va_conversation` and `va_message` (local, private to the requester, runtime-written).

- **API**: `POST /va/conversations` (start, optional first message), `POST /va/conversations/:id/messages` (text, or a
  card's answer: confirm / cancel / choose) and `…/messages/stream` (SSE: the answer's text, then the reply),
  `POST …/handoff`, `POST …/end`, `GET /va/conversations`, `GET …/messages`. A reply carries text, cards (articles,
  tickets, choices, items, a question, a confirmation, created, handoff, a link to an order form), the topic, the route
  and quick replies. `VirtualAgentAdapter` (`virtualAgent(ctx)` on the server, `virtualAgentClient(api)` in the
  browser) is the one interface for the portal and the messaging channels; `cardText` renders a card as text.
- **Routing**: a pending question or card first; then a topic's keywords and examples (Persian-normalised words, the
  local embedder); a record number → the status of that ticket; the model's intent classification (`va:intent`, fast
  tier, under the «دستیار مجازی» switch; the message only as data); the knowledge answer.
- **Every step with the requester's context**: answers from `askWithCitations`; the status of their own tickets (the
  tables' requester fields `is_me` — another person's ticket is never shown, even to someone who could read it) with
  public replies only; ordering — the catalogue as they are entitled to it, one required question at a time
  (choices, numbers, dates, text; an item that needs a secret, a sensitive answer, a file or a person picker gets a link
  to its order form), `checkItem`, a confirmation card, then `placeOrder` with channel «chat»; reporting an issue — an
  incident draft confirmed by the requester and filed with their access; handoff — the transcript (and a model's
  summary when one may be used) becomes an incident the requester files, or, when they may not file one, an interaction
  the service desk picks up.

## 12. Not built yet

- Agents: approvals of an agent's proposals through the approvals service (they are routed to the approvers and
  notified instead: a record's `approval` field means the record's own approval), agents as flow steps, an undo journal
  for applied actions, per-agent source scopes (AI-125), agent analytics beyond the run history.
- Virtual agent: the requester UI and the messaging channels (the portal module), topic flows with several slots
  beyond a catalogue item's questions, conversation analytics and deflection metrics (AI-073), known-issue detection
  before a report (AI-067), memory across conversations (AI-070).

- Skills: per-field writing-tool configuration with conditions (AI-027 «several configurations per field»), shadow runs
  of a new version beside the published one (AI-007), confidence thresholds and abstention per skill (AI-158), LLM-judge
  scoring in evaluation sets (AI-170), a per-skill model override (the tier decides), skills as flow steps
  (`registerFlowSkill`) and as assistant tools beyond the shift handover, and record-less scheduled outputs (a scheduled
  skill runs over records; the handover summary is asked for).
- Sharing a collection with **roles**: the condition language has no "my roles" operator; share with groups instead.
  (A unit with its **sub-units** is the sharing «واحدها با زیرمجموعه‌ها», operator `in_my_unit_line`.)
- Embeddings through the web version for a Windows app (`relay.ts` carries chat turns only): the Windows app uses its
  own embedding connection (e.g. Ollama `bge-m3`) or the local embedder.
- OCR text is per runtime (a synced document that needed OCR is read again where a vision model is available).
- Cross-encoder re-ranking, query rewriting with a glossary, multi-query, recency decay, citation verification by an
  LLM judge, semantic caches keyed by ACL fingerprints (catalogue AI-011/012/013), connectors (AI-015), document
  comparison and extraction (AI-122/123), attachments of other records as sources (AI-124), per-agent source scopes
  (AI-125).
