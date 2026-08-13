-- 0011_real_lip_shades.sql — align lip variants with the real product photography
-- (shade names/codes printed on the tubes: HS01–HS08, UL codes, LG codes,
-- Magic Tone Sakura/Vanilla/Black Currant, Lip Tint line).
-- Idempotent: renames are keyed on the old slug and guarded so they run once;
-- inserts are guarded by not-exists. Existing variant ids are preserved so
-- carts, orders, and inventory history stay intact.

-- ---------- High Shine Lip Oil: 8 shades (HS01–HS08) ----------

update product_variants v set name='Clear', slug='clear', hex_color='#f2efec', display_order=1
from products p where p.id=v.product_id and p.slug='high-shine-lip-oil' and v.slug='clear-glaze'
  and not exists (select 1 from product_variants x where x.product_id=v.product_id and x.slug='clear');

update product_variants v set name='Peach Nude', slug='peach-nude', hex_color='#d9906b', display_order=2
from products p where p.id=v.product_id and p.slug='high-shine-lip-oil' and v.slug='peach-nectar'
  and not exists (select 1 from product_variants x where x.product_id=v.product_id and x.slug='peach-nude');

update product_variants v set name='Pink Blossom', slug='pink-blossom', hex_color='#e2799f', display_order=3
from products p where p.id=v.product_id and p.slug='high-shine-lip-oil' and v.slug='rose-elixir'
  and not exists (select 1 from product_variants x where x.product_id=v.product_id and x.slug='pink-blossom');

update product_variants v set name='Ruby Red', slug='ruby-red', hex_color='#c81f33', display_order=6
from products p where p.id=v.product_id and p.slug='high-shine-lip-oil' and v.slug='cherry-sheen'
  and not exists (select 1 from product_variants x where x.product_id=v.product_id and x.slug='ruby-red');

update product_variants v set name='Berry Blush', slug='berry-blush', hex_color='#8f4a67', display_order=7
from products p where p.id=v.product_id and p.slug='high-shine-lip-oil' and v.slug='plum-drift'
  and not exists (select 1 from product_variants x where x.product_id=v.product_id and x.slug='berry-blush');

insert into product_variants (product_id, name, slug, hex_color, finish, stock_quantity, is_default, display_order)
select p.id, 'Rosewood', 'rosewood', '#b06a55', 'glossy', 40, false, 4 from products p
where p.slug='high-shine-lip-oil'
  and not exists (select 1 from product_variants x where x.product_id=p.id and x.slug='rosewood');

insert into product_variants (product_id, name, slug, hex_color, finish, stock_quantity, is_default, display_order)
select p.id, 'Fuchsia Kiss', 'fuchsia-kiss', '#d81b74', 'glossy', 40, false, 5 from products p
where p.slug='high-shine-lip-oil'
  and not exists (select 1 from product_variants x where x.product_id=p.id and x.slug='fuchsia-kiss');

insert into product_variants (product_id, name, slug, hex_color, finish, stock_quantity, is_default, display_order)
select p.id, 'Cocoa Nude', 'cocoa-nude', '#9c6b52', 'glossy', 40, false, 8 from products p
where p.slug='high-shine-lip-oil'
  and not exists (select 1 from product_variants x where x.product_id=p.id and x.slug='cocoa-nude');

-- ---------- Ultra Light Lip Oil: 7 shades (square tube, UL codes) ----------

update product_variants v set name='Pure Glow', slug='pure-glow', hex_color='#f3efe9', display_order=1
from products p where p.id=v.product_id and p.slug='ultra-light-lip-oil' and v.slug='bare-ivory'
  and not exists (select 1 from product_variants x where x.product_id=v.product_id and x.slug='pure-glow');

update product_variants v set name='Pink Glow', slug='pink-glow', hex_color='#f6c3d4', display_order=3
from products p where p.id=v.product_id and p.slug='ultra-light-lip-oil' and v.slug='soft-blush'
  and not exists (select 1 from product_variants x where x.product_id=v.product_id and x.slug='pink-glow');

update product_variants v set name='Cherry Pop', slug='cherry-pop', hex_color='#e02436', display_order=6
from products p where p.id=v.product_id and p.slug='ultra-light-lip-oil' and v.slug='coral-air'
  and not exists (select 1 from product_variants x where x.product_id=v.product_id and x.slug='cherry-pop');

update product_variants v set name='Berry Kiss', slug='berry-kiss', hex_color='#c157c7', display_order=5
from products p where p.id=v.product_id and p.slug='ultra-light-lip-oil' and v.slug='berry-mist'
  and not exists (select 1 from product_variants x where x.product_id=v.product_id and x.slug='berry-kiss');

insert into product_variants (product_id, name, slug, hex_color, finish, stock_quantity, is_default, display_order)
select p.id, 'Clear Shine', 'clear-shine', '#eef3f7', 'sheer', 40, false, 2 from products p
where p.slug='ultra-light-lip-oil'
  and not exists (select 1 from product_variants x where x.product_id=p.id and x.slug='clear-shine');

insert into product_variants (product_id, name, slug, hex_color, finish, stock_quantity, is_default, display_order)
select p.id, 'Glitter Glaze', 'glitter-glaze', '#f3b9cd', 'shimmer', 40, false, 4 from products p
where p.slug='ultra-light-lip-oil'
  and not exists (select 1 from product_variants x where x.product_id=p.id and x.slug='glitter-glaze');

insert into product_variants (product_id, name, slug, hex_color, finish, stock_quantity, is_default, display_order)
select p.id, 'Honey Glow', 'honey-glow', '#e9b93d', 'sheer', 40, false, 7 from products p
where p.slug='ultra-light-lip-oil'
  and not exists (select 1 from product_variants x where x.product_id=p.id and x.slug='honey-glow');

