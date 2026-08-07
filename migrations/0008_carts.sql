-- Server-side cart: the bag follows the signed-in customer across devices
-- and sessions. Only variant + quantity are stored — prices are always
-- recomputed server-side at validate/checkout time.

create table if not exists cart_items (
  customer_id uuid not null references customers(id) on delete cascade,
  variant_id  uuid not null references product_variants(id) on delete cascade,
  quantity    int  not null check (quantity between 1 and 99),
  updated_at  timestamptz not null default now(),
  primary key (customer_id, variant_id)
);

alter table cart_items enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on cart_items from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on cart_items from authenticated;
  end if;
end $$;
