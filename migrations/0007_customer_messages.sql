-- Customer message inbox. Messages are generated automatically:
--   * a welcome message at registration (app code), and
--   * one message per order_events row via trigger — so order confirmations
--     and every tracking update become inbox messages regardless of which
--     code path (webhook, mock pay, admin, customer) wrote the event.
-- Stored server-side so the inbox survives logout and follows the customer
-- across devices.

create table if not exists customer_messages (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  order_id    uuid references orders(id) on delete cascade,
  kind        text not null check (kind in ('welcome', 'order', 'tracking')),
  title       text not null,
  body        text not null,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);

create index if not exists customer_messages_idx
  on customer_messages (customer_id, created_at desc);

create or replace function notify_customer_on_order_event() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer uuid;
  v_number   text;
begin
  select customer_id, order_number into v_customer, v_number
    from orders where id = new.order_id;
  if v_customer is null or new.stage is null then
    return new;
  end if;

  insert into customer_messages (customer_id, order_id, kind, title, body)
  values (
    v_customer,
    new.order_id,
    case when new.stage = 'payment_received' then 'order' else 'tracking' end,
    case new.stage
      when 'payment_received' then 'Order ' || v_number || ' confirmed'
      when 'packaged'         then 'Order ' || v_number || ' is packaged'
      when 'shipped'          then 'Order ' || v_number || ' is on its way'
      when 'delivered'        then 'Order ' || v_number || ' was delivered'
      else 'Order ' || v_number || ' update'
    end,
    case new.stage
      when 'payment_received' then 'Thank you! We received your payment and your order is confirmed. We''ll message you at every step.'
      when 'packaged'         then 'Your order has been carefully packaged and is ready to ship.'
      when 'shipped'          then 'Your order has shipped. Track its journey from your orders page.'
      when 'delivered'        then 'Your order was delivered. We hope you love it — thank you for shopping Revelle.'
      else coalesce(new.note, 'There''s an update on your order.')
    end
  );
  return new;
end $$;

drop trigger if exists order_events_notify on order_events;
create trigger order_events_notify
  after insert on order_events
  for each row execute function notify_customer_on_order_event();

-- Same deny-all posture as every other table.
alter table customer_messages enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on customer_messages from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on customer_messages from authenticated;
  end if;
end $$;
