-- CELIN — the owner's fifth round of notes. Idempotent; safe to run more than once.
--
-- 1. Collections: «سلین» holds every piece and «میرا» is announced «به زودی» (no picture, no pieces yet). The other
--    collections are hidden, not deleted (Admin → دسته‌ها و مجموعه‌ها can delete them). Only when the catalogue
--    already lives in the database; a new site gets the same two from the starter catalogue.
-- 2. Membership and Pro (src/lib/pricing.ts):
--    - an approved member (membership code) sees stock and pays the list price (200% of the admin's price), stepped
--      down by the number of pieces in one order; a Pro account always pays the admin's price;
--    - celin_users.pro_at / pro_by: the account is Pro from then on ('auto' when its accepted orders reached the
--      threshold, 'admin' when set by hand);
--    - celin_pro_codes.kind: 'member' (the membership code) or 'pro' (the separate code issued with Pro);
--    - an order keeps what the member saw: celin_order_items.list_price (one piece at the list price),
--      celin_orders.list_subtotal (the lines at the list price) and pricing (level, percentages, pieces), while
--      unit_price / subtotal stay what is charged;
--    - celin_place_order(…, p_pricing): the order function with these rules (the four-argument one stays for
--      the version of the site that is live while this file runs).

-- ------------------------------------------------------------------ 1. collections
do $$
declare
  v_initialized boolean;
  v_celin uuid;
  v_media uuid;
begin
  if exists (select 1 from public.celin_migrations where name = '20261111100000_celin_membership_pro') then
    return; -- applied before: never undo what the admin has changed since
  end if;
  select coalesce((value ->> 'initialized')::boolean, false) into v_initialized from public.celin_settings where key = 'catalog';
  if not coalesce(v_initialized, false) then
    return;
  end if;

  select id into v_celin from public.celin_collections where slug = 'celin';
  if v_celin is null then
    select media_id into v_media from public.celin_collections where media_id is not null order by sort, created_at limit 1;
    insert into public.celin_collections (slug, name_fa, name_en, tagline_fa, tagline_en, story_fa, story_en, media_id, sort, visible)
    values (
      'celin', 'سلین', 'CELIN', 'فراتر از یک زیور', 'More than an ornament',
      'سلین؛ برای کسانی که زیبایی را در جزئیات می‌بینند و تفاوت را در کیفیت احساس می‌کنند.',
      'CELIN — for those who see beauty in the details and feel the difference in quality.',
      v_media, 0, true
    )
    returning id into v_celin;
  else
    update public.celin_collections set visible = true, sort = 0 where id = v_celin;
  end if;

  if not exists (select 1 from public.celin_collections where slug = 'mira') then
    insert into public.celin_collections (slug, name_fa, name_en, media_id, sort, visible)
    values ('mira', 'میرا', 'Mira', null, 1, true);
  else
    update public.celin_collections set visible = true, sort = 1 where slug = 'mira';
  end if;

  update public.celin_products
  set collection_id = v_celin
  where collection_id is distinct from v_celin
    and (collection_id is null or collection_id not in (select id from public.celin_collections where slug = 'mira'));

  update public.celin_collections set visible = false where slug not in ('celin', 'mira') and visible;
end $$;

-- ------------------------------------------------------------------ 2. membership and Pro
alter table public.celin_users add column if not exists pro_at timestamptz;
alter table public.celin_users add column if not exists pro_by text not null default '';

alter table public.celin_pro_codes add column if not exists kind text not null default 'member';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'celin_pro_codes_kind_check') then
    alter table public.celin_pro_codes add constraint celin_pro_codes_kind_check check (kind in ('member', 'pro'));
  end if;
end $$;

alter table public.celin_order_items add column if not exists list_price bigint;
alter table public.celin_orders add column if not exists list_subtotal bigint not null default 0;
alter table public.celin_orders add column if not exists pricing jsonb not null default '{}'::jsonb;
-- «how much has this account bought in the last 30 days»
create index if not exists celin_orders_user_created_idx on public.celin_orders (user_id, created_at desc);

