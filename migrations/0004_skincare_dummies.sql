-- Dummy skincare products so the Skincare category is browsable.
-- Placeholders — real products replace these via the admin later.

-- Rename + publish the two seeded drafts.
update products set
  name = 'Radiance Face Serum',
  slug = 'radiance-face-serum',
  tagline = 'Glow, bottled.',
  description = 'A featherlight serum that leaves skin luminous and smooth. Placeholder product — details coming soon.',
  base_price_cents = 3800,
  status = 'active',
  published_at = coalesce(published_at, now()),
  display_order = 1
where slug = 'skincare-product-one';

update products set
  name = 'Silk Hydration Moisturizer',
  slug = 'silk-hydration-moisturizer',
  tagline = 'Deep moisture, zero weight.',
  description = 'A silky daily moisturizer that cushions skin with lasting hydration. Placeholder product — details coming soon.',
  base_price_cents = 3200,
  status = 'active',
  published_at = coalesce(published_at, now()),
  display_order = 2
where slug = 'skincare-product-two';

-- Give their Default variants sellable stock.
update product_variants v set stock_quantity = 40
from products p
where p.id = v.product_id
  and p.slug in ('radiance-face-serum', 'silk-hydration-moisturizer')
  and v.stock_quantity = 0;

-- Two more dummies so the grid has presence.
with cat as (select id from categories where slug = 'skincare')
insert into products
  (category_id, slug, name, tagline, description, base_price_cents, status, variant_label, display_order, published_at)
values
  ((select id from cat), 'velvet-cloud-cleanser', 'Velvet Cloud Cleanser',
   'Melts the day away.',
   'A cushiony gel-cream cleanser that lifts makeup and impurities without stripping. Placeholder product — details coming soon.',
   2600, 'active', 'Size', 3, now()),
  ((select id from cat), 'golden-hour-face-oil', 'Golden Hour Face Oil',
   'Lit from within.',
   'A fast-absorbing botanical oil blend for a soft-focus, golden-hour finish. Placeholder product — details coming soon.',
   4200, 'active', 'Size', 4, now())
on conflict (slug) do nothing;

with p as (select id from products where slug = 'velvet-cloud-cleanser')
insert into product_variants (product_id, name, slug, hex_color, stock_quantity, is_default, display_order)
values ((select id from p), 'Default', 'default', null, 40, true, 1)
on conflict (product_id, slug) do nothing;

with p as (select id from products where slug = 'golden-hour-face-oil')
insert into product_variants (product_id, name, slug, hex_color, stock_quantity, is_default, display_order)
values ((select id from p), 'Default', 'default', null, 40, true, 1)
on conflict (product_id, slug) do nothing;
