-- Copy cleanup of the catalogue imported from the starter catalogue (src/content/seed-catalog.ts and
-- seed-media.ts), so existing databases match the corrected seed:
--   * no "by hand" claim: the spec «پرداخت: نشانده و پرداخت‌شده با دست» / "Finishing: Hand-set and
--     hand-finished" becomes the brand's own words «نشاندن نگین: مخراج‌کاری دقیق» / "Setting: Precise stone
--     setting"; the Negar tagline «نقشی که دست می‌کشد» / "Patterns drawn by hand" is replaced;
--   * no gem names for the stones (پارایبا، یاقوت، امرالد; paraiba, ruby, sapphire) in alt texts and product copy,
--     no gold / silver as a material in English alt texts;
--   * «آبکاری طلا» (the brand's word) instead of «آبکاری طلایی‌رنگ»; «گوشواره‌ی مرواریدی»;
--   * American spelling (color, colored, center, centerpiece) in English seed text.
-- Only text that still equals the old seed text exactly is changed, so anything the owner has written or edited
-- in the admin stays as it is. Idempotent: after the first run nothing matches any more. Spec order is kept.

-- ------------------------------------------------------------------ product specs (element by element)
update public.celin_products
set specs = (
  select coalesce(jsonb_agg(
    case
      when s->>'value_fa' = 'نشانده و پرداخت‌شده با دست' or s->>'value_en' = 'Hand-set and hand-finished' then
        s
        || case when s->>'value_fa' = 'نشانده و پرداخت‌شده با دست'
             then jsonb_build_object('value_fa', 'مخراج‌کاری دقیق')
                  || case when s->>'label_fa' = 'پرداخت' then jsonb_build_object('label_fa', 'نشاندن نگین') else '{}'::jsonb end
             else '{}'::jsonb end
        || case when s->>'value_en' = 'Hand-set and hand-finished'
             then jsonb_build_object('value_en', 'Precise stone setting')
                  || case when s->>'label_en' = 'Finishing' then jsonb_build_object('label_en', 'Setting') else '{}'::jsonb end
             else '{}'::jsonb end
      else s
    end order by o), '[]'::jsonb)
  from jsonb_array_elements(specs) with ordinality as e(s, o))
where specs @> '[{"value_fa": "نشانده و پرداخت‌شده با دست"}]'::jsonb
   or specs @> '[{"value_en": "Hand-set and hand-finished"}]'::jsonb;

-- single spec values: an element that still holds the old seed text gets the new one
update public.celin_products
set specs = (
  select coalesce(jsonb_agg(case when s->>'value_fa' = 'طلایی (آبکاری طلایی‌رنگ)' then jsonb_set(s, '{value_fa}', to_jsonb('طلایی (آبکاری طلا)'::text)) else s end order by o), '[]'::jsonb)
  from jsonb_array_elements(specs) with ordinality as e(s, o))
where specs @> '[{"value_fa": "طلایی (آبکاری طلایی‌رنگ)"}]'::jsonb;

update public.celin_products
set specs = (
  select coalesce(jsonb_agg(case when s->>'value_fa' = 'رنگی و سفید، تراش اشکی، امرالد و گرد' then jsonb_set(s, '{value_fa}', to_jsonb('رنگی و سفید، تراش اشکی، مستطیلی و گرد'::text)) else s end order by o), '[]'::jsonb)
  from jsonb_array_elements(specs) with ordinality as e(s, o))
where specs @> '[{"value_fa": "رنگی و سفید، تراش اشکی، امرالد و گرد"}]'::jsonb;

update public.celin_products
set specs = (
  select coalesce(jsonb_agg(case when s->>'value_en' = 'Coloured and white; pear, emerald and round cut' then jsonb_set(s, '{value_en}', to_jsonb('Colored and white; pear, emerald and round cut'::text)) else s end order by o), '[]'::jsonb)
  from jsonb_array_elements(specs) with ordinality as e(s, o))
where specs @> '[{"value_en": "Coloured and white; pear, emerald and round cut"}]'::jsonb;

update public.celin_products
set specs = (
  select coalesce(jsonb_agg(case when s->>'value_en' = 'Coloured and white; marquise and round cut' then jsonb_set(s, '{value_en}', to_jsonb('Colored and white; marquise and round cut'::text)) else s end order by o), '[]'::jsonb)
  from jsonb_array_elements(specs) with ordinality as e(s, o))
where specs @> '[{"value_en": "Coloured and white; marquise and round cut"}]'::jsonb;

-- ------------------------------------------------------------------ product names, subtitles, descriptions
update public.celin_products set name_fa = 'گره · گوشواره‌ی مرواریدی'
where name_fa = 'گره · گوشواره مرواریدی';

update public.celin_products set subtitle_fa = 'تراش اشکی و مستطیلی · سرمه‌ای یا قرمز اناری · نقره‌ای (رودیوم)'
where subtitle_fa = 'تراش اشکی و امرالد · سرمه‌ای یا قرمز اناری · نقره‌ای (رودیوم)';

update public.celin_products set description_en = 'A Firouzeh-blue cushion stone in a halo of white. Marquise leaves along the shoulders bring light to the center from every side.'
where description_en = 'A Firouzeh-blue cushion stone in a halo of white. Marquise leaves along the shoulders bring light to the centre from every side.';

update public.celin_products set description_en = 'A square pendant with an engraved frame and a pavé center on a fine chain. A quiet signature for every day.'
where description_en = 'A square pendant with an engraved frame and a pavé centre on a fine chain. A quiet signature for every day.';

update public.celin_products set description_en = 'Three ribbed leaves meeting at the center, each holding a heart-cut stone.'
where description_en = 'Three ribbed leaves meeting at the centre, each holding a heart-cut stone.';

update public.celin_products set description_en = 'A bangle with a finely lined, engraved surface and colored marquise stones. Wear the gold-tone and the silver-tone together, as we like to.'
where description_en = 'A bangle with a finely lined, engraved surface and coloured marquise stones. Wear the gold-tone and the silver-tone together, as we like to.';

update public.celin_products set description_en = 'Bow earrings with a colored drop and a matching square ring, in night blue or pomegranate red.'
where description_en = 'Bow earrings with a coloured drop and a matching square ring, in night blue or pomegranate red.';

-- ------------------------------------------------------------------ collections
update public.celin_collections set tagline_fa = 'نقش، در خط‌های ظریف'
where tagline_fa = 'نقشی که دست می‌کشد';

update public.celin_collections set tagline_en = 'Patterns in fine engraved lines'
where tagline_en = 'Patterns drawn by hand';

update public.celin_collections set story_en = 'The color Persians have used for centuries to write the sky and the tile. Firouzeh-blue center stones in halos of white and marquise petals — bright by day, deep at night.'
where story_en = 'The colour Persians have used for centuries to write the sky and the tile. Firouzeh-blue centre stones in halos of white and marquise petals — bright by day, deep at night.';

update public.celin_collections set story_en = 'Negar means both an engraved image and the beloved. Finely lined, engraved surfaces with a single colored marquise, in gold and silver tones — better worn together.'
where story_en = 'Negar means both an engraved image and the beloved. Finely lined, engraved surfaces with a single coloured marquise, in gold and silver tones — better worn together.';

update public.celin_collections set story_en = 'Gereh is both a bow and the interlaced geometry of Persian art. Pavé bows with colored and pearl-look drops — for the bonds that last.'
where story_en = 'Gereh is both a bow and the interlaced geometry of Persian art. Pavé bows with coloured and pearl-look drops — for the bonds that last.';

-- ------------------------------------------------------------------ alt texts of the starter pictures
-- matched by the picture's path and the exact old text, so a re-described or replaced picture is left alone
update public.celin_media as m
set alt_fa = v.new_value
from (values
  ('/media/seed/earrings-bow-pearl', 'گوشواره‌ی پاپیونی نگین‌کاری‌شده با آویز مروارید', 'گوشواره‌ی پاپیونی نگین‌کاری‌شده با آویز مرواریدی'),
  ('/media/seed/ring-paraiba-cushion', 'انگشتر با سنگ آبی پارایبا و هاله‌ی نگین‌های سفید', 'انگشتر با نگین آبی فیروزه‌ای و هاله‌ی نگین‌های سفید'),
  ('/media/seed/ring-paraiba-oval', 'انگشتر بیضی آبی پارایبا با گلبرگ‌های مارکیز', 'انگشتر بیضی آبی فیروزه‌ای با گلبرگ‌های مارکیز'),
  ('/media/seed/ring-paraiba-oval-side', 'نمای کناری انگشتر بیضی آبی پارایبا', 'نمای کناری انگشتر بیضی آبی فیروزه‌ای'),
  ('/media/seed/set-bow-ruby', 'گوشواره‌ی پاپیونی و انگشتر مربع با سنگ یاقوتی', 'گوشواره‌ی پاپیونی و انگشتر مربع با نگین قرمز اناری')
) as v(path, old_value, new_value)
where m.path = v.path and m.alt_fa = v.old_value;

update public.celin_media as m
set alt_en = v.new_value
from (values
  ('/media/seed/bangles-sapphire', 'Engraved gold and silver bangles with navy marquise stones on the wrist', 'Engraved gold-tone and silver-tone bangles with night-blue marquise stones on the wrist'),
  ('/media/seed/choker-rose', 'Tennis choker with a pavé flower centrepiece on the neck', 'Tennis choker with a pavé flower centerpiece on the neck'),
  ('/media/seed/earrings-bow-pearl', 'Pavé bow earrings with a pearl drop', 'Pavé bow earrings with a pearl-look drop'),
  ('/media/seed/necklace-gold-square', 'Gold chain necklace with a square pavé pendant', 'Gold-tone chain necklace with a square pavé pendant'),
  ('/media/seed/ring-emerald-fan', 'Rose-gold fan ring with green marquise stones', 'Rose-gold-tone fan ring with green marquise stones'),
  ('/media/seed/ring-gold-pave-rows', 'Gold multi-row pavé ring', 'Gold-tone multi-row pavé ring'),
  ('/media/seed/ring-paraiba-cushion', 'Cocktail ring with a paraiba-blue cushion stone and a white halo', 'Cocktail ring with a Firouzeh-blue cushion stone and a white halo'),
  ('/media/seed/ring-paraiba-oval', 'Oval paraiba-blue ring with marquise petals', 'Oval Firouzeh-blue ring with marquise petals'),
  ('/media/seed/ring-paraiba-oval-side', 'Side view of the oval paraiba-blue ring', 'Side view of the oval Firouzeh-blue ring'),
  ('/media/seed/ring-paraiba-wrap', 'Silver wrap ring with a pear paraiba-blue stone', 'Silver-tone wrap ring with a pear Firouzeh-blue stone'),
  ('/media/seed/ring-paraiba-wrap-hand', 'Wrap ring with a pear paraiba-blue stone on the hand', 'Wrap ring with a pear Firouzeh-blue stone on the hand'),
  ('/media/seed/rings-heart-leaf', 'Gold and silver leaf rings with heart stones', 'Gold-tone and silver-tone leaf rings with heart-cut stones'),
  ('/media/seed/rings-heart-signet', 'Gold and silver heart signet rings', 'Gold-tone and silver-tone heart signet rings'),
  ('/media/seed/set-bow-ruby', 'Bow earrings and square ring with ruby-red stones', 'Bow earrings and square ring with pomegranate-red stones'),
  ('/media/seed/set-bow-sapphire', 'Bow earrings and square ring with sapphire-blue stones', 'Bow earrings and square ring with night-blue stones')
) as v(path, old_value, new_value)
where m.path = v.path and m.alt_en = v.old_value;
