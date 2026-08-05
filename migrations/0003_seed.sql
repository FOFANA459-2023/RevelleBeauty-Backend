-- Revelle Beauty — seed data.
-- Placeholder prices and shade hexes; correct them via the admin dashboard.
-- Idempotent: safe to re-run (on conflict do nothing keyed on slugs).

-- ---------- categories ----------

insert into categories (name, slug, display_order) values
  ('Lips', 'lips', 1),
  ('Skincare', 'skincare', 2)
on conflict (slug) do nothing;

insert into categories (parent_id, name, slug, display_order)
select id, 'Lip Products & Oil', 'lip-oil', 1 from categories where slug = 'lips'
on conflict (slug) do nothing;

insert into categories (parent_id, name, slug, display_order)
select id, 'Lip Color', 'lip-color', 2 from categories where slug = 'lips'
on conflict (slug) do nothing;

-- ---------- products ----------

with cat as (select id, slug from categories)
insert into products
  (category_id, slug, name, tagline, description, base_price_cents, status, variant_label, is_featured, display_order, published_at)
values
  ((select id from cat where slug='lip-oil'), 'high-shine-lip-oil', 'High Shine Lip Oil',
   'Glass-like shine, weightless feel.',
   'A nourishing lip oil that delivers mirror shine without the stick. Infused with botanical oils that condition lips over time.',
   2200, 'active', 'Shade', true, 1, now()),

  ((select id from cat where slug='lip-oil'), 'ultra-light-lip-oil', 'Ultra Light Lip Oil (Square Tube)',
   'Barely-there hydration with a whisper of color.',
   'Our lightest formula in a sleek square tube. A veil of moisture and sheer color for everyday wear.',
   1900, 'active', 'Shade', false, 2, now()),

  ((select id from cat where slug='lip-oil'), 'lip-lustre-lip-gloss', 'Lip Lustre Lip Gloss',
   'Cushioned shine that lasts.',
   'A plush, non-sticky gloss with dimensional shine. Buildable color that flatters every skin tone.',
   2000, 'active', 'Shade', true, 3, now()),

  ((select id from cat where slug='lip-oil'), 'sugar-lip-scrub', 'Sugar Lip Scrub',
   'Buff, smooth, and prep.',
   'Fine sugar crystals melt away dryness, leaving lips soft and perfectly prepped for color.',
   1600, 'active', 'Type', false, 4, now()),

  ((select id from cat where slug='lip-oil'), 'diamond-lip-gloss', 'Diamond Lip Gloss',
   'Multidimensional sparkle.',
   'Micro-fine pearls suspended in a cushiony gloss for a lit-from-within sparkle.',
   2400, 'active', 'Shade', true, 5, now()),

  ((select id from cat where slug='lip-oil'), 'nourishing-lip-tint', 'Nourishing Lip Tint',
   'Color that cares.',
   'A balmy tint that drenches lips in moisture while leaving a soft flush of color.',
   1800, 'active', 'Shade', false, 6, now()),

  ((select id from cat where slug='lip-oil'), 'magic-tone-lip', 'Magic Tone Lip',
   'Reacts to you.',
   'A pH-reactive formula that shifts to your most flattering shade. One tube, your color.',
   2100, 'active', 'Shade', false, 7, now()),

  ((select id from cat where slug='lip-oil'), 'lip-gloss-hyaluronic-acid', 'Lip Gloss with Hyaluronic Acid',
   'Plumping hydration meets shine.',
   'Hyaluronic acid draws in moisture for visibly fuller-looking lips under a glassy finish.',
   2300, 'active', 'Shade', false, 8, now()),

  ((select id from cat where slug='lip-oil'), 'peptide-lip-lacquer', 'Peptide Lip Lacquer',
   'Treatment-level shine.',
   'A peptide-infused lacquer that supports smoother, bouncier-looking lips with every wear.',
   2600, 'active', 'Shade', false, 9, now()),

  ((select id from cat where slug='lip-color'), 'creamy-matte-lipstick', 'Creamy Matte Lipstick',
   'Velvet color, zero drag.',
   'A modern matte that glides on like a balm and sets to a soft-focus velvet finish.',
   2400, 'active', 'Shade', true, 1, now()),

  ((select id from cat where slug='lip-color'), 'long-lasting-matte-liquid-lipstick', 'Long-Lasting Matte Liquid Lipstick',
   'All-day color. No compromise.',
   'Transfer-resistant liquid color that stays comfortable from first coffee to last call.',
   2500, 'active', 'Shade', false, 2, now()),

  ((select id from cat where slug='lip-color'), 'matte-lip-liner', 'Matte Lip Liner',
   'Define. Sculpt. Perfect.',
   'A creamy, precise liner that shapes and fills with rich matte color.',
   1500, 'active', 'Shade', false, 3, now()),

  ((select id from cat where slug='skincare'), 'skincare-product-one', 'Skincare Product One',
   null, 'Placeholder — publish once named.', 2800, 'draft', 'Size', false, 1, null),

  ((select id from cat where slug='skincare'), 'skincare-product-two', 'Skincare Product Two',
   null, 'Placeholder — publish once named.', 3200, 'draft', 'Size', false, 2, null)
