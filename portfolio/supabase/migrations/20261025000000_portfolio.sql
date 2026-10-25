-- Taha Aghajani portfolio — schema (idempotent). Run once in Supabase → SQL Editor.
-- Every object is prefixed with portfolio_ so the site can share a Supabase project with other apps.
-- RLS is enabled with no policies: only the server (service-role key) can read or write.

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------- requests (smart tickets)
create table if not exists public.portfolio_tickets (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  access_hash text not null,
  name text not null,
  email text not null default '',
  phone text not null default '',
  telegram text not null default '',
  organization text not null default '',
  kind text not null default 'project',
  budget text not null default '',
  timeline text not null default '',
  subject text not null,
  body text not null,
  lang text not null default 'fa',
  status text not null default 'new',
  priority text not null default 'normal',
  ai_summary text,
  ai_reply text,
  ai_triage jsonb,
  source text not null default '',
  visitor text not null default '',
  last_visitor_at timestamptz not null default now(),
  last_owner_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists portfolio_tickets_status_idx on public.portfolio_tickets (status, updated_at desc);

create table if not exists public.portfolio_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.portfolio_tickets(id) on delete cascade,
  author text not null check (author in ('visitor', 'owner', 'system')),
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists portfolio_ticket_messages_ticket_idx on public.portfolio_ticket_messages (ticket_id, created_at);

-- ----------------------------------------------------------------- assistant
create table if not exists public.portfolio_chat_logs (
  id uuid primary key default gen_random_uuid(),
  session_id text not null default '',
  lang text not null default 'fa',
  question text not null,
  answer text not null default '',
  unknown boolean not null default false,
  model text not null default '',
  visitor text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists portfolio_chat_logs_created_idx on public.portfolio_chat_logs (created_at desc);

-- extra facts the owner adds from /admin; the site's own content is always part of the knowledge
create table if not exists public.portfolio_knowledge (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null default '',
  tags text[] not null default '{}',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------- rate limits
create table if not exists public.portfolio_rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 0
);

create or replace function public.portfolio_hit_rate_limit(p_key text, p_window integer, p_max integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into portfolio_rate_limits as r (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update set
    count = case when r.window_start < now() - make_interval(secs => p_window) then 1 else r.count + 1 end,
    window_start = case when r.window_start < now() - make_interval(secs => p_window) then now() else r.window_start end
  returning count into v_count;
  if random() < 0.01 then
    delete from portfolio_rate_limits where window_start < now() - interval '2 days';
  end if;
  return v_count <= p_max;
end;
$$;

revoke all on function public.portfolio_hit_rate_limit(text, integer, integer) from public, anon, authenticated;

-- ----------------------------------------------------------------- RLS
alter table public.portfolio_tickets enable row level security;
alter table public.portfolio_ticket_messages enable row level security;
alter table public.portfolio_chat_logs enable row level security;
alter table public.portfolio_knowledge enable row level security;
alter table public.portfolio_rate_limits enable row level security;
