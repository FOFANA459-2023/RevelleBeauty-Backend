import { Router } from 'express';
import { z } from 'zod';
import type { Pool } from 'pg';
import { notFound } from '../../lib/errors.js';
import { storage } from '../../lib/storage.js';
import { orderListQuerySchema, orderUpdateSchema } from './admin.schemas.js';

export function adminOrderRoutes(pool: Pool): Router {
  const r = Router();

  r.get('/orders', async (req, res) => {
    const q = orderListQuerySchema.parse(req.query);
    const where: string[] = ['true'];
    const params: unknown[] = [];

    if (q.status) {
      params.push(q.status);
      where.push(`o.status = $${params.length}::order_status`);
    }
    if (q.q) {
      params.push(`%${q.q}%`);
      where.push(`(o.order_number ilike $${params.length} or o.email::text ilike $${params.length} or o.customer_name ilike $${params.length})`);
    }
    if (q.from) {
      params.push(q.from);
      where.push(`o.created_at >= $${params.length}`);
    }
    if (q.to) {
      params.push(q.to);
      where.push(`o.created_at <= $${params.length}`);
    }

    const { rows: countRows } = await pool.query<{ count: string }>(
      `select count(*) from orders o where ${where.join(' and ')}`, params,
    );
    const limit = Math.min(q.limit ?? 50, 100);
    const offset = q.offset ?? 0;
    params.push(limit, offset);

    const { rows } = await pool.query(
      `select o.*, (select coalesce(sum(quantity), 0) from order_items where order_id = o.id)::int as item_count
         from orders o
        where ${where.join(' and ')}
        order by o.created_at desc
        limit $${params.length - 1} offset $${params.length}`,
      params,
    );

    res.json({
      total: Number(countRows[0]?.count ?? 0),
      orders: rows.map((o) => ({
        id: o.id,
        orderNumber: o.order_number,
        status: o.status,
        paymentStatus: o.payment_status,
        email: o.email,
        customerName: o.customer_name,
        totalCents: o.total_cents,
        currency: o.currency.trim(),
        itemCount: o.item_count,
        oversold: o.oversold,
        createdAt: o.created_at,
        paidAt: o.paid_at,
      })),
    });
  });

  r.get('/orders/:id', async (req, res) => {
    const { rows } = await pool.query(`select * from orders where id = $1`, [req.params.id]);
    const o = rows[0];
    if (!o) throw notFound('Order not found');

    const { rows: items } = await pool.query(
      `select * from order_items where order_id = $1 order by created_at`, [o.id],
    );
    const { rows: events } = await pool.query(
      `select id, stage::text, note, actor, created_at
         from order_events where order_id = $1 order by created_at`, [o.id],
    );

    res.json({
      order: {
        fulfillmentStage: o.fulfillment_stage,
        events: events.map((e) => ({
          id: e.id,
          stage: e.stage,
          note: e.note,
          actor: e.actor,
          createdAt: e.created_at,
        })),
        id: o.id,
        orderNumber: o.order_number,
        status: o.status,
        paymentStatus: o.payment_status,
        email: o.email,
        customerName: o.customer_name,
        phone: o.phone,
        shippingName: o.shipping_name,
        shippingLine1: o.shipping_line1,
        shippingLine2: o.shipping_line2,
        shippingCity: o.shipping_city,
        shippingState: o.shipping_state,
        shippingPostalCode: o.shipping_postal_code,
        shippingCountry: o.shipping_country,
        subtotalCents: o.subtotal_cents,
        shippingCents: o.shipping_cents,
        taxCents: o.tax_cents,
        discountCents: o.discount_cents,
        totalCents: o.total_cents,
        currency: o.currency.trim(),
        itemCount: items.reduce((s, i) => s + i.quantity, 0),
        oversold: o.oversold,
        stripeCheckoutSessionId: o.stripe_checkout_session_id,
        stripePaymentIntentId: o.stripe_payment_intent_id,
        trackingNumber: o.tracking_number,
        trackingUrl: o.tracking_url,
        adminNotes: o.admin_notes,
        createdAt: o.created_at,
        paidAt: o.paid_at,
        fulfilledAt: o.fulfilled_at,
        items: items.map((i) => ({
          id: i.id,
          productId: i.product_id,
          variantId: i.variant_id,
          productName: i.product_name,
          variantName: i.variant_name,
          variantHex: i.variant_hex,
          sku: i.sku,
          unitPriceCents: i.unit_price_cents,
          quantity: i.quantity,
          lineTotalCents: i.line_total_cents,
          imageUrl: i.image_path ? storage.publicUrl(i.image_path) : null,
        })),
      },
    });
  });

  // Fulfillment pipeline: admin advances payment_received -> packaged -> shipped.
  // 'delivered' normally comes from the customer, but admin may set it too.
  r.patch('/orders/:id/stage', async (req, res) => {
    const { stage, note } = z
      .object({
        stage: z.enum(['payment_received', 'packaged', 'shipped', 'delivered']),
        note: z.string().trim().max(500).optional(),
      })
      .strict()
      .parse(req.body);

    const client = await pool.connect();
    try {
      await client.query('begin');
      const { rows } = await client.query(
        `select id from orders where id = $1 for update`,
        [req.params.id],
      );
      if (!rows[0]) throw notFound('Order not found');

      await client.query(
        `update orders set fulfillment_stage = $2::fulfillment_stage,
                status = case when $2 = 'delivered' and status = 'paid'
                              then 'fulfilled'::order_status else status end,
                fulfilled_at = case when $2 = 'delivered'
                                    then coalesce(fulfilled_at, now()) else fulfilled_at end
          where id = $1`,
        [req.params.id, stage],
      );
      await client.query(
        `insert into order_events (order_id, stage, note, actor)
         values ($1, $2::fulfillment_stage, $3, 'admin')`,
        [req.params.id, stage, note ?? null],
      );
      await client.query('commit');
      res.json({ ok: true });
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  });

  r.patch('/orders/:id', async (req, res) => {
    const patch = orderUpdateSchema.parse(req.body);
    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (col: string, val: unknown) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };
    if (patch.status !== undefined) {
      params.push(patch.status);
      sets.push(`status = $${params.length}::order_status`);
      if (patch.status === 'fulfilled') sets.push('fulfilled_at = now()');
      if (patch.status === 'cancelled') sets.push('cancelled_at = now()');
    }
    if (patch.trackingNumber !== undefined) push('tracking_number', patch.trackingNumber);
    if (patch.trackingUrl !== undefined) push('tracking_url', patch.trackingUrl);
    if (patch.adminNotes !== undefined) push('admin_notes', patch.adminNotes);

    if (sets.length) {
      params.push(req.params.id);
      const result = await pool.query(
        `update orders set ${sets.join(', ')} where id = $${params.length}`, params,
      );
      if (result.rowCount === 0) throw notFound('Order not found');
    }
    res.json({ ok: true });
  });

  r.get('/orders-export.csv', async (_req, res) => {
    const { rows } = await pool.query(`
      select o.order_number, o.status, o.email, o.customer_name, o.total_cents, o.currency,
             o.created_at, o.paid_at
        from orders o order by o.created_at desc limit 5000
    `);
    const header = 'order_number,status,email,customer_name,total_cents,currency,created_at,paid_at';
    const csv = [
      header,
      ...rows.map((r) =>
        [r.order_number, r.status, r.email ?? '', r.customer_name ?? '', r.total_cents,
         r.currency.trim(), r.created_at?.toISOString?.() ?? r.created_at, r.paid_at?.toISOString?.() ?? '']
          .map((v) => `"${String(v).replaceAll('"', '""')}"`)
          .join(','),
      ),
    ].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="revelle-orders.csv"');
    res.send(csv);
  });

  r.get('/stats', async (_req, res) => {
    const { rows } = await pool.query<{
      orders_today: string;
      revenue_30d: string;
      pending_fulfillment: string;
      oversold_count: string;
    }>(`
      select
        (select count(*) from orders where created_at >= date_trunc('day', now())
          and status in ('paid','fulfilled','needs_review')) as orders_today,
        (select coalesce(sum(total_cents), 0) from orders
          where paid_at >= now() - interval '30 days'
            and payment_status = 'paid') as revenue_30d,
        (select count(*) from orders where status = 'paid') as pending_fulfillment,
        (select count(*) from orders where status = 'needs_review') as oversold_count
    `);
    const { rows: lowStock } = await pool.query(`
      select v.id as variant_id, p.name as product_name, v.name as variant_name, v.stock_quantity
        from product_variants v join products p on p.id = v.product_id
       where p.status = 'active' and p.track_inventory and v.is_available and v.stock_quantity <= 5
       order by v.stock_quantity asc limit 10
    `);
    const s = rows[0]!;
    res.json({
      ordersToday: Number(s.orders_today),
      revenue30dCents: Number(s.revenue_30d),
      pendingFulfillment: Number(s.pending_fulfillment),
      oversoldCount: Number(s.oversold_count),
      lowStock: lowStock.map((l) => ({
        variantId: l.variant_id,
        productName: l.product_name,
        variantName: l.variant_name,
        stock: l.stock_quantity,
      })),
    });
  });

  return r;
}
