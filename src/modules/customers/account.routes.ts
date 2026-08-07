import { Router } from 'express';
import { z } from 'zod';
import type { Pool } from 'pg';
import { notFound } from '../../lib/errors.js';
import { storage } from '../../lib/storage.js';
import { customerId, requireCustomer } from '../../middleware/auth.js';

const cartPutSchema = z
  .object({
    items: z
      .array(
        z.object({
          variantId: z.string().uuid(),
          quantity: z.number().int().min(1).max(99),
        }).strict(),
      )
      .max(40),
  })
  .strict();

export function accountRoutes(pool: Pool): Router {
  const r = Router();
  r.use(requireCustomer);

  r.get('/orders', async (req, res) => {
    const { rows } = await pool.query(
      `select o.id, o.order_number, o.status::text, o.fulfillment_stage::text,
              o.total_cents, o.currency, o.created_at, o.paid_at,
              o.tracking_number, o.tracking_url,
              (select coalesce(sum(quantity), 0) from order_items where order_id = o.id)::int as item_count,
              (select i.image_path from order_items i where i.order_id = o.id and i.image_path is not null limit 1) as thumb_path
         from orders o
        where o.customer_id = $1
          and o.status not in ('pending', 'expired')
        order by o.created_at desc
        limit 100`,
      [customerId(req)],
    );
    res.json({
      orders: rows.map((o) => ({
        id: o.id,
        orderNumber: o.order_number,
        status: o.status,
        fulfillmentStage: o.fulfillment_stage,
        totalCents: o.total_cents,
        currency: o.currency.trim(),
        itemCount: o.item_count,
        trackingNumber: o.tracking_number,
        trackingUrl: o.tracking_url,
        thumbUrl: o.thumb_path ? storage.publicUrl(o.thumb_path) : null,
        placedAt: o.paid_at ?? o.created_at,
      })),
    });
  });

  r.get('/orders/:id', async (req, res) => {
    const { rows } = await pool.query(
      `select * from orders where id = $1 and customer_id = $2`,
      [req.params.id, customerId(req)],
    );
    const o = rows[0];
    if (!o) throw notFound('Order not found');

    const { rows: items } = await pool.query(
      `select * from order_items where order_id = $1 order by created_at`,
      [o.id],
    );
    const { rows: events } = await pool.query(
      `select id, stage::text, note, actor, created_at
         from order_events where order_id = $1 order by created_at`,
      [o.id],
    );

    res.json({
      order: {
        id: o.id,
        orderNumber: o.order_number,
        status: o.status,
        fulfillmentStage: o.fulfillment_stage,
        placedAt: o.paid_at ?? o.created_at,
        currency: o.currency.trim(),
        subtotalCents: o.subtotal_cents,
        shippingCents: o.shipping_cents,
        taxCents: o.tax_cents,
        totalCents: o.total_cents,
        trackingNumber: o.tracking_number,
        trackingUrl: o.tracking_url,
        shipping: o.shipping_line1
          ? {
              name: o.shipping_name,
              line1: o.shipping_line1,
              line2: o.shipping_line2,
              city: o.shipping_city,
              state: o.shipping_state,
              postalCode: o.shipping_postal_code,
              country: o.shipping_country?.trim() ?? null,
            }
          : null,
        items: items.map((i) => ({
          productName: i.product_name,
          productSlug: i.product_slug,
          variantName: i.variant_name,
          variantHex: i.variant_hex,
          quantity: i.quantity,
          unitPriceCents: i.unit_price_cents,
          lineTotalCents: i.line_total_cents,
          imageUrl: i.image_path ? storage.publicUrl(i.image_path) : null,
        })),
        events: events.map((e) => ({
          id: e.id,
          stage: e.stage,
          note: e.note,
          actor: e.actor,
          createdAt: e.created_at,
        })),
      },
    });
  });

  // ---------- cart: the bag follows the customer across devices ----------

  r.get('/cart', async (req, res) => {
    const { rows } = await pool.query(
      `select variant_id, quantity from cart_items
        where customer_id = $1 order by updated_at`,
      [customerId(req)],
    );
    res.json({ items: rows.map((c) => ({ variantId: c.variant_id, quantity: c.quantity })) });
  });

  r.put('/cart', async (req, res) => {
    const { items } = cartPutSchema.parse(req.body);
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`delete from cart_items where customer_id = $1`, [customerId(req)]);
      if (items.length) {
        // Join against product_variants so stale/deleted variants are
        // silently dropped instead of failing the whole write.
        await client.query(
          `insert into cart_items (customer_id, variant_id, quantity)
           select $1, v.id, x.quantity
             from unnest($2::uuid[], $3::int[]) as x(variant_id, quantity)
             join product_variants v on v.id = x.variant_id`,
          [customerId(req), items.map((i) => i.variantId), items.map((i) => i.quantity)],
        );
      }
      await client.query('commit');
      res.json({ ok: true });
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  });

  // ---------- messages: the customer inbox ----------
  // Auto-populated (welcome + one per order event via DB trigger); read
  // state lives server-side so it survives logout and other devices.

  r.get('/messages', async (req, res) => {
    const { rows } = await pool.query(
      `select id, order_id, kind, title, body, created_at, read_at
         from customer_messages
        where customer_id = $1
        order by created_at desc
        limit 100`,
      [customerId(req)],
    );
    res.json({
      messages: rows.map((m) => ({
        id: m.id,
        orderId: m.order_id,
        kind: m.kind,
        title: m.title,
        body: m.body,
        createdAt: m.created_at,
        readAt: m.read_at,
      })),
      unreadCount: rows.filter((m) => !m.read_at).length,
    });
  });

  r.post('/messages/read', async (req, res) => {
    await pool.query(
      `update customer_messages set read_at = now()
        where customer_id = $1 and read_at is null`,
      [customerId(req)],
    );
    res.json({ ok: true });
  });

  // Customer confirms delivery — reflects back to the admin timeline.
  r.post('/orders/:id/confirm-delivery', async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const { rows } = await client.query(
        `select id, fulfillment_stage::text from orders
          where id = $1 and customer_id = $2 for update`,
        [req.params.id, customerId(req)],
      );
      const o = rows[0];
      if (!o) throw notFound('Order not found');

      if (o.fulfillment_stage !== 'delivered') {
        await client.query(
          `update orders set fulfillment_stage = 'delivered',
                  status = case when status = 'paid' then 'fulfilled'::order_status else status end,
                  fulfilled_at = coalesce(fulfilled_at, now())
            where id = $1`,
          [o.id],
        );
        await client.query(
          `insert into order_events (order_id, stage, note, actor)
           values ($1, 'delivered', 'Delivery confirmed by customer', 'customer')`,
          [o.id],
        );
      }
      await client.query('commit');
      res.json({ ok: true });
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  });

  return r;
}
