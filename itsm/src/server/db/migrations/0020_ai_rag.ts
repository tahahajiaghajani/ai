// Retrieval (RAG): the embedding capability of AI connections, the index of each runtime (one row per indexed record
// with its content hash and access anchors, and its chunks with full-text vectors, the local embedding and the
// provider's embedding), the text read from smart documents, and the log of index runs. Every table is local to its
// runtime, like the other AI tables: each runtime indexes the records it holds (the Windows app only what its linked
// account may read). pgvector, when the database has it, is enabled at startup (src/server/modules/ai/rag/store.ts),
// which then adds the vector columns; without it the float arrays below are compared in the server.
export default /* sql */ `
alter table sm_ai_connections add column if not exists embed jsonb;

create table if not exists sm_ai_rag_docs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  table_key text not null,
  record_id uuid not null,
  -- the record's engine version when it was indexed, and the hash of everything indexed from it
  version int,
  hash text,
  title text,
  chunks int not null default 0,
  -- ok | empty | error
  status text not null default 'ok',
  error text,
  -- the provider embedding the chunks carry; vec_pending: some chunks still wait for it
  vec_key text,
  vec_pending boolean not null default false,
  workspace_id uuid,
  unit_id uuid,
  domain_id uuid,
  indexed_at timestamptz not null default now()
);
create unique index if not exists sm_ai_rag_docs_rec_key on sm_ai_rag_docs (org_id, table_key, record_id);
create index if not exists sm_ai_rag_docs_pending_idx on sm_ai_rag_docs (org_id) where vec_pending;

create table if not exists sm_ai_chunks (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  table_key text not null,
  record_id uuid not null,
  -- chunk: retrievable passage; parent: the section a chunk belongs to (small-to-big)
  kind text not null default 'chunk',
  parent_id uuid,
  ord int not null default 0,
  field text,
  fields text[] not null default '{}',
  -- field groups whose values the chunk contains: a caller lacking one never gets the chunk
  groups text[] not null default '{}',
  heading text,
  page int,
  page_end int,
  lang text,
  text text not null,
  -- the Persian-normalised search form (title, heading and text)
  norm text not null default '',
  tsv tsvector generated always as (to_tsvector('simple', norm)) stored,
  -- content hash of what was embedded (unchanged text keeps its vectors)
  hash text not null,
  tokens int not null default 0,
  version int,
  workspace_id uuid,
  unit_id uuid,
  domain_id uuid,
  -- local embedding (always) and the provider's (key = preset:model:dims); vector columns are added with pgvector
  lvec real[],
  vec_key text,
  vec real[],
  created_at timestamptz not null default now()
);
create index if not exists sm_ai_chunks_rec_idx on sm_ai_chunks (org_id, table_key, record_id);
create index if not exists sm_ai_chunks_tsv_idx on sm_ai_chunks using gin (tsv);
create index if not exists sm_ai_chunks_vec_idx on sm_ai_chunks (org_id, vec_key) where kind = 'chunk';

-- text read from a smart document (page by page), on the runtime that read it
create table if not exists sm_ai_doc_pages (
  org_id uuid not null references sm_orgs(id) on delete cascade,
  doc_id uuid not null,
  page int not null,
  text text not null,
  ocr boolean not null default false,
  primary key (doc_id, page)
);
create index if not exists sm_ai_doc_pages_org_idx on sm_ai_doc_pages (org_id, doc_id);

-- index runs (backfills, re-embedding, reconciliation) for the admin page
create table if not exists sm_ai_rag_runs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  kind text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  stats jsonb not null default '{}'::jsonb,
  error text
);
create index if not exists sm_ai_rag_runs_org_idx on sm_ai_rag_runs (org_id, started_at desc);

-- Supabase: reachable only through the app's own server connection
do $do$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename in ('sm_ai_rag_docs', 'sm_ai_chunks', 'sm_ai_doc_pages', 'sm_ai_rag_runs') loop
    execute format('alter table %I enable row level security', t.tablename);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table %I from anon', t.tablename);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table %I from authenticated', t.tablename);
    end if;
  end loop;
end
$do$;
`;