-- Places an order in one transaction, as celin_place_order(uuid, jsonb, jsonb, text) does (locks, published and in
-- stock, the price from the database, stock lowered), with the price rules of the account:
-- p_pricing = {"level": "member" | "pro", "list": 200, "steps": [[6, 150], [11, 130], …]}. Each piece is shown at
-- round(price × list / 100) and charged at round(price × pct / 100), pct being the step reached by the pieces of the
-- whole order (the list percentage below the first step).
create or replace function public.celin_place_order(p_user uuid, p_items jsonb, p_customer jsonb, p_note text, p_pricing jsonb)
returns table (order_id uuid, order_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_step jsonb;
  v_prod celin_products%rowtype;
  v_var celin_variants%rowtype;
  v_qty integer;
  v_price bigint;
  v_list bigint;
  v_unit bigint;
  v_list_pct integer;
  v_pct integer;
  v_step_min integer;
  v_step_pct integer;
  v_pieces integer := 0;
  v_sub bigint := 0;
  v_list_sub bigint := 0;
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
  begin
    v_list_pct := (p_pricing ->> 'list')::integer;
  exception when others then
    raise exception 'bad_pricing';
  end;
  if v_list_pct is null or v_list_pct < 100 or v_list_pct > 1000 or coalesce(p_pricing ->> 'level', '') not in ('member', 'pro') then
    raise exception 'bad_pricing';
  end if;

  -- the pieces of the whole order decide the step
  for v_item in select value from jsonb_array_elements(p_items) loop
    begin
      v_qty := (v_item ->> 'qty')::integer;
    exception when others then
      raise exception 'bad_qty';
    end;
    if v_qty is null or v_qty < 1 or v_qty > 999 then
      raise exception 'bad_qty';
    end if;
    v_pieces := v_pieces + v_qty;
  end loop;
  v_pct := v_list_pct;
  if jsonb_typeof(p_pricing -> 'steps') = 'array' then
    for v_step in select value from jsonb_array_elements(p_pricing -> 'steps') loop
      begin
        v_step_min := (v_step ->> 0)::integer;
        v_step_pct := (v_step ->> 1)::integer;
      exception when others then
        raise exception 'bad_pricing';
      end;
      if v_step_min is null or v_step_pct is null or v_step_pct < 100 then
        raise exception 'bad_pricing';
      end if;
      if v_pieces >= v_step_min and v_step_pct < v_pct then
        v_pct := v_step_pct;
      end if;
    end loop;
  end if;

  loop
    v_code := 'CL-' || lpad((floor(random() * 1000000))::integer::text, 6, '0');
    exit when not exists (select 1 from celin_orders where code = v_code);
  end loop;

  insert into celin_orders (code, user_id, customer, note)
  values (v_code, p_user, coalesce(p_customer, '{}'::jsonb), left(coalesce(p_note, ''), 2000))
  returning id into v_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_qty := (v_item ->> 'qty')::integer;

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
      v_list := round(v_price * v_list_pct / 100.0)::bigint;
      v_unit := round(v_price * v_pct / 100.0)::bigint;
      insert into celin_order_items (order_id, product_id, variant_id, name_fa, name_en, variant_fa, variant_en, sku, slug, image, unit_price, list_price, qty)
      values (v_id, v_prod.id, v_var.id, v_prod.name_fa, v_prod.name_en, v_var.name_fa, v_var.name_en,
              coalesce(nullif(v_var.sku, ''), v_prod.sku), v_prod.slug, v_img, v_unit, v_list, v_qty);
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
      v_list := round(v_price * v_list_pct / 100.0)::bigint;
      v_unit := round(v_price * v_pct / 100.0)::bigint;
      insert into celin_order_items (order_id, product_id, name_fa, name_en, sku, slug, image, unit_price, list_price, qty)
      values (v_id, v_prod.id, v_prod.name_fa, v_prod.name_en, v_prod.sku, v_prod.slug, v_img, v_unit, v_list, v_qty);
    end if;

    v_sub := v_sub + v_unit * v_qty;
    v_list_sub := v_list_sub + v_list * v_qty;
    v_count := v_count + v_qty;
  end loop;

  update celin_orders
  set subtotal = v_sub,
      list_subtotal = v_list_sub,
      items_count = v_count,
      pricing = jsonb_build_object('level', p_pricing ->> 'level', 'list', v_list_pct, 'pct', v_pct, 'pieces', v_pieces)
  where id = v_id;
  insert into celin_order_events (order_id, status, actor) values (v_id, 'pending', 'customer');
  return query select v_id, v_code;
end;
$$;

revoke all on function public.celin_place_order(uuid, jsonb, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.celin_place_order(uuid, jsonb, jsonb, text, jsonb) to service_role;

insert into public.celin_migrations (name) values ('20261111100000_celin_membership_pro') on conflict (name) do nothing;