on conflict (slug) do nothing;

-- ---------- variants ----------
-- helper CTE-less inserts keyed on (product slug, variant slug)

with p as (select id from products where slug = 'high-shine-lip-oil')
insert into product_variants (product_id, name, slug, hex_color, finish, stock_quantity, is_default, display_order)
values
  ((select id from p), 'Clear Glaze',  'clear-glaze',  '#f6ece4', 'glossy', 50, true,  1),
  ((select id from p), 'Peach Nectar', 'peach-nectar', '#f0a882', 'glossy', 50, false, 2),
  ((select id from p), 'Rose Elixir',  'rose-elixir',  '#d9738a', 'glossy', 50, false, 3),
  ((select id from p), 'Cherry Sheen', 'cherry-sheen', '#b03246', 'glossy', 50, false, 4),
  ((select id from p), 'Plum Drift',   'plum-drift',   '#7e4560', 'glossy', 50, false, 5)
on conflict (product_id, slug) do nothing;

with p as (select id from products where slug = 'ultra-light-lip-oil')
insert into product_variants (product_id, name, slug, hex_color, finish, stock_quantity, is_default, display_order)
values
  ((select id from p), 'Bare Ivory', 'bare-ivory', '#f2e6da', 'sheer', 40, true,  1),
  ((select id from p), 'Soft Blush', 'soft-blush', '#e8a6a6', 'sheer', 40, false, 2),
  ((select id from p), 'Coral Air',  'coral-air',  '#f08a6a', 'sheer', 40, false, 3),
  ((select id from p), 'Berry Mist', 'berry-mist', '#a34f6e', 'sheer', 40, false, 4)
on conflict (product_id, slug) do nothing;

with p as (select id from products where slug = 'lip-lustre-lip-gloss')
insert into product_variants (product_id, name, slug, hex_color, finish, stock_quantity, is_default, display_order)
values
  ((select id from p), 'Champagne',  'champagne',  '#e2c391', 'shimmer', 45, true,  1),
  ((select id from p), 'Nude Silk',  'nude-silk',  '#cf9c86', 'glossy',  45, false, 2),
  ((select id from p), 'Rosewood',   'rosewood',   '#a85f68', 'glossy',  45, false, 3),
  ((select id from p), 'Mauve Hour', 'mauve-hour', '#8d5f79', 'glossy',  45, false, 4)
on conflict (product_id, slug) do nothing;

with p as (select id from products where slug = 'sugar-lip-scrub')
insert into product_variants (product_id, name, slug, hex_color, stock_quantity, is_default, display_order)
values
  ((select id from p), 'Default', 'default', null, 60, true, 1)
on conflict (product_id, slug) do nothing;

with p as (select id from products where slug = 'diamond-lip-gloss')
insert into product_variants (product_id, name, slug, hex_color, hex_color_secondary, finish, stock_quantity, is_default, display_order)
values
  ((select id from p), 'Diamond Clear', 'diamond-clear', '#efe7e2', '#d8c39a', 'metallic', 35, true,  1),
  ((select id from p), 'Icy Pink',      'icy-pink',      '#e5a8bd', '#cfd8e8', 'metallic', 35, false, 2),
  ((select id from p), 'Gold Dust',     'gold-dust',     '#c9a24a', '#f0dfae', 'metallic', 35, false, 3)
on conflict (product_id, slug) do nothing;

with p as (select id from products where slug = 'nourishing-lip-tint')
insert into product_variants (product_id, name, slug, hex_color, finish, stock_quantity, is_default, display_order)
values
  ((select id from p), 'Petal', 'petal', '#e79aa4', 'sheer', 40, true,  1),
  ((select id from p), 'Guava', 'guava', '#e2705f', 'sheer', 40, false, 2),
  ((select id from p), 'Wine',  'wine',  '#7a2f3d', 'sheer', 40, false, 3),
  ((select id from p), 'Cocoa', 'cocoa', '#8a5344', 'sheer', 40, false, 4)
on conflict (product_id, slug) do nothing;

