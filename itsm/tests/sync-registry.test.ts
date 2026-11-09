// Guard: every organisation table travels between the Windows app and the web, unless it is listed
// here as deliberately local. A new module table that is neither a sync root nor a child of one
// would otherwise silently stay on one side.
import { describe, it, expect, beforeAll } from "vitest";
import { createPgliteDb } from "@server/db/pglite";
import { migrate } from "@server/db/migrate";
import { AGGREGATES } from "@server/sync/registry";
import type { Db } from "@server/db";

const LOCAL_ONLY: Record<string, string> = {
  sm_audit: "each side keeps its own event log",
  sm_devices: "registered Windows apps (cloud side)",
  sm_api_keys: "API keys are used against the web version only",
  sm_integrations: "other systems post their webhooks to the web version",
  sm_integration_events: "raw webhook deliveries (web version)",
  sm_dev_events: "raw DevOps tool deliveries (web version; commits, pull requests, builds and deployments travel)",
  sm_org_sync: "per-organisation revision counter",
  // AI: each runtime (web, Windows) keeps its own connections — keys are encrypted with that
  // runtime's secret — and its own usage, conversations and proposals
  sm_ai_connections: "AI provider connections with this runtime's encrypted key",
  sm_ai_settings: "AI settings of this runtime (refers to its connections)",
  sm_ai_holds: "rate-limit / quota holds per connection and model",
  sm_ai_usage: "usage ledger of this runtime",
  sm_ai_threads: "assistant conversations (private to their author)",
  sm_ai_messages: "assistant messages",
  sm_ai_tool_calls: "audit of the assistant's tool calls",
  sm_ai_actions: "proposals waiting for a person's confirmation",
  sm_ai_data_refs: "tables and charts referenced from answers",
  // AI skills: the run log is private to each run's author and kept by the runtime that ran it (the skills, their
  // versions and evaluation sets are engine tables and travel)
  sm_ai_skill_runs: "AI skill runs of this runtime (private to their authors)",
  // AI agents: each runtime runs the agents of the writes it applied and keeps their run log; the virtual agent's
  // conversations stay with the runtime the requester talked to (the agents and topics are engine tables and travel)
  sm_ai_agent_runs: "AI agent runs of this runtime (steps, tool calls, proposals)",
  sm_va_conversations: "virtual agent conversations (private to the requester)",
  sm_va_messages: "virtual agent messages",
  // AI index (retrieval): each runtime indexes the records it holds, with its own embedding model
  sm_ai_rag_docs: "AI index: one row per indexed record (hash, version, anchors)",
  sm_ai_chunks: "AI index: chunks with full-text and vector embeddings",
  // knowledge: each runtime keeps the stream of what happened on it (searches, views, votes); the records travel
  sm_kb_events: "knowledge event stream of this runtime (search analytics, views, deflection)",
  // event management: raw monitoring events stay with the runtime that received them (short retention); alerts travel
  sm_events: "raw monitoring events of this runtime (normalised deliveries; their alerts are synchronised)",
  sm_ai_doc_pages: "text read from smart documents on this runtime",
  sm_ai_rag_runs: "AI index runs (backfills, re-embedding, reconciliation)",
  // record engine bookkeeping of each runtime
  sm_numbers: "record number counters (each runtime its own; sync renumbers on a clash)",
  sm_jobs: "job queue and outbox of record events (each runtime runs its own)",
  sm_flow_runs: "flow runs of the runtime that executes them (docs/spec/services/flows.md)",
  sm_flow_run_steps: "step logs of those runs",
  sm_flow_waits: "what waiting runs wait for (timers, conditions, approvals)",
  sm_flow_timers: "the scheduler's plan of this runtime",
  sm_blobs: "attachment contents (fetched lazily by the Windows app, uploaded after a push)",
  sm_scope_epochs: "per member: bumped when what they may read changes (read by the cloud's pull)",
  sm_access_state: "per organisation: the access configuration's version (each runtime its own; caches revalidate against it)",
  // platform administration (web version)
  sm_support_sessions: "super-admin support sessions (web version)",
  sm_security_events: "sign-in and security events",
  sm_org_admin: "platform status and limits of an organisation (web version)",
  // the notification service (each runtime keeps what it delivered and received)
  sm_notification_log: "notification deliveries (each runtime logs what it sent)",
  sm_email_messages: "e-mails sent and received by this runtime (threading, loop protection)",
  sm_notify_state: "background state of the notification service (IMAP folders)",
};

describe("sync registry covers every organisation table", () => {
  let db: Db;
  let tables: { name: string; cols: string[] }[];
  beforeAll(async () => {
    db = await createPgliteDb({});
    await migrate(db, () => {});
    const rows = await db.query<{ table_name: string; cols: string[] }>(
      `select t.table_name, array_agg(c.column_name::text order by c.column_name) as cols
       from information_schema.tables t join information_schema.columns c on c.table_name = t.table_name and c.table_schema = t.table_schema
       where t.table_schema = 'public' and t.table_type = 'BASE TABLE' group by t.table_name`,
    );
    tables = rows.map((r) => ({ name: r.table_name, cols: r.cols }));
  });

  it("classifies every table with an org_id as a sync root, a child of one, or deliberately local", () => {
    const roots = new Set(AGGREGATES.map((a) => a.table));
    const children = new Set(AGGREGATES.flatMap((a) => (a.children ?? []).map((c) => c.table)));
    const stray = tables.filter((t) => t.cols.includes("org_id") && !roots.has(t.name) && !children.has(t.name) && !(t.name in LOCAL_ONLY)).map((t) => t.name);
    expect(stray).toEqual([]);
  });

  it("lists as local only tables that exist (the list never rots)", () => {
    const names = new Set(tables.map((t) => t.name));
    expect(Object.keys(LOCAL_ONLY).filter((t) => !names.has(t))).toEqual([]);
  });

  it("gives every root the sync columns and its trigger", async () => {
    const triggers = new Set((await db.query<{ tgname: string }>(`select tgname from pg_trigger where not tgisinternal`)).map((r) => r.tgname));
    for (const a of AGGREGATES) {
      const t = tables.find((x) => x.name === a.table);
      expect(t, a.table).toBeTruthy();
      for (const col of ["rev", "updated_at", "deleted_at", "origin", "org_id"]) expect(t!.cols, `${a.table}.${col}`).toContain(col);
      expect(triggers.has(`${a.table}_sync`), `${a.table}_sync trigger`).toBe(true);
      for (const ch of a.children ?? []) expect(tables.find((x) => x.name === ch.table)?.cols, `${ch.table}.${ch.fk}`).toContain(ch.fk);
    }
  });
});
