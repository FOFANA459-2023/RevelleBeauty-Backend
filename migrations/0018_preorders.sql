-- 0018 — pre-orders: an order placed without paying online.
--
-- Until payments are wired, checkout places a pre-order. Nothing is charged
-- and stock is not decremented; the store is told by email and WhatsApp, the
-- customer gets a confirmation email, and payment and delivery are arranged
-- directly. From the admin the order moves on to paid / fulfilled /
-- cancelled like any other.
--
-- (ADD VALUE is not used in this file, so it is safe inside the migration's
-- transaction.)

alter type order_status add value if not exists 'preorder';

alter table orders add column if not exists customer_note text
  check (customer_note is null or char_length(customer_note) <= 500);
