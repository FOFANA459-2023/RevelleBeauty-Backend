import type { Pool, PoolClient } from 'pg';
import Stripe from 'stripe';
import type {
  CartItemInput,
  CreateCheckoutSessionResponse,
  OrderConfirmation,
  OrderConfirmationResponse,
} from '@contracts/index';
import { env, isDev, stripeEnabled } from '../../config/env.js';
import { badRequest, conflict, notFound, unavailable } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { storage } from '../../lib/storage.js';
import { priceCart, type PricedLine } from './pricing.service.js';
import { getSettings } from '../catalog/catalog.service.js';

export const stripe = stripeEnabled
  ? new Stripe(env.STRIPE_SECRET_KEY!, { apiVersion: '2025-08-27.basil' })
  : null;

/* ---------- create session ---------- */

export async function createCheckoutSession(
  pool: Pool,
  items: CartItemInput[],
  email?: string,
): Promise<CreateCheckoutSessionResponse> {
  const settings = await getSettings(pool);
  if (!settings.checkoutEnabled) throw unavailable('Checkout is temporarily disabled');

  if (items.length === 0 || items.length > env.MAX_CART_LINES) {
    throw badRequest(`Cart must have 1-${env.MAX_CART_LINES} lines`);
  }

  const { lines, issues } = await priceCart(pool, items);

  // Any issue is a 409 the UI can reconcile from.
  if (issues.length > 0) {
    throw conflict('Your bag has changed — please review it', { issues });
  }

  const subtotalCents = lines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);
  const freeShipping =
    settings.freeShippingThresholdCents != null &&
    subtotalCents >= settings.freeShippingThresholdCents;
  const shippingCents = freeShipping ? 0 : settings.flatShippingCents;
  const totalCents = subtotalCents + shippingCents;

  // Pending order + snapshot items BEFORE the payment session exists.
  const client = await pool.connect();
  let orderId: string;
  let orderNumber: string;
  try {
    await client.query('begin');
    const { rows } = await client.query<{ id: string; order_number: string }>(
      `insert into orders (status, email, currency, subtotal_cents, shipping_cents, total_cents, expires_at)
       values ('pending', $1, $2, $3, $4, $5, now() + interval '30 minutes')
       returning id, order_number`,
      [email ?? null, settings.currency, subtotalCents, shippingCents, totalCents],
    );
    orderId = rows[0]!.id;
    orderNumber = rows[0]!.order_number;

    for (const l of lines) {
      await client.query(
        `insert into order_items
           (order_id, product_id, variant_id, product_name, product_slug,
            variant_name, variant_hex, sku, image_path, unit_price_cents, quantity)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          orderId, l.productId, l.variantId, l.productName, l.productSlug,
          l.variantName, l.hexColor, null,
          l.imageUrl ? stripPublicUrl(l.imageUrl) : null,
          l.unitPriceCents, l.quantity,
        ],
      );
    }
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }

  const totals = {
    subtotalCents,
    shippingCents,
    totalCents,
    currency: settings.currency,
  };

  if (!stripe) {
    // Dev mock mode: no Stripe keys yet. The frontend redirects to a local
    // mock-payment page which then calls POST /api/checkout/mock-pay.
    if (!isDev) throw unavailable('Payments are not configured');
    const sessionId = `mock_${orderId}`;
    await pool.query(`update orders set stripe_checkout_session_id = $1 where id = $2`, [
      sessionId, orderId,
    ]);
    return {
      checkoutUrl: `${env.FRONTEND_URL}/checkout/mock?session_id=${sessionId}`,
      sessionId,
      orderId,
      orderNumber,
      totals,
    };
  }

  const session = await stripe.checkout.sessions.create(
    {
      mode: 'payment',
      line_items: lines.map((l) => ({
        quantity: l.quantity,
        price_data: {
          currency: settings.currency.toLowerCase(),
          unit_amount: l.unitPriceCents,
          product_data: {
            name: l.variantName !== 'Default'
              ? `${l.productName} — ${l.variantName}`
              : l.productName,
            description: l.hexColor ?? undefined,
            metadata: { variant_id: l.variantId, product_id: l.productId },
          },
        },
      })),
      client_reference_id: orderId,
      metadata: { order_id: orderId, order_number: orderNumber },
      payment_intent_data: { metadata: { order_id: orderId, order_number: orderNumber } },
      customer_email: email || undefined,
      shipping_address_collection: {
        allowed_countries: settings.allowedShippingCountries as Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry[],
      },
      phone_number_collection: { enabled: true },
      shipping_options: [
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            display_name: shippingCents === 0 ? 'Free shipping' : 'Standard shipping',
            fixed_amount: { amount: shippingCents, currency: settings.currency.toLowerCase() },
            delivery_estimate: {
              minimum: { unit: 'business_day', value: 3 },
              maximum: { unit: 'business_day', value: 7 },
            },
          },
        },
      ],
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      // {CHECKOUT_SESSION_ID} is a literal Stripe template — never encode it.
      success_url: `${env.FRONTEND_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.FRONTEND_URL}/cart?canceled=1`,
    },
    { idempotencyKey: `checkout:${orderId}` },
  );

  await pool.query(`update orders set stripe_checkout_session_id = $1 where id = $2`, [
    session.id, orderId,
  ]);

  return { checkoutUrl: session.url!, sessionId: session.id, orderId, orderNumber, totals };
}

function stripPublicUrl(url: string): string {
  // Reverse of storage.publicUrl for snapshotting the raw path.
  const idx = url.indexOf('/uploads/');
  if (idx >= 0) return url.slice(idx + '/uploads/'.length);
  const pub = url.indexOf('/object/public/');
  if (pub >= 0) {
    const rest = url.slice(pub + '/object/public/'.length);
    return rest.slice(rest.indexOf('/') + 1);
  }
  return url;
}

/* ---------- mark paid (shared by webhook, success fallback, and mock) ---------- */

export interface PaidDetails {
  paymentIntentId: string | null;
  email: string | null;
  customerName: string | null;
  phone: string | null;
  shipping: Record<string, string | null> | null;
  amountTotalCents: number | null;
  raw: unknown;
}

export async function markOrderPaid(
  db: Pool | PoolClient,
  orderId: string,
  d: PaidDetails,
): Promise<void> {
  await db.query(`select mark_order_paid($1,$2,$3,$4,$5,$6,$7,$8)`, [
    orderId,
    d.paymentIntentId,
    d.email,
    d.customerName,
    d.phone,
    d.shipping ? JSON.stringify(d.shipping) : null,
    d.amountTotalCents,
    d.raw ? JSON.stringify(d.raw) : null,
  ]);
}

/* ---------- confirmation (success page) ---------- */

export async function getOrderConfirmation(
  pool: Pool,
  sessionId: string,
): Promise<OrderConfirmationResponse> {
  const order = await loadOrderBySession(pool, sessionId);
  if (!order) throw notFound('Order not found');

  if (order.status === 'pending' && stripe && !sessionId.startsWith('mock_')) {
    // The redirect can beat the webhook. Ask Stripe directly (server-side —
    // never a client claim) and finalize with the same idempotent function.
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.payment_status === 'paid') {
        await markOrderPaid(pool, order.id, {
          paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : null,
          email: session.customer_details?.email ?? null,
          customerName: session.customer_details?.name ?? null,
          phone: session.customer_details?.phone ?? null,
          shipping: extractShipping(session),
          amountTotalCents: session.amount_total,
          raw: session,
        });
        return getOrderConfirmation(pool, sessionId);
      }
      if (session.status === 'expired') return { status: 'expired', order: null };
    } catch (err) {
      logger.warn({ err, sessionId }, 'stripe session retrieve failed');
    }
    return { status: 'processing', order: null };
  }

  if (order.status === 'pending') return { status: 'processing', order: null };
  if (order.status === 'expired' || order.status === 'cancelled') {
    return { status: 'expired', order: null };
  }

  return { status: 'paid', order: await buildConfirmation(pool, order) };
}

interface OrderRow {
  id: string;
  order_number: string;
  status: string;
  email: string | null;
  currency: string;
  subtotal_cents: number;
  shipping_cents: number;
  tax_cents: number;
  total_cents: number;
  shipping_name: string | null;
  shipping_line1: string | null;
  shipping_line2: string | null;
  shipping_city: string | null;
  shipping_state: string | null;
  shipping_postal_code: string | null;
  shipping_country: string | null;
  paid_at: string | null;
  created_at: string;
}

async function loadOrderBySession(pool: Pool, sessionId: string): Promise<OrderRow | null> {
  const { rows } = await pool.query<OrderRow>(
    `select * from orders where stripe_checkout_session_id = $1`,
    [sessionId],
  );
  return rows[0] ?? null;
}

async function buildConfirmation(pool: Pool, o: OrderRow): Promise<OrderConfirmation> {
  const { rows: items } = await pool.query<{
    product_name: string;
    product_slug: string;
    variant_name: string;
    variant_hex: string | null;
    quantity: number;
    unit_price_cents: number;
    line_total_cents: number;
    image_path: string | null;
  }>(`select * from order_items where order_id = $1 order by created_at`, [o.id]);

  return {
    orderNumber: o.order_number,
    email: o.email,
    placedAt: o.paid_at ?? o.created_at,
    currency: o.currency.trim(),
    subtotalCents: o.subtotal_cents,
    shippingCents: o.shipping_cents,
    taxCents: o.tax_cents,
    totalCents: o.total_cents,
    shipping: o.shipping_line1
      ? {
          name: o.shipping_name,
          line1: o.shipping_line1,
          line2: o.shipping_line2,
          city: o.shipping_city,
          state: o.shipping_state,
          postalCode: o.shipping_postal_code,
          country: o.shipping_country,
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
  };
}

export function extractShipping(session: Stripe.Checkout.Session): Record<string, string | null> | null {
  // Basil API: shipping details live in collected_information.
  const collected = (session as unknown as {
    collected_information?: {
      shipping_details?: { name?: string | null; address?: Stripe.Address | null };
    };
  }).collected_information;
  const details = collected?.shipping_details;
  const addr = details?.address;
  if (!addr) return null;
  return {
    name: details?.name ?? null,
    line1: addr.line1 ?? null,
    line2: addr.line2 ?? null,
    city: addr.city ?? null,
    state: addr.state ?? null,
    postal_code: addr.postal_code ?? null,
    country: addr.country ?? null,
  };
}
