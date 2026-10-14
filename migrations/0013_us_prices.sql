-- 0013 — the real US retail prices.
--
-- Taken from the brand's own pricing sheet (USA column; the Liberia column is
-- a separate market and is deliberately not modelled here — the store sells in
-- one currency, see store_settings.currency = 'USD').
--
-- Every lip product is $14.99 except the two accessories at $7.99. The four
-- skincare items are not on the sheet and keep the prices they have.
--
-- Prices live on the product; no variant carries a price_cents_override, so a
-- single base price is the whole story and the storefront's "from" range
-- collapses to one figure per product.
--
-- Safe for order history: order_items snapshot unit_price_cents at purchase
-- time, so past orders keep what was actually charged.
--
-- Idempotent.

update products set base_price_cents = 1499
 where slug in (
   'high-shine-lip-oil',
   'ultra-light-lip-oil',
   'lip-lustre-lip-gloss',
   'diamond-lip-gloss',
   'nourishing-lip-tint',
   'magic-tone-lip',
   'lip-gloss-hyaluronic-acid',
   'peptide-lip-lacquer',
   'creamy-matte-lipstick',
   'long-lasting-matte-liquid-lipstick'
 )
   and base_price_cents is distinct from 1499;

update products set base_price_cents = 799
 where slug in ('sugar-lip-scrub', 'matte-lip-liner')
   and base_price_cents is distinct from 799;
