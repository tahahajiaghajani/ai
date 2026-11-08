// Contracts of the knowledge module's HTTP API (/api/o/:org/knowledge/…), shared by the server and the screens.
// Imported by the UI: keep it free of server imports.
import type { DiffLine, Finding, Heading, QualityItem } from "./logic";

export interface KbCard {
  id: string;
  number: string | null;
  title: string;
  summary: string | null;
  article_type: string | null;
  base_id: string | null;
  base_name: string | null;
  category_id: string | null;
  category_name: string | null;
  language: string | null;
  state: string | null;
  published_at: string | null;
  last_reviewed_at: string | null;
  view_count: number;
  reuse_count: number;
  helpful_yes: number;
  helpful_no: number;
  /** «فقط کارشناسان» */
  internal: boolean;
  version_label: string | null;
  review_due: boolean;
  /** a KCS work-in-progress article (agents only): being written while the issue is worked */
  wip?: boolean;
}

export interface KbSearchParams {
  q: string;
  base_id?: string | null;
  category_id?: string | null;
  type?: string | null;
  language?: string | null;
  sort?: "relevance" | "recent" | "popular";
  page?: number;
  size?: number;
  session_id?: string | null;
  channel?: string | null;
  include_retired?: boolean;
  semantic?: boolean;
  log?: boolean;
}

export interface KbSearchHit extends KbCard {
  score: number;
  /** plain-text excerpt around the first match */
  snippet: string;
  /** found by meaning (the AI index), not by its words */
  semantic: boolean;
  /** pinned by a search rule */
  pinned: boolean;
}

export interface KbFacet {
  key: string;
  label: string;
  count: number;
}

export interface KbSnippetHit {
  id: string;
  number: string | null;
  question: string;
  answer: string;
  source_article_id: string | null;
  internal: boolean;
}

export interface KbSearchResult {
  query: string;
  /** the search-form terms (with glossary alternatives) — for highlighting */
  terms: string[];
  /** glossary terms that widened the query */
  expanded: string[];
  total: number;
  page: number;
  size: number;
  sort: string;
  /** no article had every word: articles with some of them */
  relaxed: boolean;
  semantic: boolean;
  hits: KbSearchHit[];
  facets: { base: KbFacet[]; category: KbFacet[]; type: KbFacet[]; language: KbFacet[] };
  snippets: KbSnippetHit[];
}

export interface KbCategoryNode {
  id: string;
  name: string;
  parent_id: string | null;
  base_id: string;
  icon: string | null;
  description: string | null;
  article_count: number;
  depth: number;
  restricted: boolean;
}

export interface KbBaseItem {
  id: string;
  name: string;
  description: string | null;
  kind: "internal" | "external";
  icon: string | null;
  color: string | null;
  article_count: number;
  restricted: boolean;
  contribute: boolean;
  manage: boolean;
  allow_comments: boolean;
  allow_ratings: boolean;
}

export interface KbHome {
  bases: KbBaseItem[];
  categories: KbCategoryNode[];
  featured: KbCard[];
  popular: KbCard[];
  recent: KbCard[];
  viewed: KbCard[];
  can: { author: boolean; manage: boolean; ai: boolean; internal: boolean };
  pending: { reviews: number; tasks: number; attestations: number; drafts: number };
}

export interface KbBanner {
  kind: "retired" | "outdated" | "draft" | "internal" | "ai" | "machine" | "stale_translation" | "scheduled" | "expired" | "compliance";
  tone: "info" | "warning" | "danger";
  text: string;
  /** the replacement article (retired ones) */
  link?: { id: string; title: string; number: string | null } | null;
}

export interface KbTranslation {
  id: string;
  language: string;
  title: string;
  number: string | null;
  stale: boolean;
  master: boolean;
}

export interface KbGlossaryTerm {
  term: string;
  definition: string | null;
  approved_fa: string | null;
  forms: string[];
}

export interface KbAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  previewable: boolean;
}

