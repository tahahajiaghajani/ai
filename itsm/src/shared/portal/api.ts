// API contracts of the self-service portal (/api/o/:org/portal/*, the public /api/public/portal/*) — shared by the
// server and the screens. Everything here is a projection for requesters: no internal notes, no agent-only fields,
// and only records that are the caller's own, shared with them, or (for managers) their people's.
// Imported by the UI: keep it free of server imports.
import type { AnnouncementItem } from "../incident/api";
import type { ServiceStatus } from "../service_portfolio/logic";
import type { Stage, StageStep, StageTone, SurveyQuestion, WidgetInstance } from "./logic";

/** The portal a person sees: its look, behaviour and the home page (the published layout, or the draft in preview). */
export interface PortalConfig {
  portal: {
    id: string | null;
    name: string;
    title: string;
    subtitle: string;
    brand_name: string;
    accent: string;
    hero: "calm" | "bold" | "plain";
    logo_url: string | null;
    footer: string | null;
    privacy_notice: string | null;
    chat_enabled: boolean;
    chat_name: string;
    ai_answers: boolean;
    report_item_id: string | null;
  };
  layout: WidgetInstance[];
  /** other portals the person may switch to (their workspaces') */
  portals: { id: string; name: string }[];
  preview: boolean;
  can: {
    /** may change the portal's look and home page (catalogue administrators) */
    admin: boolean;
    /** works records somewhere (shows «میز کار») */
    agent: boolean;
    /** may order from the catalogue */
    order: boolean;
    /** may report an incident */
    report: boolean;
    /** may give feedback */
    feedback: boolean;
  };
}

export interface ItemLite {
  id: string;
  name: string;
  short_description: string | null;
  icon: string | null;
  color: string | null;
  category_id: string | null;
  type: string;
  orderable: boolean;
  promise: string;
  favorite?: boolean;
}

export interface CategoryLite {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  count: number;
}

export interface TopicLite {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  parent_id: string | null;
}

export interface LinkLite {
  id: string;
  name: string;
  url: string;
  description: string | null;
  icon: string | null;
  section: string | null;
  new_tab: boolean;
  /** a page of the signed-in app (`url` is a path relative to /:org/), registered by another module */
  internal?: boolean;
}

export interface ArticleLite {
  id: string;
  number: string | null;
  title: string;
  summary: string | null;
  base_name: string | null;
  helpful_yes: number;
}

/** One record in «درخواست‌های من» (any department's table). */
export interface PortalTicketCard {
  table: string;
  /** what kind of record it is for people: «گزارش مشکل»، «درخواست»، «بازخورد»… */
  kind_label: string;
  id: string;
  number: string | null;
  title: string;
  state: string;
  state_label: string;
  stage: Stage;
  stage_label: string;
  tone: StageTone;
  opened_at: string | null;
  updated_at: string | null;
  /** mine (I asked or it is for me), shared with me (watching), my team (a manager's people) */
  relation: "mine" | "shared" | "team";
  /** the person it is for, when it is not the caller */
  for_name: string | null;
}

export interface PortalItemsPage {
  items: PortalTicketCard[];
  total: number;
  page: number;
  size: number;
  /** may the caller see «تیم من» (they manage people) */
  team: boolean;
}

export interface TimelineEntry {
  id: string;
  kind: "created" | "comment" | "state" | "attachment";
  at: string;
  author_name: string | null;
  /** written by the caller */
  mine: boolean;
  /** an agent of the desk (not the requester's side) */
  staff: boolean;
  body: string | null;
  label: string | null;
  attachments?: { id: string; name: string }[];
}

export interface PortalAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  previewable: boolean;
  created_at: string;
  mine: boolean;
}

export interface PortalAction {
  key: "confirm" | "reopen" | "cancel" | "withdraw" | "chase";
  label: string;
  /** the state the action moves to (none: a comment and a nudge) */
  to: string | null;
  /** asks for a reason (reopen, cancel) */
  comment: "required" | "optional" | "none";
  tone: "primary" | "default" | "danger";
}

export interface PortalTicket extends PortalTicketCard {
  description: string | null;
  steps: StageStep[];
  /** requester-safe facts: the item ordered, the service, the person it is for, the assignee's first name */
  facts: { label: string; value: string }[];
  timeline: TimelineEntry[];
  attachments: PortalAttachment[];
  actions: PortalAction[];
  /** may comment and attach (it is readable and not closed) */
  can_comment: boolean;
  approvals: { state: string; label: string; pending: number; decided: number } | null;
  /** the next promise the desk works to («پاسخ تا …»), never internal SLA names */
  promise: { label: string; due_at: string; late: boolean } | null;
  /** an outage announcement on the incident behind it */
  outage: { title: string; kind: string } | null;
  /** an open survey about it for the caller */
  survey: { invitation_id: string } | null;
  /** the answers of an order (requested items), open ones only */
  answers: { label: string; value: string }[];
  /** the satisfaction the caller gave, when the table keeps one */
  rating: number | null;
  /** the desk's official answer (feedback) or resolution notes, when the person's field groups show them */
  resolution: string | null;
}

export interface PortalSearchHit {
  kind: "article" | "item" | "record" | "link" | "topic" | "announcement";
  id: string;
  title: string;
  snippet: string | null;
  /** in-portal path (records, articles, items, topics) or an external address (links) */
  path: string;
  external?: boolean;
  meta?: string | null;
}

