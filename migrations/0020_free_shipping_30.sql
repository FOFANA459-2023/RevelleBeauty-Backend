-- Complimentary shipping now starts at $30 (was $50). The announcement bar
-- and the homepage newsletter line read this text; the homepage marquee and
-- value props read the threshold itself.
update store_settings set
  free_shipping_threshold_cents = 3000,
  announcement = 'COMPLIMENTARY SHIPPING ON ORDERS OVER $30'
where free_shipping_threshold_cents = 5000;