-- ---------- Lustre Lip Gloss: 8 shades (LG codes) ----------

update product_variants v set name='Golden Shimmer', slug='golden-shimmer', hex_color='#d9a678', finish='shimmer', display_order=4
from products p where p.id=v.product_id and p.slug='lip-lustre-lip-gloss' and v.slug='champagne'
  and not exists (select 1 from product_variants x where x.product_id=v.product_id and x.slug='golden-shimmer');

update product_variants v set name='Soft Nude', slug='soft-nude', hex_color='#f0a988', display_order=2
from products p where p.id=v.product_id and p.slug='lip-lustre-lip-gloss' and v.slug='nude-silk'
  and not exists (select 1 from product_variants x where x.product_id=v.product_id and x.slug='soft-nude');

update product_variants v set name='Berry Blush', slug='berry-blush', hex_color='#b8596b', display_order=6
from products p where p.id=v.product_id and p.slug='lip-lustre-lip-gloss' and v.slug='rosewood'
  and not exists (select 1 from product_variants x where x.product_id=v.product_id and x.slug='berry-blush');

update product_variants v set name='Cherry Wine', slug='cherry-wine', hex_color='#7c1f2e', display_order=7
from products p where p.id=v.product_id and p.slug='lip-lustre-lip-gloss' and v.slug='mauve-hour'
  and not exists (select 1 from product_variants x where x.product_id=v.product_id and x.slug='cherry-wine');

insert into product_variants (product_id, name, slug, hex_color, finish, stock_quantity, is_default, display_order)
select p.id, 'Crystal Clear', 'crystal-clear', '#f4f2ef', 'glossy', 45, false, 1 from products p
where p.slug='lip-lustre-lip-gloss'
  and not exists (select 1 from product_variants x where x.product_id=p.id and x.slug='crystal-clear');

insert into product_variants (product_id, name, slug, hex_color, finish, stock_quantity, is_default, display_order)
select p.id, 'Coral Kiss', 'coral-kiss', '#f08a63', 'glossy', 45, false, 3 from products p
where p.slug='lip-lustre-lip-gloss'
  and not exists (select 1 from product_variants x where x.product_id=p.id and x.slug='coral-kiss');

insert into product_variants (product_id, name, slug, hex_color, finish, stock_quantity, is_default, display_order)
select p.id, 'Sunset Glow', 'sunset-glow', '#e8442a', 'glossy', 45, false, 5 from products p
where p.slug='lip-lustre-lip-gloss'
  and not exists (select 1 from product_variants x where x.product_id=p.id and x.slug='sunset-glow');

insert into product_variants (product_id, name, slug, hex_color, finish, stock_quantity, is_default, display_order)
select p.id, 'True Red', 'true-red', '#d61f2c', 'glossy', 45, false, 8 from products p
where p.slug='lip-lustre-lip-gloss'
  and not exists (select 1 from product_variants x where x.product_id=p.id and x.slug='true-red');

-- ---------- Magic Tone Lip Oil: Sakura / Vanilla / Black Currant ----------

update product_variants v set name='Vanilla', slug='vanilla', hex_color='#f3ede4', display_order=1
from products p where p.id=v.product_id and p.slug='magic-tone-lip' and v.slug='magic-coral'
  and not exists (select 1 from product_variants x where x.product_id=v.product_id and x.slug='vanilla');

update product_variants v set name='Sakura', slug='sakura', hex_color='#f2a7c3', display_order=2
from products p where p.id=v.product_id and p.slug='magic-tone-lip' and v.slug='magic-rose'
  and not exists (select 1 from product_variants x where x.product_id=v.product_id and x.slug='sakura');

update product_variants v set name='Black Currant', slug='black-currant', hex_color='#3c1f33', display_order=3
from products p where p.id=v.product_id and p.slug='magic-tone-lip' and v.slug='magic-berry'
  and not exists (select 1 from product_variants x where x.product_id=v.product_id and x.slug='black-currant');

-- ---------- Nourishing Lip Tint: 5 shades ----------

update product_variants v set name='Coral', slug='coral', hex_color='#f08160', display_order=1
from products p where p.id=v.product_id and p.slug='nourishing-lip-tint' and v.slug='petal'
  and not exists (select 1 from product_variants x where x.product_id=v.product_id and x.slug='coral');

update product_variants v set name='Scarlet', slug='scarlet', hex_color='#e5432c', display_order=2
from products p where p.id=v.product_id and p.slug='nourishing-lip-tint' and v.slug='guava'
  and not exists (select 1 from product_variants x where x.product_id=v.product_id and x.slug='scarlet');

update product_variants v set hex_color='#7a2433', display_order=4
from products p where p.id=v.product_id and p.slug='nourishing-lip-tint' and v.slug='wine';

update product_variants v set name='Black Cherry', slug='black-cherry', hex_color='#571c2a', display_order=5
from products p where p.id=v.product_id and p.slug='nourishing-lip-tint' and v.slug='cocoa'
  and not exists (select 1 from product_variants x where x.product_id=v.product_id and x.slug='black-cherry');

insert into product_variants (product_id, name, slug, hex_color, finish, stock_quantity, is_default, display_order)
select p.id, 'Ruby Red', 'ruby-red', '#b41f30', 'sheer', 40, false, 3 from products p
where p.slug='nourishing-lip-tint'
  and not exists (select 1 from product_variants x where x.product_id=p.id and x.slug='ruby-red');