export interface PortalSearchResult {
  q: string;
  hits: PortalSearchHit[];
  counts: Record<PortalSearchHit["kind"], number>;
  /** the search found nothing at all (logged for knowledge gaps) */
  zero: boolean;
}

export interface PortalAnswer {
  text: string;
  citations: { n: number; title: string; path: string }[];
  model: string | null;
  fallback: boolean;
  /** nothing in the person's sources answers it */
  abstained: boolean;
  label: string;
}

export interface PortalHome {
  announcements: AnnouncementItem[];
  actions: { approvals: number; surveys: number; acknowledgements: number; waiting_you: number };
  my: { open: number; items: PortalTicketCard[] };
  popular: ItemLite[];
  favorites: ItemLite[];
  categories: CategoryLite[];
  topics: TopicLite[];
  links: LinkLite[];
  knowledge: ArticleLite[];
  status: { overall: ServiceStatus; services: { name: string; status: ServiceStatus; note: string | null }[] } | null;
}

export interface PortalCatalog {
  categories: CategoryLite[];
  items: ItemLite[];
  favorites: string[];
  recent: ItemLite[];
}

export interface TopicPage {
  topic: TopicLite;
  path: TopicLite[];
  children: TopicLite[];
  items: ItemLite[];
  articles: ArticleLite[];
  links: LinkLite[];
}

/** «کارهای من»: what waits for the person. */
export interface PortalTodo {
  approvals: {
    id: string;
    table: string;
    table_label: string;
    record_id: string;
    record_number: string | null;
    record_title: string | null;
    requested_at: string | null;
    due_at: string | null;
    on_behalf_of: string | null;
    level_name: string | null;
  }[];
  surveys: { id: string; title: string; sent_at: string | null; expires_at: string | null }[];
  acknowledgements: { id: string; title: string; due_at: string | null; article_id: string | null }[];
  waiting_you: PortalTicketCard[];
  display: Record<string, string>;
}

/** What an approver sees of the record an approval is about (requester-safe; the approver grant lets them read it). */
export interface PortalApproval {
  approval: { id: string; state: string; can_decide: boolean; due_at: string | null; comments: string | null; level_name: string | null };
  record: { table: string; table_label: string; id: string; number: string | null; title: string; description: string | null; for_name: string | null; opened_by_name: string | null };
  facts: { label: string; value: string }[];
  answers: { label: string; value: string }[];
}

export interface SurveyView {
  invitation: { id: string; status: string; expires_at: string | null; answered_at: string | null };
  survey: { name: string; kind: string; intro: string | null; thanks: string | null; anonymous: boolean };
  questions: SurveyQuestion[];
  /** the record it is about (not on the public page) */
  record: { table: string; id: string; number: string | null; title: string } | null;
}

export interface SurveyResults {
  survey: { id: string; name: string; kind: string } | null;
  days: number;
  totals: { invited: number; responses: number; rate: number | null; csat_pct: number | null; csat_avg: number | null; nps: number | null; ces_avg: number | null; happiness_avg: number | null; lost_minutes_avg: number | null };
  trend: { period: string; label: string; responses: number; csat_pct: number | null; nps: number | null }[];
  distribution: { csat: number[]; nps: number[] };
  groups: { id: string | null; name: string; responses: number; csat_pct: number | null }[];
  comments: { id: string; at: string; csat: number | null; comment: string; record_number: string | null }[];
}

export interface LinkCodeView {
  code: string;
  expires_at: string;
  channels: { id: string; name: string; kind: string; deep_link: string | null }[];
}

export interface IdentityView {
  id: string;
  channel_name: string;
  kind: string;
  external_name: string | null;
  linked_at: string | null;
}

export interface PortalProfile {
  user: { id: string; name: string; email: string; mobile: string | null };
  profile: { unit: string | null; location: string | null; manager: string | null; title: string | null; persona: string | null };
  identities: IdentityView[];
  channels: number;
}

export interface PortalAnalytics {
  days: number;
  visitors: number;
  searches: number;
  zero: number;
  zero_rate: number | null;
  answers: number;
  deflections: number;
  orders: number;
  reports: number;
  top_queries: { query: string; count: number }[];
  top_zero: { query: string; count: number }[];
  chat: { conversations: number; handoffs: number; containment: number | null; by_channel: { channel: string; count: number }[] };
  channels: { name: string; kind: string; received: number; failed: number; linked: number }[];
  surveys: { invited: number; responses: number; csat_pct: number | null };
  daily: { day: string; label: string; visitors: number; searches: number }[];
}

/** The public knowledge pages (no sign-in; a projection: no record ids, numbers or people). */
export interface PublicKbHome {
  title: string;
  intro: string | null;
  bases: { key: string; name: string; description: string | null; count: number }[];
  popular: PublicKbCard[];
  recent: PublicKbCard[];
  feedback: boolean;
}

export interface PublicKbCard {
  slug: string;
  title: string;
  summary: string | null;
  base: string | null;
  updated: string | null;
}

export interface PublicKbArticle extends PublicKbCard {
  body: string;
  related: PublicKbCard[];
  feedback: boolean;
}

/** The website widget's configuration (public). */
export interface WidgetConfig {
  title: string;
  greeting: string;
  accent: string;
  consent: string | null;
  search: boolean;
  chat_url: string | null;
  kb_url: string | null;
}
