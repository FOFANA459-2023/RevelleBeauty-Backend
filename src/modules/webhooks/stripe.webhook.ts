import { Router, type Request, type Response } from 'express';
import type Stripe from 'stripe';
import type { Pool } from 'pg';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { stripe, markOrderPaid, extractShipping } from '../checkout/checkout.service.js';

/**
 * Mounted with express.raw BEFORE express.json — signature verification needs
 * the exact bytes Stripe sent. See app.ts mount order.
 */
export function stripeWebhookRoutes(pool: Pool): Router {
  const r = Router();

  r.post('/', async (req: Request, res: Response) => {
    if (!stripe || !env.STRIPE_WEBHOOK_SECRET) {
      // Not configured (local dev mock mode) — acknowledge and ignore.
      res.status(200).json({ received: true, ignored: 'stripe not configured' });
      return;
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body as Buffer,
        req.headers['stripe-signature'] as string,
        env.STRIPE_WEBHOOK_SECRET,
      );
    } catch (err) {
      logger.warn({ err }, 'stripe signature verification failed');
      res.status(400).send('Invalid signature');
      return;
    }

    // Idempotency layer 2: event-id dedupe.
    const claim = await pool.query(
      `insert into webhook_events (stripe_event_id, type, payload)
       values ($1, $2, $3)
       on conflict (stripe_event_id) do nothing
       returning id`,
      [event.id, event.type, JSON.stringify(event)],
    );
    if (claim.rowCount === 0) {
      const { rows } = await pool.query<{ processed_at: string | null; received_at: string }>(
        `select processed_at, received_at from webhook_events where stripe_event_id = $1`,
        [event.id],
      );
      const existing = rows[0];
      const stale =
        existing?.processed_at == null &&
        existing != null &&
        Date.now() - new Date(existing.received_at).getTime() > 5 * 60 * 1000;
      if (!stale) {
        res.status(200).json({ received: true, duplicate: true });
        return;
      }
      // else: a previous attempt crashed mid-flight — reprocess.
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed':
        case 'checkout.session.async_payment_succeeded': {
          const session = event.data.object as Stripe.Checkout.Session;
          await onCheckoutPaid(pool, session);
          break;
        }
        case 'checkout.session.expired': {
          const session = event.data.object as Stripe.Checkout.Session;
          const orderId = resolveOrderId(session);
          if (orderId) {
            await pool.query(
              `update orders set status = 'expired', cancelled_at = now()
                where id = $1 and status = 'pending'`,
              [orderId],
            );
          }
          break;
        }
        case 'charge.refunded': {
          const charge = event.data.object as Stripe.Charge;
          const pi = typeof charge.payment_intent === 'string' ? charge.payment_intent : null;
          if (pi) {
            await pool.query(
              `update orders set
                 payment_status = case when $2 >= total_cents then 'refunded'::payment_status
                                       else 'partially_refunded'::payment_status end,
                 status = case when $2 >= total_cents then 'refunded'::order_status else status end,
                 amount_refunded_cents = $2
               where stripe_payment_intent_id = $1`,
              [pi, charge.amount_refunded],
            );
          }
          break;
        }
        default:
          logger.debug({ type: event.type }, 'unhandled stripe event');
      }

      await pool.query(
        `update webhook_events set processed_at = now(), attempts = attempts + 1
          where stripe_event_id = $1`,
        [event.id],
      );
      res.status(200).json({ received: true });
    } catch (err) {
      await pool.query(
        `update webhook_events set error = $2, attempts = attempts + 1
          where stripe_event_id = $1`,
        [event.id, String((err as Error).message ?? err)],
      );
      logger.error({ err, eventId: event.id }, 'webhook handler failed');
      res.status(500).json({ received: false });
    }
  });

  return r;
}

function resolveOrderId(session: Stripe.Checkout.Session): string | null {
  return session.metadata?.order_id ?? session.client_reference_id ?? null;
}

async function onCheckoutPaid(pool: Pool, session: Stripe.Checkout.Session): Promise<void> {
  // Delayed-notification methods send completed with payment_status 'unpaid';
  // the real confirmation is async_payment_succeeded.
  if (session.payment_status !== 'paid') {
    logger.info({ sessionId: session.id }, 'checkout completed but not yet paid — waiting');
    return;
  }

  let orderId = resolveOrderId(session);
  if (!orderId) {
    const { rows } = await pool.query<{ id: string }>(
      `select id from orders where stripe_checkout_session_id = $1`,
      [session.id],
    );
    orderId = rows[0]?.id ?? null;
  }
  if (!orderId) {
    // e.g. `stripe trigger` fabricates events with no order — log and 200.
    logger.warn({ sessionId: session.id }, 'webhook could not resolve an order — ignoring');
    return;
  }

  await markOrderPaid(pool, orderId, {
    paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : null,
    email: session.customer_details?.email ?? null,
    customerName: session.customer_details?.name ?? null,
    phone: session.customer_details?.phone ?? null,
    shipping: extractShipping(session),
    amountTotalCents: session.amount_total,
    raw: session,
  });
}
