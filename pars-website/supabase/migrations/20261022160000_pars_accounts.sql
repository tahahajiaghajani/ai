-- Pars website: visitor accounts (sign-in / sign-up) and roles.
-- Credentials live in Supabase Auth (auth.users); this table holds the profile and the role.
-- Idempotent: safe to run more than once.

create table if not exists public.pars_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null default '',
  phone text not null default '',
  organization text not null default '',
  role text not null default 'user' check (role in ('user', 'admin')),
  disabled boolean not null default false,
  -- bumped on password change, disable or "sign out everywhere": older sessions stop working
  session_version integer not null default 0,
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pars_profiles_email_idx on public.pars_profiles (lower(email));
create index if not exists pars_profiles_created_idx on public.pars_profiles (created_at desc);

-- RLS on, no policies: only the server (service role) reads and writes.
alter table public.pars_profiles enable row level security;

-- tickets belong to the account that submitted them
alter table public.pars_tickets add column if not exists user_id uuid references auth.users(id) on delete set null;
create index if not exists pars_tickets_user_idx on public.pars_tickets (user_id, created_at desc);