export interface KbReadView {
  article: Record<string, unknown>;
  display: Record<string, string>;
  /** the body with blocks expanded for this reader */
  body: string;
  /** null when the reader may not see the internal section */
  internal_body: string | null;
  toc: Heading[];
  base: { id: string; name: string; kind: string; allow_comments: boolean; allow_ratings: boolean } | null;
  path: { id: string; name: string }[];
  banners: KbBanner[];
  translations: KbTranslation[];
  related: KbCard[];
  attachments: KbAttachment[];
  glossary: KbGlossaryTerm[];
  provenance: { model?: string | null; validated_by?: string | null; validated_by_name?: string | null; source_refs?: string[]; machine_translated?: boolean } | null;
  my: { vote: "helpful" | "not_helpful" | null; rating: number | null; subscribed: boolean; acknowledgement: { attestation_id: string; title: string; due_at: string; acked_at: string | null } | null };
  can: { edit: boolean; draft: string | null; review: boolean; retire: boolean; restore: boolean; approve: boolean; feedback: boolean; flag: boolean; subscribe: boolean; attest: boolean; manage: boolean };
  author_name: string | null;
  owner_name: string | null;
  reviewer_name: string | null;
}

export interface KbSuggestion extends KbCard {
  score: number;
  snippet: string;
  semantic: boolean;
  linked: string | null;
}

export interface KbRecordPanel {
  linked: { link_id: string; kind: string; label: string; article: { id: string; number: string | null; title: string; state: string | null; state_label: string | null }; created_at: string }[];
  suggestions: KbSuggestion[];
  snippets: KbSnippetHit[];
  query: string;
  can: { link: boolean; capture: boolean };
  /** the article written from this record (WIP or draft), if any */
  captured: { id: string; number: string | null; title: string; state: string } | null;
}

export interface KbVersionCheck {
  score: number;
  items: QualityItem[];
  findings: Finding[];
  unsafe: { label: string; text: string }[];
  words: number;
  readability: number;
  missing: string[];
  external: boolean;
  duplicates: { id: string; number: string | null; title: string; similarity: number }[];
}

export interface KbDiff {
  from: { id: string; version_label: string | null; state: string | null };
  to: { id: string; version_label: string | null; state: string | null };
  fields: { field: string; label: string; lines: DiffLine[]; added: number; removed: number }[];
}

export interface KbCount {
  key: string;
  label: string;
  count: number;
}

export interface KbDashboard {
  days: number;
  totals: { published: number; drafts: number; in_review: number; retired: number; review_due: number; expiring: number; flagged: number; internal: number };
  by_state: KbCount[];
  by_base: KbCount[];
  by_type: KbCount[];
  top: KbCard[];
  bottom: KbCard[];
  queries: { query: string; searches: number; zero: number; clicks: number }[];
  zero: { query: string; searches: number; zero: number; clicks: number }[];
  events: Record<string, number>;
  search: { searches: number; zero_rate: number; click_rate: number };
  deflection: { sessions: number; deflected: number; rate: number; solved_clicks: number };
  feedback: { helpful: number; not_helpful: number; ratio: number; open_flags: number; open_tasks: number };
  reuse: { links: number; articles_reused: number; link_rate: number };
  translation: { masters: number; translated: number; stale: number };
  aqi: { reviews: number; average: number | null; by_author: { user_id: string; name: string; score: number; reviews: number }[] };
  capture: { from_records: number; external: number; ratio_90_0: number };
  readiness: { key: string; label: string; articles: number; records: number; coverage: number; freshness: number; usage: number; score: number }[];
}

export interface KbWorkspace {
  cards: { key: string; label: string; count: number; tone: "info" | "warning" | "danger" | "ok"; path: string }[];
  expiring: KbCard[];
  flagged: KbCard[];
  unhealthy: (KbCard & { health_score: number | null; next_action: string | null })[];
  duplicates: { id: string; a: KbCard | null; b: KbCard | null; similarity: number }[];
  gaps: { id: string; number: string | null; title: string; demand: number; kind: string; last_seen_at: string | null }[];
  reviews: { id: string; article_id: string; title: string; version_label: string | null; author_id: string | null; submitted_at: string | null }[];
  tasks: { id: string; number: string | null; short_description: string; kind: string; state: string; assigned_to: string | null; sla_due: string | null }[];
  routines: { key: string; label: string; target: number; met: number; total: number }[];
  ai: string[];
}

export interface KbExplain {
  user: { id: string; name: string | null };
  readable: boolean;
  layers: { key: string; label: string; ok: boolean | null; detail: string }[];
  ai: { allowed: boolean; reason: string };
}

export interface KbAttestationItem {
  id: string;
  number: string | null;
  title: string;
  article_id: string;
  article_title: string;
  version_label: string | null;
  due_at: string;
  acked_at: string | null;
  overdue: boolean;
}
