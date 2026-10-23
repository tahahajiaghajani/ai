-- CELIN website — complete schema: settings, media + site image slots, catalogue (categories, collections,
-- products, variants), accounts, Pro requests and codes, inbox messages, orders, rate limits, storage bucket.
-- Idempotent: safe to run more than once. Every table has RLS on and no policies, so the public (anon) key
-- reads nothing; only the server (service role) reads and writes. Functions are revoked from anon/authenticated.

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------ settings
create table if not exists public.celin_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ media
-- One uploaded picture in several widths: <path>/<width>.<ext>. `path` is a folder in the storage bucket
-- "celin-media" (e.g. m/2f1c…), or a static folder of the site starting with "/" (the starter images).
create table if not exists public.celin_media (
  id uuid primary key default gen_random_uuid(),
  path text not null,
  ext text not null default 'webp' check (ext in ('webp', 'jpg', 'png', 'avif')),
  widths integer[] not null default '{}',
  width integer not null default 0,
  height integer not null default 0,
  -- tiny blurred preview (data URL) shown while the picture loads
  placeholder text not null default '',
  -- focal point in percent: crops to other aspect ratios keep this point in view
  focal_x smallint not null default 50 check (focal_x between 0 and 100),
  focal_y smallint not null default 50 check (focal_y between 0 and 100),
  alt_fa text not null default '',
  alt_en text not null default '',
  bytes integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists celin_media_created_idx on public.celin_media (created_at desc);

-- the site's design pictures: one row per slot the admin has changed (others use the built-in default)
create table if not exists public.celin_slots (
  key text primary key,
  media_id uuid references public.celin_media (id) on delete set null,
  media_mobile_id uuid references public.celin_media (id) on delete set null,
  texts jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ catalogue
create table if not exists public.celin_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name_fa text not null,
  name_en text not null default '',
  description_fa text not null default '',
  description_en text not null default '',
  media_id uuid references public.celin_media (id) on delete set null,
  sort integer not null default 0,
  visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists celin_categories_slug_key on public.celin_categories (slug);

create table if not exists public.celin_collections (
  id uuid primary key default gen_random_uuid(),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name_fa text not null,
  name_en text not null default '',
  tagline_fa text not null default '',
  tagline_en text not null default '',
  story_fa text not null default '',
  story_en text not null default '',
  media_id uuid references public.celin_media (id) on delete set null,
  sort integer not null default 0,
  visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists celin_collections_slug_key on public.celin_collections (slug);

create table if not exists public.celin_products (
  id uuid primary key default gen_random_uuid(),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  sku text not null default '',
  name_fa text not null,
  name_en text not null default '',
  subtitle_fa text not null default '',
  subtitle_en text not null default '',
  description_fa text not null default '',
  description_en text not null default '',
  category_id uuid references public.celin_categories (id) on delete set null,
  collection_id uuid references public.celin_collections (id) on delete set null,
  -- facets for the shop filters: plating colour (gold | silver | rose | two-tone) and stone colour
  metal text not null default '',
  stone text not null default '',
  -- [{ "label_fa", "label_en", "value_fa", "value_en" }]
  specs jsonb not null default '[]'::jsonb,
  -- ordered celin_media ids; the first is the cover
  images uuid[] not null default '{}',
  -- Toman; null = no price yet (Pro members see «استعلام قیمت»)
  price bigint check (price is null or price >= 0),
  stock integer not null default 0 check (stock >= 0),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  featured boolean not null default false,
  badge text not null default '' check (badge in ('', 'new', 'bestseller', 'limited')),
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists celin_products_slug_key on public.celin_products (slug);
create index if not exists celin_products_status_idx on public.celin_products (status, sort, created_at desc);
create index if not exists celin_products_category_idx on public.celin_products (category_id);
create index if not exists celin_products_collection_idx on public.celin_products (collection_id);

-- options of one product (e.g. gold / silver plating, stone colour), each with its own stock and optional price
create table if not exists public.celin_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.celin_products (id) on delete cascade,
  name_fa text not null,
  name_en text not null default '',
  -- gold | silver | rose | black | two-tone | #rrggbb
  swatch text not null default '',
  sku text not null default '',
  price bigint check (price is null or price >= 0),
  stock integer not null default 0 check (stock >= 0),
  image_id uuid references public.celin_media (id) on delete set null,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists celin_variants_product_idx on public.celin_variants (product_id, sort);

-- ------------------------------------------------------------------ accounts
-- Own table, not Supabase Auth: the Supabase project may be shared with another app.
create table if not exists public.celin_users (
  id uuid primary key default gen_random_uuid(),
  -- Iranian mobile, normalised to 09xxxxxxxxx; the sign-in name
  phone text not null,
  email text not null default '',
  -- scrypt$N$r$p$salt$hash; null for an account the admin created: it signs in with its Pro code until a password is set
  password_hash text,
  name text not null default '',
  business text not null default '',
  city text not null default '',
  address text not null default '',
  postal_code text not null default '',
  role text not null default 'user' check (role in ('user', 'admin')),
  disabled boolean not null default false,
  -- bumped on password change, disable or "sign out everywhere": older sessions stop working
  session_version integer not null default 0,
  created_by_admin boolean not null default false,
  admin_note text not null default '',
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists celin_users_phone_key on public.celin_users (phone);
create unique index if not exists celin_users_email_key on public.celin_users (lower(email)) where email <> '';
create index if not exists celin_users_created_idx on public.celin_users (created_at desc);

-- ------------------------------------------------------------------ Pro membership
create table if not exists public.celin_pro_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.celin_users (id) on delete cascade,
  business text not null default '',
  city text not null default '',
  instagram text not null default '',
  -- retail | online | wholesale | personal | other
  kind text not null default 'retail',
  note text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  -- shown to the member (e.g. why a request was declined)
  reply text not null default '',
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists celin_pro_requests_status_idx on public.celin_pro_requests (status, created_at desc);
create index if not exists celin_pro_requests_user_idx on public.celin_pro_requests (user_id, created_at desc);

-- A Pro code unlocks prices and stock for one account. Only an HMAC of the code is looked up; an encrypted
-- copy lets the admin show or resend it. A code is active while not revoked and not expired.
create table if not exists public.celin_pro_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.celin_users (id) on delete cascade,
  code_hash text not null,
  code_enc text not null,
  hint text not null default '',
  request_id uuid references public.celin_pro_requests (id) on delete set null,
  expires_at timestamptz,
  redeemed_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists celin_pro_codes_hash_key on public.celin_pro_codes (code_hash);
create index if not exists celin_pro_codes_user_idx on public.celin_pro_codes (user_id, created_at desc);

-- ------------------------------------------------------------------ inbox
create table if not exists public.celin_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.celin_users (id) on delete cascade,
  kind text not null default 'info' check (kind in ('info', 'pro', 'order')),
  title_fa text not null default '',
  title_en text not null default '',
  body_fa text not null default '',
  body_en text not null default '',
  link text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists celin_messages_user_idx on public.celin_messages (user_id, created_at desc);

-- ------------------------------------------------------------------ orders
create table if not exists public.celin_orders (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  user_id uuid references public.celin_users (id) on delete set null,
  -- pending (در انتظار تایید فروشگاه) → packing (در حال جمع‌آوری و بسته‌بندی) → ready (آماده‌ی ارسال) → shipped (ارسال شد); or cancelled
  status text not null default 'pending' check (status in ('pending', 'packing', 'ready', 'shipped', 'cancelled')),
  subtotal bigint not null default 0 check (subtotal >= 0),
  shipping_fee bigint not null default 0 check (shipping_fee >= 0),
  discount bigint not null default 0 check (discount >= 0),
  total bigint generated always as (greatest(subtotal + shipping_fee - discount, 0)) stored,
  items_count integer not null default 0,
  -- snapshot at ordering time: { name, phone, business, city, address, postal_code }
  customer jsonb not null default '{}'::jsonb,
  note text not null default '',
  admin_note text not null default '',
  carrier text not null default '',
  tracking_code text not null default '',
  cancel_reason text not null default '',
  status_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists celin_orders_code_key on public.celin_orders (code);
create index if not exists celin_orders_user_idx on public.celin_orders (user_id, created_at desc);
create index if not exists celin_orders_status_idx on public.celin_orders (status, created_at desc);

create table if not exists public.celin_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.celin_orders (id) on delete cascade,
  product_id uuid references public.celin_products (id) on delete set null,
  variant_id uuid references public.celin_variants (id) on delete set null,
  name_fa text not null default '',
  name_en text not null default '',
  variant_fa text not null default '',
  variant_en text not null default '',
  sku text not null default '',
  slug text not null default '',
  -- the cover picture at ordering time: { path, ext, widths, width, height, placeholder }
  image jsonb,
  unit_price bigint not null check (unit_price >= 0),
  qty integer not null check (qty > 0),
  line_total bigint generated always as (unit_price * qty) stored
);
create index if not exists celin_order_items_order_idx on public.celin_order_items (order_id);

create table if not exists public.celin_order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.celin_orders (id) on delete cascade,
  status text not null,
  note text not null default '',
  -- customer | admin | system
  actor text not null default 'system',
  created_at timestamptz not null default now()
);
create index if not exists celin_order_events_order_idx on public.celin_order_events (order_id, created_at);

-- ------------------------------------------------------------------ rate limits
create table if not exists public.celin_rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 0
);

create or replace function public.celin_hit_rate_limit(p_key text, p_window integer, p_max integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into celin_rate_limits as r (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update set
    count = case when r.window_start < now() - make_interval(secs => p_window) then 1 else r.count + 1 end,
    window_start = case when r.window_start < now() - make_interval(secs => p_window) then now() else r.window_start end
  returning count into v_count;
  if random() < 0.01 then
    delete from celin_rate_limits where window_start < now() - interval '2 days';
  end if;
  return v_count <= p_max;
end;
$$;

-- ------------------------------------------------------------------ ordering
-- Places an order in one transaction: locks each product/variant, checks it is published and in stock,
-- takes the current price from the database (never from the browser), lowers the stock and writes the
-- order, its lines and the first event. Errors are raised as '<reason>:<id>' for the app to explain.
create or replace function public.celin_place_order(p_user uuid, p_items jsonb, p_customer jsonb, p_note text)
returns table (order_id uuid, order_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_prod celin_products%rowtype;
  v_var celin_variants%rowtype;
  v_qty integer;
  v_price bigint;
  v_sub bigint := 0;
  v_count integer := 0;
  v_id uuid;
  v_code text;
  v_img jsonb;
  v_has_variants boolean;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_order';
  end if;
  if jsonb_array_length(p_items) > 100 then
    raise exception 'too_many_items';
  end if;
  if not exists (select 1 from celin_users where id = p_user and not disabled) then
    raise exception 'no_account';
  end if;

  loop
    v_code := 'CL-' || lpad((floor(random() * 1000000))::integer::text, 6, '0');
    exit when not exists (select 1 from celin_orders where code = v_code);
  end loop;

  insert into celin_orders (code, user_id, customer, note)
  values (v_code, p_user, coalesce(p_customer, '{}'::jsonb), left(coalesce(p_note, ''), 2000))
  returning id into v_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    begin
      v_qty := (v_item ->> 'qty')::integer;
    exception when others then
      raise exception 'bad_qty';
    end;
    if v_qty is null or v_qty < 1 or v_qty > 999 then
      raise exception 'bad_qty';
    end if;

    select * into v_prod from celin_products
    where id = nullif(v_item ->> 'product_id', '')::uuid and status = 'published'
    for update;
    if not found then
      raise exception 'product_unavailable:%', v_item ->> 'product_id';
    end if;

    select exists (select 1 from celin_variants where product_id = v_prod.id) into v_has_variants;
    select to_jsonb(m) - 'id' - 'created_at' - 'bytes' - 'alt_fa' - 'alt_en' into v_img
    from celin_media m where m.id = v_prod.images[1];

    if coalesce(v_item ->> 'variant_id', '') <> '' then
      select * into v_var from celin_variants
      where id = (v_item ->> 'variant_id')::uuid and product_id = v_prod.id
      for update;
      if not found then
        raise exception 'variant_unavailable:%', v_item ->> 'variant_id';
      end if;
      v_price := coalesce(v_var.price, v_prod.price);
      if v_price is null then
        raise exception 'no_price:%', v_prod.id;
      end if;
      if v_var.stock < v_qty then
        raise exception 'out_of_stock:%', v_var.id;
      end if;
      update celin_variants set stock = stock - v_qty, updated_at = now() where id = v_var.id;
      if v_var.image_id is not null then
        select to_jsonb(m) - 'id' - 'created_at' - 'bytes' - 'alt_fa' - 'alt_en' into v_img
        from celin_media m where m.id = v_var.image_id;
      end if;
      insert into celin_order_items (order_id, product_id, variant_id, name_fa, name_en, variant_fa, variant_en, sku, slug, image, unit_price, qty)
      values (v_id, v_prod.id, v_var.id, v_prod.name_fa, v_prod.name_en, v_var.name_fa, v_var.name_en,
              coalesce(nullif(v_var.sku, ''), v_prod.sku), v_prod.slug, v_img, v_price, v_qty);
    else
      if v_has_variants then
        raise exception 'variant_required:%', v_prod.id;
      end if;
      v_price := v_prod.price;
      if v_price is null then
        raise exception 'no_price:%', v_prod.id;
      end if;
      if v_prod.stock < v_qty then
        raise exception 'out_of_stock:%', v_prod.id;
      end if;
      update celin_products set stock = stock - v_qty where id = v_prod.id;
      insert into celin_order_items (order_id, product_id, name_fa, name_en, sku, slug, image, unit_price, qty)
      values (v_id, v_prod.id, v_prod.name_fa, v_prod.name_en, v_prod.sku, v_prod.slug, v_img, v_price, v_qty);
    end if;

    v_sub := v_sub + v_price * v_qty;
    v_count := v_count + v_qty;
  end loop;

  update celin_orders set subtotal = v_sub, items_count = v_count where id = v_id;
  insert into celin_order_events (order_id, status, actor) values (v_id, 'pending', 'customer');
  return query select v_id, v_code;
end;
$$;

-- Moves an order to a status. Cancelling puts the stock back (once); a cancelled order stays cancelled.
-- With p_only_from set (e.g. 'pending' when the customer cancels), the change happens only from that status.
create or replace function public.celin_set_order_status(p_order uuid, p_status text, p_note text, p_actor text, p_only_from text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order celin_orders%rowtype;
  v_line record;
begin
  if p_status not in ('pending', 'packing', 'ready', 'shipped', 'cancelled') then
    raise exception 'bad_status';
  end if;
  select * into v_order from celin_orders where id = p_order for update;
  if not found then
    raise exception 'order_not_found';
  end if;
  if v_order.status = p_status then
    return v_order.status;
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'order_cancelled';
  end if;
  if p_only_from is not null and v_order.status <> p_only_from then
    raise exception 'status_changed';
  end if;

  if p_status = 'cancelled' then
    for v_line in select variant_id, product_id, qty from celin_order_items where order_id = p_order loop
      if v_line.variant_id is not null then
        update celin_variants set stock = stock + v_line.qty, updated_at = now() where id = v_line.variant_id;
      elsif v_line.product_id is not null then
        update celin_products set stock = stock + v_line.qty where id = v_line.product_id;
      end if;
    end loop;
  end if;

  update celin_orders set
    status = p_status,
    status_changed_at = now(),
    updated_at = now(),
    cancel_reason = case when p_status = 'cancelled' then left(coalesce(p_note, ''), 500) else cancel_reason end
  where id = p_order;
  insert into celin_order_events (order_id, status, note, actor)
  values (p_order, p_status, left(coalesce(p_note, ''), 1000), coalesce(nullif(p_actor, ''), 'admin'));
  return p_status;
end;
$$;

-- Counts for the admin dashboard and menu badges in one round trip.
create or replace function public.celin_admin_counts()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'orders', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from celin_orders group by status) s),
    'requests_pending', (select count(*) from celin_pro_requests where status = 'pending'),
    'users', (select count(*) from celin_users),
    'pro_active', (select count(distinct user_id) from celin_pro_codes where revoked_at is null and redeemed_at is not null and (expires_at is null or expires_at > now())),
    'products', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from celin_products group by status) p),
    'low_stock', (
      select count(*) from celin_products p
      where p.status = 'published' and (
        (not exists (select 1 from celin_variants v where v.product_id = p.id) and p.stock <= 2)
        or exists (select 1 from celin_variants v where v.product_id = p.id and v.stock <= 2)
      )
    ),
    'sales_total', (select coalesce(sum(total), 0) from celin_orders where status <> 'cancelled'),
    'sales_month', (select coalesce(sum(total), 0) from celin_orders where status <> 'cancelled' and created_at > now() - interval '30 days')
  );
$$;

revoke all on function public.celin_hit_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.celin_place_order(uuid, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.celin_set_order_status(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.celin_admin_counts() from public, anon, authenticated;
grant execute on function public.celin_hit_rate_limit(text, integer, integer) to service_role;
grant execute on function public.celin_place_order(uuid, jsonb, jsonb, text) to service_role;
grant execute on function public.celin_set_order_status(uuid, text, text, text, text) to service_role;
grant execute on function public.celin_admin_counts() to service_role;

-- ------------------------------------------------------------------ RLS (on, no policies)
alter table public.celin_settings enable row level security;
alter table public.celin_media enable row level security;
alter table public.celin_slots enable row level security;
alter table public.celin_categories enable row level security;
alter table public.celin_collections enable row level security;
alter table public.celin_products enable row level security;
alter table public.celin_variants enable row level security;
alter table public.celin_users enable row level security;
alter table public.celin_pro_requests enable row level security;
alter table public.celin_pro_codes enable row level security;
alter table public.celin_messages enable row level security;
alter table public.celin_orders enable row level security;
alter table public.celin_order_items enable row level security;
alter table public.celin_order_events enable row level security;
alter table public.celin_rate_limits enable row level security;

-- ------------------------------------------------------------------ storage
-- Public bucket for the pictures (read by anyone through the CDN URL; uploads only through the server).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('celin-media', 'celin-media', true, 6291456, array['image/webp', 'image/jpeg', 'image/png', 'image/avif'])
on conflict (id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
