-- When the store and customer were told about an order. A card payment can
-- be confirmed twice (the webhook and the success-page fallback race), so
-- notifications claim this column and are sent exactly once.
alter table orders add column if not exists notified_at timestamptz;

-- Orders that already exist predate order emails; don't announce them now.
update orders set notified_at = coalesce(paid_at, created_at)
 where notified_at is null and status <> 'pending';