with p as (select id from products where slug = 'magic-tone-lip')
insert into product_variants (product_id, name, slug, hex_color, finish, stock_quantity, is_default, display_order)
values
  ((select id from p), 'Magic Rose',  'magic-rose',  '#c85a76', 'sheer', 30, true,  1),
  ((select id from p), 'Magic Coral', 'magic-coral', '#e2745c', 'sheer', 30, false, 2),
  ((select id from p), 'Magic Berry', 'magic-berry', '#8e3a5a', 'sheer', 30, false, 3)
on conflict (product_id, slug) do nothing;

with p as (select id from products where slug = 'lip-gloss-hyaluronic-acid')
insert into product_variants (product_id, name, slug, hex_color, finish, stock_quantity, is_default, display_order)
values
  ((select id from p), 'Hydra Clear', 'hydra-clear', '#f3ebe6', 'glossy', 40, true,  1),
  ((select id from p), 'Hydra Rose',  'hydra-rose',  '#dd8f9c', 'glossy', 40, false, 2),
  ((select id from p), 'Hydra Nude',  'hydra-nude',  '#c79a84', 'glossy', 40, false, 3)
on conflict (product_id, slug) do nothing;

with p as (select id from products where slug = 'peptide-lip-lacquer')
insert into product_variants (product_id, name, slug, hex_color, finish, stock_quantity, is_default, display_order)
values
  ((select id from p), 'Lacquer Nude', 'lacquer-nude', '#c58f7c', 'glossy', 35, true,  1),
  ((select id from p), 'Lacquer Red',  'lacquer-red',  '#b3202f', 'glossy', 35, false, 2),
  ((select id from p), 'Lacquer Plum', 'lacquer-plum', '#6f3149', 'glossy', 35, false, 3)
on conflict (product_id, slug) do nothing;

with p as (select id from products where slug = 'creamy-matte-lipstick')
insert into product_variants (product_id, name, slug, hex_color, finish, stock_quantity, is_default, display_order)
values
  ((select id from p), 'Ivory Rose',  'ivory-rose',  '#c98a86', 'matte', 50, true,  1),
  ((select id from p), 'Classic Red', 'classic-red', '#b31b2c', 'matte', 50, false, 2),
  ((select id from p), 'Terracotta',  'terracotta',  '#a55340', 'matte', 50, false, 3),
  ((select id from p), 'Deep Berry',  'deep-berry',  '#6d2740', 'matte', 50, false, 4),
  ((select id from p), 'Nude Beige',  'nude-beige',  '#bb8f76', 'matte', 50, false, 5)
on conflict (product_id, slug) do nothing;

with p as (select id from products where slug = 'long-lasting-matte-liquid-lipstick')
insert into product_variants (product_id, name, slug, hex_color, finish, stock_quantity, is_default, display_order)
values
  ((select id from p), 'Velvet Nude',  'velvet-nude',  '#b5806f', 'matte', 45, true,  1),
  ((select id from p), 'Velvet Red',   'velvet-red',   '#a01423', 'matte', 45, false, 2),
  ((select id from p), 'Velvet Mauve', 'velvet-mauve', '#8b5a6b', 'matte', 45, false, 3),
  ((select id from p), 'Velvet Cocoa', 'velvet-cocoa', '#6f4436', 'matte', 45, false, 4)
on conflict (product_id, slug) do nothing;

with p as (select id from products where slug = 'matte-lip-liner')
insert into product_variants (product_id, name, slug, hex_color, finish, stock_quantity, is_default, display_order)
values
  ((select id from p), 'Nude Outline',  'nude-outline',  '#b98a76', 'matte', 55, true,  1),
  ((select id from p), 'Red Outline',   'red-outline',   '#9b1b28', 'matte', 55, false, 2),
  ((select id from p), 'Berry Outline', 'berry-outline', '#7a3448', 'matte', 55, false, 3)
on conflict (product_id, slug) do nothing;

with p as (select id from products where slug = 'skincare-product-one')
insert into product_variants (product_id, name, slug, hex_color, stock_quantity, is_default, display_order)
values ((select id from p), 'Default', 'default', null, 0, true, 1)
on conflict (product_id, slug) do nothing;

with p as (select id from products where slug = 'skincare-product-two')
insert into product_variants (product_id, name, slug, hex_color, stock_quantity, is_default, display_order)
values ((select id from p), 'Default', 'default', null, 0, true, 1)
on conflict (product_id, slug) do nothing;

-- ---------- settings ----------

update store_settings set
  flat_shipping_cents = 599,
  free_shipping_threshold_cents = 5000,
  allowed_shipping_countries = '{US,CA}',
  announcement = 'COMPLIMENTARY SHIPPING ON ORDERS OVER $50'
where id;
