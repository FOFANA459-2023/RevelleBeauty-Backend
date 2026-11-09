-- 0017 — product reviews written by customers.
--
-- The homepage used to quote three testimonials that nobody wrote. Reviews
-- now come only from signed-in customers, one per customer per product
-- (editing replaces it), and show the moment they are posted. An admin can
-- hide one that breaks the rules; hidden reviews drop out of every average.
--
-- "Verified purchase" is not stored: it is worked out from the customer's
-- paid orders when reviews are read, so it can never be claimed.

create table if not exists product_reviews (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references products(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  rating      smallint not null check (rating between 1 and 5),
  title       text check (title is null or char_length(btrim(title)) between 1 and 120),
  body        text not null check (char_length(btrim(body)) between 10 and 2000),
  status      text not null default 'published' check (status in ('published', 'hidden')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (product_id, customer_id)
);

create index if not exists product_reviews_product_idx
  on product_reviews (product_id, status, created_at desc);
create index if not exists product_reviews_recent_idx
  on product_reviews (status, created_at desc);

drop trigger if exists product_reviews_touch on product_reviews;
create trigger product_reviews_touch before update on product_reviews
  for each row execute function set_updated_at();

-- Only the API reads and writes reviews; Supabase's public roles get nothing.
alter table product_reviews enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on product_reviews from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on product_reviews from authenticated;
  end if;
end $$;
