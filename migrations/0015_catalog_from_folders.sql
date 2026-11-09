-- 0015 — the shade catalog as the reorganised photo delivery defines it.
--
-- The delivery files every shade in its own folder, so the folder list is now
-- the catalog: a shade exists if and only if it has a folder of photographs.
-- Names come from the brand's own before/after cards, which print them
-- ("02 ROSY KISS", "D02 GOLDEN HONEY", "3001 ROSE ELEGANCE"), and several
-- differ from the names the first delivery used.
--
-- What moves:
--   * High Shine, Diamond, Matte Liquid, Nourishing — renamed under the same
--     code. Updated in place by code, so the variant keeps its id, its open
--     carts and its stock.
--   * Lustre — the delivery uses the line sheet's own G codes (G02, not LG02),
--     and G08 is Cherry Wine where the first delivery called LG08 True Red, so
--     these are new shades rather than renames: 4 replace the previous 11.
--   * Peptide, Ultra Light — real shades replace the placeholders.
--   * Nourishing loses LT04; Hyaluronic keeps only Hydra Clear. Neither has a
--     folder for the rest.
--
-- Hexes are the applied colour where a swatch or before/after card shows one,
-- the product itself otherwise. Editable in admin.
--
-- Finish is restored here too. 0012 inserted shades without one, which quietly
-- emptied the recommender's "matte people buy matte" signal for every product
-- it touched; the values are the ones 0003 seeded.
--
-- Order history is unaffected: order_items snapshot name, hex and image.
-- Open carts holding a retired shade lose that line (FK cascade).
--
-- Idempotent.

create temporary table if not exists desired_shades (
  product_slug text, code text, name text, slug text, hex char(7), ord int
) on commit drop;

insert into desired_shades (product_slug, code, name, slug, hex, ord) values
  ('high-shine-lip-oil', 'HS01', 'Crystal Clear', 'hs01-crystal-clear', '#f2efec', 1),
  ('high-shine-lip-oil', 'HS02', 'Rosy Kiss',     'hs02-rosy-kiss',     '#e67c8a', 2),
  ('high-shine-lip-oil', 'HS04', 'Peach Glaze',   'hs04-peach-glaze',   '#d26358', 3),
  ('high-shine-lip-oil', 'HS06', 'Berry Bliss',   'hs06-berry-bliss',   '#e22013', 4),

  ('diamond-lip-gloss', 'D01', 'Crystal Clear',   'd01-crystal-clear',   '#ebe5db', 1),
  ('diamond-lip-gloss', 'D02', 'Golden Honey',    'd02-golden-honey',    '#df9269', 2),
  ('diamond-lip-gloss', 'D03', 'Royal Champagne', 'd03-royal-champagne', '#ba7551', 3),
  ('diamond-lip-gloss', 'D05', 'Pink Champagne',  'd05-pink-champagne',  '#e36c6b', 4),

  ('lip-lustre-lip-gloss', 'G02', 'Nude Beige',     'g02-nude-beige',     '#d47560', 1),
  ('lip-lustre-lip-gloss', 'G03', 'Rosewood',       'g03-rosewood',       '#cb5972', 2),
  ('lip-lustre-lip-gloss', 'G06', 'Golden Shimmer', 'g06-golden-shimmer', '#cb706c', 3),
  ('lip-lustre-lip-gloss', 'G08', 'Cherry Wine',    'g08-cherry-wine',    '#892a26', 4),

  ('creamy-matte-lipstick', 'CM101', 'Blush Nude',     'cm101-blush-nude',     '#cb6c64', 1),
  ('creamy-matte-lipstick', 'CM110', 'Crimson Velvet', 'cm110-crimson-velvet', '#9a2426', 2),
  ('creamy-matte-lipstick', 'CM116', 'Coral Crush',    'cm116-coral-crush',    '#ea4a59', 3),
  ('creamy-matte-lipstick', 'CM214', 'Dusty Rose',     'cm214-dusty-rose',     '#d66f71', 4),

  ('long-lasting-matte-liquid-lipstick', 'ML1002', 'Velvet Nude',   'ml1002-velvet-nude',   '#e99f9c', 1),
  ('long-lasting-matte-liquid-lipstick', 'ML3001', 'Rose Elegance', 'ml3001-rose-elegance', '#b0494d', 2),
  ('long-lasting-matte-liquid-lipstick', 'ML3003', 'Berry Royale',  'ml3003-berry-royale',  '#d8151d', 3),
  ('long-lasting-matte-liquid-lipstick', 'ML6002', 'Peach Velvet',  'ml6002-peach-velvet',  '#de8075', 4),

  ('nourishing-lip-tint', 'LT01', 'Pink Petal',  'lt01-pink-petal',  '#c24042', 1),
  ('nourishing-lip-tint', 'LT09', 'Coral Bloom', 'lt09-coral-bloom', '#851e31', 2),
  ('nourishing-lip-tint', 'LT11', 'Berry Kiss',  'lt11-berry-kiss',  '#750c13', 3),
  ('nourishing-lip-tint', 'LT12', 'Cherry Glow', 'lt12-cherry-glow', '#9f2534', 4),

  ('matte-lip-liner', 'LL03', 'Warm Nude',      'll03-warm-nude',      '#bc8877', 1),
  ('matte-lip-liner', 'LL09', 'Peach Beige',    'll09-peach-beige',    '#cf8f79', 2),
  ('matte-lip-liner', 'LL11', 'Cinnamon Spice', 'll11-cinnamon-spice', '#ab614b', 3),
  ('matte-lip-liner', 'LL12', 'Rose Beige',     'll12-rose-beige',     '#c36a66', 4),

  -- No codes on these three; the shade is its name.
  ('magic-tone-lip', null, 'Vanilla',       'vanilla',       '#f3ede4', 1),
  ('magic-tone-lip', null, 'Sakura',        'sakura',        '#f2a7c3', 2),
  ('magic-tone-lip', null, 'Black Currant', 'black-currant', '#3c1f33', 3),

  ('peptide-lip-lacquer', null, 'Caramel Macchiato', 'caramel-macchiato', '#b64e47', 1),
  ('peptide-lip-lacquer', null, 'Cherry',            'cherry',            '#7d2c3e', 2),
  ('peptide-lip-lacquer', null, 'Chocolate Cookie',  'chocolate-cookie',  '#683018', 3),
  ('peptide-lip-lacquer', null, 'Strawberry',        'strawberry',        '#ef7f9e', 4),

  ('ultra-light-lip-oil', null, 'Cherry',      'cherry',      '#e91629', 1),
  ('ultra-light-lip-oil', null, 'Coconut',     'coconut',     '#f3efe9', 2),
  ('ultra-light-lip-oil', null, 'Pomegranate', 'pomegranate', '#d70101', 3),
  ('ultra-light-lip-oil', null, 'Watermelon',  'watermelon',  '#f38e9d', 4),

  ('lip-gloss-hyaluronic-acid', null, 'Hydra Clear', 'hydra-clear', '#f3ebe6', 1);

