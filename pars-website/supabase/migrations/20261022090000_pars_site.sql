-- Pars website — schema (idempotent). Run once in Supabase → SQL Editor.
-- Every table is prefixed with pars_ so the site can share a Supabase project with other apps.
-- RLS is enabled with no policies: only the server (service-role key) can read or write.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- settings
create table if not exists public.pars_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- --------------------------------------------------------------- knowledge
create table if not exists public.pars_knowledge (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null default '',
  tags text[] not null default '{}',
  pinned boolean not null default false,
  enabled boolean not null default true,
  sort integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------- demos
create table if not exists public.pars_demos (
  id uuid primary key default gen_random_uuid(),
  title_fa text not null,
  title_en text not null default '',
  description_fa text not null default '',
  description_en text not null default '',
  url text not null,
  tag text not null default '',
  enabled boolean not null default true,
  sort integer not null default 100,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------- tickets
create table if not exists public.pars_tickets (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  access_hash text not null,
  access_enc text,
  name text not null,
  email text not null,
  phone text not null default '',
  organization text not null default '',
  subject text not null,
  body text not null,
  lang text not null default 'fa',
  product text not null default 'other',
  category text not null default 'support',
  priority text not null default 'normal',
  status text not null default 'new',
  sentiment text,
  ai_summary text,
  ai_reply text,
  ai_triage jsonb,
  source text not null default '',
  rating smallint,
  rating_note text,
  first_response_at timestamptz,
  due_at timestamptz,
  last_customer_at timestamptz not null default now(),
  last_staff_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pars_tickets_status_idx on public.pars_tickets (status, updated_at desc);
create index if not exists pars_tickets_email_idx on public.pars_tickets (lower(email));

create table if not exists public.pars_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.pars_tickets(id) on delete cascade,
  author text not null check (author in ('customer', 'staff', 'system')),
  body text not null,
  internal boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists pars_ticket_messages_ticket_idx on public.pars_ticket_messages (ticket_id, created_at);

-- --------------------------------------------------------------- chat logs
create table if not exists public.pars_chat_logs (
  id uuid primary key default gen_random_uuid(),
  session_id text not null default '',
  lang text not null default 'fa',
  question text not null,
  answer text not null default '',
  unknown boolean not null default false,
  rating smallint,
  reviewed boolean not null default false,
  model text not null default '',
  visitor text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists pars_chat_logs_created_idx on public.pars_chat_logs (created_at desc);

-- -------------------------------------------------------------- rate limit
create table if not exists public.pars_rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 0
);

create or replace function public.pars_hit_rate_limit(p_key text, p_window integer, p_max integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into pars_rate_limits as r (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update set
    count = case when r.window_start < now() - make_interval(secs => p_window) then 1 else r.count + 1 end,
    window_start = case when r.window_start < now() - make_interval(secs => p_window) then now() else r.window_start end
  returning count into v_count;
  if random() < 0.01 then
    delete from pars_rate_limits where window_start < now() - interval '2 days';
  end if;
  return v_count <= p_max;
end;
$$;

revoke all on function public.pars_hit_rate_limit(text, integer, integer) from public, anon, authenticated;

-- --------------------------------------------------------------------- RLS
alter table public.pars_settings enable row level security;
alter table public.pars_knowledge enable row level security;
alter table public.pars_demos enable row level security;
alter table public.pars_tickets enable row level security;
alter table public.pars_ticket_messages enable row level security;
alter table public.pars_chat_logs enable row level security;
alter table public.pars_rate_limits enable row level security;
