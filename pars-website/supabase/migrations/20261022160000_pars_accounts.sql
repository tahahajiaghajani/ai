-- Pars website: visitor accounts (sign-in / sign-up) and roles.
-- Accounts live in their own table, not in Supabase Auth: the site may share a Supabase project with
-- another app (e.g. Task Flow), and auth.users there is that app's user list.
-- Idempotent: safe to run more than once (also over an earlier draft that linked tickets to auth.users).

create table if not exists public.pars_users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  -- scrypt$N$r$p$salt$hash (base64url); written only by the server
  password_hash text not null,
  name text not null default '',
  phone text not null default '',
  organization text not null default '',
  role text not null default 'user' check (role in ('user', 'admin')),
  disabled boolean not null default false,
  -- bumped on password change, disable or "sign out everywhere": older sessions and reset links stop working
  session_version integer not null default 0,
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists pars_users_email_key on public.pars_users (lower(email));
create index if not exists pars_users_created_idx on public.pars_users (created_at desc);

-- RLS on, no policies: only the server (service role) reads and writes.
alter table public.pars_users enable row level security;

-- tickets belong to the account that submitted them
alter table public.pars_tickets add column if not exists user_id uuid;
alter table public.pars_tickets drop constraint if exists pars_tickets_user_id_fkey;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pars_tickets_user_fk') then
    -- an earlier draft stored auth.users ids here; those rows simply lose their owner
    update public.pars_tickets t set user_id = null where user_id is not null and not exists (select 1 from public.pars_users u where u.id = t.user_id);
    alter table public.pars_tickets add constraint pars_tickets_user_fk foreign key (user_id) references public.pars_users(id) on delete set null;
  end if;
end $$;
create index if not exists pars_tickets_user_idx on public.pars_tickets (user_id, created_at desc);
