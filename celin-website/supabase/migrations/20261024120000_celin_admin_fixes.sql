-- CELIN website — admin fixes (October 2026). Idempotent: safe to run more than once, in any order after the
-- earlier files. The site keeps working before this file has run.
--
-- 1. celin_migrations: every SQL file from now on records its name here, so Admin → Connections can tell
--    exactly which files have run (earlier files are recognised by their effects instead).
-- 2. Pro codes in the inbox: a stored message names the code it was written for ({{pro-code:<id>}}), so an
--    older message never shows a newer code. Messages written before that carry {{pro-code}}; each is tied
--    here to the code issued for it (the member's newest code created no later than the message).
-- 3. An index for «is this picture still shown in an order?» (Admin → تصاویر سایت → کتابخانه).

-- ------------------------------------------------------------------ 1. which files have run
create table if not exists public.celin_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
alter table public.celin_migrations enable row level security;

-- ------------------------------------------------------------------ 2. codes named in stored messages
update public.celin_messages m
set
  body_fa = replace(m.body_fa, '{{pro-code}}', '{{pro-code:' || k.code_id::text || '}}'),
  body_en = replace(m.body_en, '{{pro-code}}', '{{pro-code:' || k.code_id::text || '}}')
from (
  select
    x.id as message_id,
    (
      select c.id
      from public.celin_pro_codes c
      where c.user_id = x.user_id and c.created_at <= x.created_at + interval '1 second'
      order by c.created_at desc
      limit 1
    ) as code_id
  from public.celin_messages x
  where x.kind = 'pro'
    and (x.body_fa like '%{{pro-code}}%' or x.body_en like '%{{pro-code}}%')
) k
where m.id = k.message_id
  and k.code_id is not null;

-- ------------------------------------------------------------------ 3. order pictures
create index if not exists celin_order_items_image_path_idx on public.celin_order_items ((image ->> 'path'));

insert into public.celin_migrations (name) values ('20261024120000_celin_admin_fixes') on conflict (name) do nothing;
