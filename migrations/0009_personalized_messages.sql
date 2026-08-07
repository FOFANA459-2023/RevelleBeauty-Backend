-- Personalized order messages, signed by the brand, plus admin notification
-- when a customer confirms delivery:
--   * every customer message greets the customer by first name and signs
--     off as Revelle Beauty;
--   * a customer-confirmed delivery sends the customer a thank-you (not a
--     plain status line) and drops a heads-up into every admin inbox.
-- Replaces the trigger function from 0007; the trigger binding is unchanged.

create or replace function notify_customer_on_order_event() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer uuid;
  v_number   text;
  v_name     text;
  v_first    text;
begin
  select o.customer_id, o.order_number, c.name
    into v_customer, v_number, v_name
    from orders o
    left join customers c on c.id = o.customer_id
   where o.id = new.order_id;

  if v_customer is null or new.stage is null then
    return new;
  end if;

  v_first := split_part(coalesce(nullif(btrim(v_name), ''), 'there'), ' ', 1);

  -- Customer pressed "Confirm delivery": thank them, and tell the team.
  if new.actor = 'customer' and new.stage = 'delivered' then
    insert into customer_messages (customer_id, order_id, kind, title, body)
    values (
      v_customer, new.order_id, 'tracking',
      'Thank you, ' || v_first || '!',
      'Hi ' || v_first || ', thanks for confirming that order ' || v_number ||
      ' arrived safely. We hope you love every shade — and if you do, tell a friend ' ||
      'who deserves a little glow. Be you, be bold. — Revelle Beauty'
    );

    insert into customer_messages (customer_id, order_id, kind, title, body)
    select a.id, new.order_id, 'order',
           'Delivery confirmed — ' || v_number,
           coalesce(nullif(btrim(v_name), ''), 'A customer') ||
           ' confirmed delivery of order ' || v_number || '. The order is now fulfilled.'
      from customers a
     where a.role = 'admin';
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
      when 'payment_received' then
        'Hi ' || v_first || ', thank you for your order! Payment for ' || v_number ||
        ' is confirmed and we''re getting started on it right away. We''ll message you at every step. — Revelle Beauty'
      when 'packaged' then
        'Hi ' || v_first || ', good news — ' || v_number ||
        ' has been carefully packaged and is ready to ship. Your shades are almost on their way. — Revelle Beauty'
      when 'shipped' then
        'Hi ' || v_first || ', ' || v_number ||
        ' has shipped! Follow its journey on your orders page — and when it lands, confirm delivery with one tap. — Revelle Beauty'
      when 'delivered' then
        'Hi ' || v_first || ', ' || v_number ||
        ' was delivered. We hope you love it — thank you for shopping with us. — Revelle Beauty'
      else coalesce(new.note, 'Hi ' || v_first || ', there''s an update on ' || v_number || '. — Revelle Beauty')
    end
  );
  return new;
end $$;
