-- Pars website — blog posts (idempotent). Run after the earlier files in this folder.
create extension if not exists pgcrypto;

create table if not exists public.pars_posts (
  id uuid primary key default gen_random_uuid(),
  lang text not null default 'fa' check (lang in ('fa', 'en')),
  slug text not null,
  title text not null,
  excerpt text not null default '',
  body text not null default '',
  cover_url text not null default '',
  tags text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lang, slug)
);

create index if not exists pars_posts_published_idx on public.pars_posts (lang, status, published_at desc);

-- RLS on with no policies: only the server (service-role key) reads and writes
alter table public.pars_posts enable row level security;
