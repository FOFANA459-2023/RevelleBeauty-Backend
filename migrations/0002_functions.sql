-- Revelle Beauty — transactional functions.
-- mark_order_paid is the atomic core: pay + decrement stock + audit, idempotent.

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

  -- Idempotency: event-id dedupe is guard #1 (app layer); this is guard #2.
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
      -- Money is captured; never fail the order over stock. Flag for review.
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

  return v_order;
end $$;

-- Flip stale pending orders to expired. Called hourly by the app.
create or replace function expire_stale_orders() returns integer
language sql as $$
  with u as (
    update orders set status = 'expired', cancelled_at = now()
    where status = 'pending' and created_at < now() - interval '2 hours'
    returning 1
  ) select count(*)::int from u;
$$;
