-- Customer accounts + order fulfillment pipeline.

do $$ begin
  create type fulfillment_stage as enum
    ('awaiting_payment', 'payment_received', 'packaged', 'shipped', 'delivered');
exception when duplicate_object then null; end $$;

-- ---------- customers ----------

create table if not exists customers (
  id               uuid primary key default gen_random_uuid(),
  email            citext not null unique,
  password_hash    text not null,
  name             text not null check (char_length(btrim(name)) between 1 and 120),
  phone            text,
  addr_line1       text,
  addr_line2       text,
  addr_city        text,
  addr_state       text,
  addr_postal_code text,
  addr_country     char(2) default 'US',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

drop trigger if exists customers_touch on customers;
create trigger customers_touch before update on customers
  for each row execute function set_updated_at();

-- ---------- orders: link + stage ----------

alter table orders add column if not exists customer_id uuid references customers(id) on delete set null;
alter table orders add column if not exists fulfillment_stage fulfillment_stage not null default 'awaiting_payment';

create index if not exists orders_customer_idx on orders (customer_id, created_at desc);

-- Existing paid orders enter the pipeline at payment_received.
update orders set fulfillment_stage = 'payment_received'
 where payment_status = 'paid' and fulfillment_stage = 'awaiting_payment';

-- ---------- order_events: the tracking timeline ----------

create table if not exists order_events (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references orders(id) on delete cascade,
  stage      fulfillment_stage,
  note       text,
  actor      text not null check (actor in ('admin', 'customer', 'system')),
  created_at timestamptz not null default now()
);

create index if not exists order_events_order_idx on order_events (order_id, created_at);

-- ---------- mark_order_paid v2: enters the fulfillment pipeline ----------

create or replace function mark_order_paid(
  p_order_id           uuid,
  p_payment_intent_id  text,
  p_email              text,
  p_customer_name      text,
  p_phone              text,
  p_shipping           jsonb,
  p_amount_total_cents integer,
  p_raw                jsonb
) returns orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order    orders;
  v_item     record;
  v_updated  integer;
  v_oversold boolean := false;
begin
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'order % not found', p_order_id;
  end if;

  if v_order.status <> 'pending' then
    return v_order;
  end if;

  for v_item in
    select variant_id, quantity from order_items
    where order_id = p_order_id and variant_id is not null
  loop
    update product_variants v
       set stock_quantity = v.stock_quantity - v_item.quantity
      from products p
     where v.id = v_item.variant_id
       and p.id = v.product_id
       and (not p.track_inventory or v.stock_quantity >= v_item.quantity);
    get diagnostics v_updated = row_count;

    if v_updated = 0 then
      v_oversold := true;
    else
      insert into inventory_adjustments (variant_id, delta, reason, order_id)
      values (v_item.variant_id, -v_item.quantity, 'order', p_order_id);
    end if;
  end loop;

  update orders set
    status = case
               when v_oversold then 'needs_review'::order_status
               when p_amount_total_cents is not null
                    and p_amount_total_cents is distinct from total_cents
                 then 'needs_review'::order_status
               else 'paid'::order_status
             end,
    payment_status           = 'paid',
    fulfillment_stage        = 'payment_received',
    oversold                 = v_oversold,
    stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id),
    email                    = coalesce(p_email, email),
    customer_name            = coalesce(p_customer_name, customer_name),
    phone                    = coalesce(p_phone, phone),
    shipping_name        = coalesce(p_shipping->>'name',        shipping_name),
    shipping_line1       = coalesce(p_shipping->>'line1',       shipping_line1),
    shipping_line2       = coalesce(p_shipping->>'line2',       shipping_line2),
    shipping_city        = coalesce(p_shipping->>'city',        shipping_city),
    shipping_state       = coalesce(p_shipping->>'state',       shipping_state),
    shipping_postal_code = coalesce(p_shipping->>'postal_code', shipping_postal_code),
    shipping_country     = coalesce(p_shipping->>'country',     shipping_country),
    stripe_session_raw   = coalesce(p_raw, stripe_session_raw),
    paid_at              = now()
  where id = p_order_id
  returning * into v_order;

  insert into order_events (order_id, stage, note, actor)
  values (p_order_id, 'payment_received', 'Payment received', 'system');

  return v_order;
end $$;

-- ---------- RLS (deny-all, same posture as everything else) ----------

alter table customers    enable row level security;
alter table order_events enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on customers, order_events from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on customers, order_events from authenticated;
  end if;
end $$;
