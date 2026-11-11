-- CELIN — the owner's fifth round of notes. Idempotent; safe to run more than once.
--
-- 1. Collections: «سلین» holds every piece and «میرا» is announced «به زودی» (no picture, no pieces yet). The other
--    collections are hidden, not deleted (Admin → دسته‌ها و مجموعه‌ها can delete them). Only when the catalogue
--    already lives in the database; a new site gets the same two from the starter catalogue.
-- 2. Membership and Pro (src/lib/pricing.ts):
--    - an approved member (membership code) sees stock and pays the list price (200% of the admin's price), stepped
--      down by the number of pieces in one order; a Pro account always pays the admin's price;
--    - celin_users.pro_at / pro_by: the account is Pro from then on ('auto' when the goods of its accepted orders
--      reached the threshold, 'admin' when set by hand); pro_off_at: when the admin last took Pro away (only orders
--      placed after it count towards Pro again);
--    - celin_pro_codes.kind: 'member' (the membership code) or 'pro' (the separate code issued with Pro);
--    - an order keeps what the member saw: celin_order_items.list_price (one piece at the list price),
--      celin_orders.list_subtotal (the lines at the list price) and pricing (level, percentages, pieces), while
--      unit_price / subtotal stay what is charged;
--    - celin_place_order(…, p_pricing): the order function with these rules. The older four-argument one is
--      dropped: it charged everyone the admin's price (an older deployment of the site can no longer place orders
--      at the wrong price; the new site refuses orders until this file has run).
-- 3. Texts the admin saved in «تصاویر سایت» that still hold an old default are brought in line (membership wording,
--    no «ضمانت», the owner's year-of-birth line, stones and plating lines, the CELIN collection link); product specs
--    and descriptions of the starter catalogue that still say «تراش اتمی» say «تراش مشابه برلیان». Only values that
--    still equal the old text exactly change, so anything the owner wrote stays as it is.

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
alter table public.celin_users add column if not exists pro_off_at timestamptz;

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

-- the older order function charged every account the admin's price
drop function if exists public.celin_place_order(uuid, jsonb, jsonb, text);

-- ------------------------------------------------------------------ 3. saved texts
update public.celin_slots set texts = jsonb_set(texts, '{eyebrow,fa}', to_jsonb('نگهداری'::text)), updated_at = now()
where key = 'care.hero' and texts #>> '{eyebrow,fa}' = 'نگهداری و ضمانت';
update public.celin_slots set texts = jsonb_set(texts, '{eyebrow,en}', to_jsonb('Care'::text)), updated_at = now()
where key = 'care.hero' and texts #>> '{eyebrow,en}' = 'Care & warranty';
update public.celin_slots set texts = jsonb_set(texts, '{body,fa}', to_jsonb('سلین در سال ۱۳۸۵ بعد از یک دهه تجربه در صنعت بدلیجات و زیورآلات متولد شد.'::text)), updated_at = now()
where key = 'home.house' and texts #>> '{body,fa}' = 'سلین در سال ۱۳۸۵ متولد شد؛ با نگاهی متفاوت به دنیای زیورآلات و رؤیای خلق آثاری که زیبایی، ظرافت و کیفیت را در کنار یکدیگر معنا کنند.';
update public.celin_slots set texts = jsonb_set(texts, '{body,en}', to_jsonb('CELIN was born in 2006, after a decade of experience in the costume jewelry and jewelry industry.'::text)), updated_at = now()
where key = 'home.house' and texts #>> '{body,en}' = 'CELIN was born in 2006, with a different eye on the world of jewelry and a dream of creating pieces in which beauty, finesse and quality find their meaning together.';
update public.celin_slots set texts = jsonb_set(texts, '{eyebrow,fa}', to_jsonb('اعضای سلین'::text)), updated_at = now()
where key = 'home.pro' and texts #>> '{eyebrow,fa}' = 'اعضای Pro';
update public.celin_slots set texts = jsonb_set(texts, '{eyebrow,en}', to_jsonb('CELIN members'::text)), updated_at = now()
where key = 'home.pro' and texts #>> '{eyebrow,en}' = 'Pro members';
update public.celin_slots set texts = jsonb_set(texts, '{title,fa}', to_jsonb('موجودی، قیمت و سفارش برای اعضا'::text)), updated_at = now()
where key = 'home.pro' and texts #>> '{title,fa}' = 'قیمت، موجودی و سفارش برای همکاران';
update public.celin_slots set texts = jsonb_set(texts, '{title,en}', to_jsonb('Stock, prices and ordering for members'::text)), updated_at = now()
where key = 'home.pro' and texts #>> '{title,en}' = 'Prices, stock and ordering for partners';
update public.celin_slots set texts = jsonb_set(texts, '{body,fa}', to_jsonb('با عضویت سلین، موجودی و قیمت همه‌ی آثار را می‌بینید و سفارش خود را مستقیم ثبت می‌کنید؛ با خرید بیشتر، حساب شما خودبه‌خود Pro می‌شود.'::text)), updated_at = now()
where key = 'home.pro' and texts #>> '{body,fa}' = 'با اشتراک Pro، قیمت و موجودی همه‌ی آثار را می‌بینید و سفارش خود را مستقیم ثبت می‌کنید.';
update public.celin_slots set texts = jsonb_set(texts, '{body,en}', to_jsonb('As a CELIN member you see the stock and price of every piece and place your orders directly; buy more and your account becomes Pro on its own.'::text)), updated_at = now()
where key = 'home.pro' and texts #>> '{body,en}' = 'With Pro membership you see the price and stock of every piece and place your orders directly.';
update public.celin_slots set texts = jsonb_set(texts, '{cta,fa}', to_jsonb('درخواست عضویت'::text)), updated_at = now()
where key = 'home.pro' and texts #>> '{cta,fa}' = 'درخواست اشتراک Pro';
update public.celin_slots set texts = jsonb_set(texts, '{cta,en}', to_jsonb('Request membership'::text)), updated_at = now()
where key = 'home.pro' and texts #>> '{cta,en}' = 'Request Pro membership';
update public.celin_slots set texts = jsonb_set(texts, '{title,fa}', to_jsonb('عضویت و Pro سلین'::text)), updated_at = now()
where key = 'pro.hero' and texts #>> '{title,fa}' = 'اشتراک Pro سلین';
update public.celin_slots set texts = jsonb_set(texts, '{title,en}', to_jsonb('CELIN membership & Pro'::text)), updated_at = now()
where key = 'pro.hero' and texts #>> '{title,en}' = 'CELIN Pro membership';
update public.celin_slots set texts = jsonb_set(texts, '{subtitle,fa}', to_jsonb('برای پرسش درباره‌ی آثار، سفارش‌ها و عضویت، از هر راهی که برایتان آسان‌تر است با ما گفتگو کنید.'::text)), updated_at = now()
where key = 'contact.hero' and texts #>> '{subtitle,fa}' = 'برای پرسش درباره‌ی آثار، سفارش‌ها و اشتراک Pro، از هر راهی که برایتان آسان‌تر است با ما گفتگو کنید.';
update public.celin_slots set texts = jsonb_set(texts, '{subtitle,en}', to_jsonb('For questions about a piece, an order or membership, reach us whichever way suits you best.'::text)), updated_at = now()
where key = 'contact.hero' and texts #>> '{subtitle,en}' = 'For questions about a piece, an order or Pro membership, reach us whichever way suits you best.';
update public.celin_slots set texts = jsonb_set(texts, '{title,fa}', to_jsonb('سلین، روی دست'::text)), updated_at = now()
where key = 'shop.editorial' and texts #>> '{title,fa}' = 'گلبرگ، روی دست';
update public.celin_slots set texts = jsonb_set(texts, '{title,en}', to_jsonb('CELIN, worn'::text)), updated_at = now()
where key = 'shop.editorial' and texts #>> '{title,en}' = 'Golbarg, worn';
update public.celin_slots set texts = jsonb_set(texts, '{href,fa}', to_jsonb('/collections/celin'::text)), updated_at = now()
where key = 'shop.editorial' and texts #>> '{href,fa}' = '/collections/golbarg';
update public.celin_slots set texts = jsonb_set(texts, '{href,en}', to_jsonb('/collections/celin'::text)), updated_at = now()
where key = 'shop.editorial' and texts #>> '{href,en}' = '/collections/golbarg';
update public.celin_slots set texts = jsonb_set(texts, '{body,fa}', to_jsonb('نگین‌های درخشان با تراش مشابه برلیان، رنگ‌های خاص همچون زمرد، یاقوت سرخ، یاقوت کبود، سیترین و برلیان.'::text)), updated_at = now()
where key = 'home.craft.2' and texts #>> '{body,fa}' = 'نگین‌های درخشان با تراش اتمی؛ وجه‌هایی متقارن که نور را مثل جواهر برمی‌گردانند.';
update public.celin_slots set texts = jsonb_set(texts, '{body,en}', to_jsonb('Brilliant stones with a diamond-like cut, in special colors such as emerald, ruby, sapphire, citrine and diamond white.'::text)), updated_at = now()
where key = 'home.craft.2' and texts #>> '{body,en}' = 'Brilliant stones with an atomic cut: symmetrical facets that return light like a fine jewel.';
update public.celin_slots set texts = jsonb_set(texts, '{body,fa}', to_jsonb('آبکاری‌های با کیفیت بالای رودیوم، طلا و شامپاین گلد، به همراه لایه‌ی حفاظ نانو برای تثبیت بهتر کیفیت آبکاری.'::text)), updated_at = now()
where key = 'home.craft.4' and texts #>> '{body,fa}' = 'آبکاری‌های باکیفیت رودیوم و طلا، برای درخششی ماندگار در رنگ‌های نقره‌ای و طلایی.';
update public.celin_slots set texts = jsonb_set(texts, '{body,en}', to_jsonb('High-quality rhodium, gold and champagne-gold plating, with a nano protective layer that keeps the plating at its best.'::text)), updated_at = now()
where key = 'home.craft.4' and texts #>> '{body,en}' = 'Quality rhodium and gold plating, for a lasting shine in silver and gold tones.';
update public.celin_slots set texts = jsonb_set(texts, '{eyebrow,fa}', to_jsonb('تراش مشابه برلیان'::text)), updated_at = now()
where key = 'home.interlude' and texts #>> '{eyebrow,fa}' = 'تراش اتمی';
update public.celin_slots set texts = jsonb_set(texts, '{eyebrow,en}', to_jsonb('Diamond-like cut'::text)), updated_at = now()
where key = 'home.interlude' and texts #>> '{eyebrow,en}' = 'Atomic cut';
update public.celin_slots set texts = jsonb_set(texts, '{body,fa}', to_jsonb('در سلین، هر قطعه با الهام از ساختار و ظرافت طلا و جواهر طراحی و ساخته می‌شود؛ با نگین‌های درخشان، مخراج‌کاری دقیق و آبکاری‌های باکیفیت رودیوم، طلا و شامپاین گلد.'::text)), updated_at = now()
where key = 'home.interlude' and texts #>> '{body,fa}' = 'در سلین، هر قطعه با الهام از ساختار و ظرافت طلا و جواهر طراحی و ساخته می‌شود؛ با نگین‌های درخشان، مخراج‌کاری دقیق و آبکاری‌های باکیفیت رودیوم و طلا.';
update public.celin_slots set texts = jsonb_set(texts, '{body,en}', to_jsonb('At CELIN, every piece is designed and made in the spirit of the structure and finesse of gold and jewels: brilliant stones, precise stone setting and quality rhodium, gold and champagne-gold plating.'::text)), updated_at = now()
where key = 'home.interlude' and texts #>> '{body,en}' = 'At CELIN, every piece is designed and made in the spirit of gold and jewels, with their structure and finesse: brilliant stones, precise stone setting and quality rhodium and gold plating.';

update public.celin_products
set specs = (
  select coalesce(jsonb_agg(
    case
      when s->>'value_fa' = 'سفید با تراش اتمی' or s->>'value_en' = 'White, atomic cut' then
        s
        || case when s->>'value_fa' = 'سفید با تراش اتمی' then jsonb_build_object('value_fa', 'سفید با تراش مشابه برلیان') else '{}'::jsonb end
        || case when s->>'value_en' = 'White, atomic cut' then jsonb_build_object('value_en', 'White, diamond-like cut') else '{}'::jsonb end
      else s
    end order by o), '[]'::jsonb)
  from jsonb_array_elements(specs) with ordinality as e(s, o))
where specs @> '[{"value_fa": "سفید با تراش اتمی"}]'::jsonb
   or specs @> '[{"value_en": "White, atomic cut"}]'::jsonb;

update public.celin_products set description_fa = 'گردنبند، دستبند و گوشواره‌ی آویز تنیسی از نگین‌هایی با تراش مشابه برلیان؛ پایه‌ی هر جعبه‌ی جواهر.'
where description_fa = 'گردنبند، دستبند و گوشواره‌ی آویز تنیسی از نگین‌های تراش اتمی؛ پایه‌ی هر جعبه‌ی جواهر.';
update public.celin_products set description_en = 'The tennis necklace, bracelet and drop earrings in stones with a diamond-like cut — the foundation of any jewelry box.'
where description_en = 'The tennis necklace, bracelet and drop earrings in atomic-cut stones — the foundation of any jewelry box.';

insert into public.celin_migrations (name) values ('20261111100000_celin_membership_pro') on conflict (name) do nothing;
