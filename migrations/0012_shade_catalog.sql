-- 0012 — the real shade catalog, taken from the product photography.
--
-- Shades now carry the maker's shade code ("HS01") alongside the name
-- ("Crystal Clear"); the storefront renders them together, Dior-style.
-- The seven products below are replaced wholesale: every shade here has its
-- own photograph in backend/seed-assets/lips/<slug>/shades/, and any older
-- invented shade for those products is retired.
--
-- Safe for order history: order_items snapshots product_name / variant_name /
-- variant_hex / image_path at purchase time and its variant_id is ON DELETE
-- SET NULL, so retiring a shade never rewrites what someone already bought.
-- Open carts referencing a retired shade do cascade away, by design.
--
-- Hexes were sampled from the photograph of each shade (the bullet, the liquid
-- in the tube, or the applied swatch) and are editable in admin.
--
-- Idempotent: re-running replaces the same rows.

alter table product_variants add column if not exists shade_code text;

comment on column product_variants.shade_code is
  'Maker shade code from the line sheet (HS01, LG12, CM214). Null for products that do not use codes.';

create unique index if not exists product_variants_shade_code_idx
  on product_variants (product_id, shade_code) where shade_code is not null;

-- The desired catalog, as a view the three statements below all read from.
create temporary table if not exists desired_shades (
  product_slug text, code text, name text, slug text, hex char(7), ord int
) on commit drop;

insert into desired_shades (product_slug, code, name, slug, hex, ord) values
  -- High Shine Lip Oil. HS02 and HS04 photograph as near-identical pinks;
  -- the hexes are faithful to the bottles rather than pulled apart.
  ('high-shine-lip-oil', 'HS01', 'Crystal Clear',  'hs01-crystal-clear',  '#f2efec', 1),
  ('high-shine-lip-oil', 'HS02', 'Rose Petal',     'hs02-rose-petal',     '#e97d8a', 2),
  ('high-shine-lip-oil', 'HS04', 'Flamingo Pink',  'hs04-flamingo-pink',  '#ed7782', 3),
  ('high-shine-lip-oil', 'HS06', 'Cherry Red',     'hs06-cherry-red',     '#e6241c', 4),

  -- Lustre Lip Gloss — the deepest range, eleven photographed shades.
  ('lip-lustre-lip-gloss', 'LG02', 'Nude Beige',     'lg02-nude-beige',     '#d47560', 1),
  ('lip-lustre-lip-gloss', 'LG03', 'Rosewood',       'lg03-rosewood',       '#cb5972', 2),
  ('lip-lustre-lip-gloss', 'LG05', 'Crimson Kiss',   'lg05-crimson-kiss',   '#be3239', 3),
  ('lip-lustre-lip-gloss', 'LG06', 'Petal Nude',     'lg06-petal-nude',     '#ca706c', 4),
  ('lip-lustre-lip-gloss', 'LG07', 'Dusty Mauve',    'lg07-dusty-mauve',    '#ce767d', 5),
  ('lip-lustre-lip-gloss', 'LG08', 'True Red',       'lg08-true-red',       '#d61825', 6),
  ('lip-lustre-lip-gloss', 'LG09', 'Cherry Wine',    'lg09-cherry-wine',    '#822532', 7),
  ('lip-lustre-lip-gloss', 'LG10', 'Cinnamon Red',   'lg10-cinnamon-red',   '#892a26', 8),
  ('lip-lustre-lip-gloss', 'LG12', 'Crystal Clear',  'lg12-crystal-clear',  '#f0ece6', 9),
  ('lip-lustre-lip-gloss', 'LG14', 'Mocha Glaze',    'lg14-mocha-glaze',    '#9b5a46', 10),
  ('lip-lustre-lip-gloss', 'LG15', 'Espresso Shine', 'lg15-espresso-shine', '#814533', 11),

  -- Creamy Matte Lipstick
  ('creamy-matte-lipstick', 'CM101', 'Blush Nude',     'cm101-blush-nude',     '#d58c8b', 1),
  ('creamy-matte-lipstick', 'CM110', 'Crimson Velvet', 'cm110-crimson-velvet', '#9a2426', 2),
  ('creamy-matte-lipstick', 'CM116', 'Coral Crush',    'cm116-coral-crush',    '#ea4a59', 3),
  ('creamy-matte-lipstick', 'CM214', 'Dusty Rose',     'cm214-dusty-rose',     '#d66f71', 4),

  -- Matte Liquid Lipstick
  ('long-lasting-matte-liquid-lipstick', 'ML1002', 'Ballet Pink',  'ml1002-ballet-pink',  '#e99f9c', 1),
  ('long-lasting-matte-liquid-lipstick', 'ML3001', 'Mauve Nude',   'ml3001-mauve-nude',   '#ca8381', 2),
  ('long-lasting-matte-liquid-lipstick', 'ML3003', 'Scarlet Red',  'ml3003-scarlet-red',  '#d8151d', 3),
  ('long-lasting-matte-liquid-lipstick', 'ML6002', 'Peach Nude',   'ml6002-peach-nude',   '#de8075', 4),

  -- Diamond Lip Gloss
  ('diamond-lip-gloss', 'D01', 'Crystal Sparkle',  'd01-crystal-sparkle',  '#ebe5db', 1),
  ('diamond-lip-gloss', 'D02', 'Peach Champagne',  'd02-peach-champagne',  '#e19369', 2),
  ('diamond-lip-gloss', 'D03', 'Bronze Glow',      'd03-bronze-glow',      '#ba7350', 3),
  ('diamond-lip-gloss', 'D05', 'Pink Diamond',     'd05-pink-diamond',     '#e36e6c', 4),

  -- Nourishing Lip Tint
  ('nourishing-lip-tint', 'LT01', 'Black Cherry',  'lt01-black-cherry',  '#93251f', 1),
  ('nourishing-lip-tint', 'LT04', 'Coral Bliss',   'lt04-coral-bliss',   '#fe846e', 2),
  ('nourishing-lip-tint', 'LT09', 'Midnight Plum', 'lt09-midnight-plum', '#401225', 3),
  ('nourishing-lip-tint', 'LT11', 'Ruby Red',      'lt11-ruby-red',      '#a40302', 4),
  ('nourishing-lip-tint', 'LT12', 'Berry Crush',   'lt12-berry-crush',   '#810138', 5),

  -- Lip Liner. The pencil barrel is tinted to match, so the hex comes from
  -- the tip where the shot shows it.
  ('matte-lip-liner', 'LL03', 'Warm Nude',      'll03-warm-nude',      '#ac5b4e', 1),
  ('matte-lip-liner', 'LL09', 'Peach Beige',    'll09-peach-beige',    '#c48e70', 2),
  ('matte-lip-liner', 'LL11', 'Cinnamon Spice', 'll11-cinnamon-spice', '#d7764e', 3),
  ('matte-lip-liner', 'LL12', 'Rose Beige',     'll12-rose-beige',     '#c7756e', 4);