-- 1. Retire what the delivery no longer has. A coded shade is identified by its
--    code, an uncoded one by its slug.
delete from product_variants v
 using products p
 where v.product_id = p.id
   and p.slug in (select distinct product_slug from desired_shades)
   and not exists (
     select 1 from desired_shades d
      where d.product_slug = p.slug
        and ((d.code is not null and d.code = v.shade_code)
          or (d.code is null and v.shade_code is null and d.slug = v.slug))
   );

-- 2. One default per product; cleared here, set again at the end.
update product_variants v set is_default = false
  from products p
 where v.product_id = p.id
   and p.slug in (select distinct product_slug from desired_shades)
   and v.is_default;

-- 3. Rename in place what survives. Keyed by code (or slug), so the variant
--    keeps its id — and with it carts, stock and the photos linked to it.
update product_variants v
   set name = d.name, slug = d.slug, hex_color = d.hex, display_order = d.ord,
       is_available = true
  from desired_shades d, products p
 where v.product_id = p.id and p.slug = d.product_slug
   and ((d.code is not null and d.code = v.shade_code)
     or (d.code is null and v.shade_code is null and d.slug = v.slug));

-- 4. Add what is new.
insert into product_variants
  (product_id, shade_code, name, slug, hex_color, sku, stock_quantity,
   is_available, is_default, display_order)
select p.id, d.code, d.name, d.slug, d.hex, d.code, 40, true, false, d.ord
  from desired_shades d
  join products p on p.slug = d.product_slug
 where not exists (
   select 1 from product_variants v
    where v.product_id = p.id
      and ((d.code is not null and d.code = v.shade_code)
        or (d.code is null and v.shade_code is null and d.slug = v.slug))
 );

-- 5. First shade of each product leads.
update product_variants v set is_default = true
  from products p, desired_shades d
 where v.product_id = p.id and p.slug = d.product_slug
   and d.slug = v.slug and d.ord = 1;

update products set variant_label = 'Shade'
 where slug in (select distinct product_slug from desired_shades)
   and variant_label is distinct from 'Shade';

-- 6. Finish, per product as seeded in 0003. Lustre carried two; Golden Shimmer
--    takes the shimmer, the rest the gloss.
update product_variants v set finish = f.finish
  from (values
    ('high-shine-lip-oil',                 'glossy'),
    ('ultra-light-lip-oil',                'sheer'),
    ('lip-lustre-lip-gloss',               'glossy'),
    ('diamond-lip-gloss',                  'metallic'),
    ('nourishing-lip-tint',                'sheer'),
    ('magic-tone-lip',                     'sheer'),
    ('lip-gloss-hyaluronic-acid',          'glossy'),
    ('peptide-lip-lacquer',                'glossy'),
    ('creamy-matte-lipstick',              'matte'),
    ('long-lasting-matte-liquid-lipstick', 'matte'),
    ('matte-lip-liner',                    'matte')
  ) as f(product_slug, finish), products p
 where v.product_id = p.id and p.slug = f.product_slug
   and v.finish is distinct from f.finish;

update product_variants v set finish = 'shimmer'
  from products p
 where v.product_id = p.id and p.slug = 'lip-lustre-lip-gloss'
   and v.slug = 'g06-golden-shimmer';
