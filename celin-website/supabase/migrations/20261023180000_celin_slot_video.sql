-- CELIN website — optional looping background video for some design slots (Admin → تصاویر سایت → «ویدئو (اختیاری)»).
-- The admin's browser uploads the file straight into the storage bucket with a signed upload URL; the server
-- checks the stored object (size and first bytes) and records it here. The slot's picture stays the poster and
-- the fallback. Idempotent: safe to run more than once. RLS on, no policies (only the server reads and writes).

create table if not exists public.celin_videos (
  id uuid primary key default gen_random_uuid(),
  -- object in the bucket "celin-media": v/<uuid>.mp4 or v/<uuid>.webm (a new file always gets a new name)
  path text not null check (path ~ '^v/[0-9a-f-]{36}\.(mp4|webm)$'),
  mime text not null check (mime in ('video/mp4', 'video/webm')),
  bytes integer not null default 0 check (bytes >= 0),
  width integer not null default 0,
  height integer not null default 0,
  -- seconds
  duration real not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists celin_videos_path_key on public.celin_videos (path);
create index if not exists celin_videos_created_idx on public.celin_videos (created_at desc);

alter table public.celin_slots add column if not exists video_id uuid references public.celin_videos (id) on delete set null;
create index if not exists celin_slots_video_idx on public.celin_slots (video_id);

alter table public.celin_videos enable row level security;

-- the bucket also takes the videos (MP4 / WebM, up to 26 MiB; the site itself allows 25 MB)
update storage.buckets
set
  file_size_limit = greatest(coalesce(file_size_limit, 0), 27262976),
  allowed_mime_types = case
    when allowed_mime_types is null then null
    else (select array_agg(distinct t order by t) from unnest(allowed_mime_types || array['video/mp4', 'video/webm']) as t)
  end
where id = 'celin-media';