-- 1. Retire shades that are not in the new catalog (only for listed products).
delete from product_variants v
 using products p
 where v.product_id = p.id
   and p.slug in (select distinct product_slug from desired_shades)
   and not exists (
     select 1 from desired_shades d
      where d.product_slug = p.slug and d.slug = v.slug
   );

-- 2. Clear defaults first — one_default_idx allows a single default per product.
update product_variants v set is_default = false
  from products p
 where v.product_id = p.id
   and p.slug in (select distinct product_slug from desired_shades)
   and v.is_default;

-- 3. Upsert the catalog. Names can collide with a retired shade's name on a
--    re-run, so (product_id, name) is resolved by the delete above.
insert into product_variants
  (product_id, shade_code, name, slug, hex_color, sku, stock_quantity,
   is_available, is_default, display_order)
select p.id, d.code, d.name, d.slug, d.hex, d.code, 40, true, false, d.ord
  from desired_shades d
  join products p on p.slug = d.product_slug
on conflict (product_id, slug) do update
   set shade_code    = excluded.shade_code,
       name          = excluded.name,
       hex_color     = excluded.hex_color,
       sku           = excluded.sku,
       is_available  = true,
       display_order = excluded.display_order;

-- 4. First shade of each product becomes the default.
update product_variants v set is_default = true
  from products p, desired_shades d
 where v.product_id = p.id and p.slug = d.product_slug
   and d.slug = v.slug and d.ord = 1;

-- 5. These products are sold by shade — make sure the picker is labelled so.
update products set variant_label = 'Shade'
 where slug in (select distinct product_slug from desired_shades)
   and variant_label is distinct from 'Shade';
