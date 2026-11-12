import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * WhatsApp messages to the STORE's own number (new-order alerts).
 *
 *  none      — logged only; dev/test default.
 *  callmebot — CallMeBot's free API. It can only message a number that has
 *              opted in by sending CallMeBot an activation message, which is
 *              exactly the case here: the store messages itself.
 *
 * Messaging customers on WhatsApp needs Meta's WhatsApp Business Cloud API
 * (a verified business and approved message templates); until then customers
 * get email, plus a one-tap "message us on WhatsApp" link.
 */

/** Test hook: in NODE_ENV=test messages are captured here instead of sent. */
export const whatsappOutboxForTest: { to: string; text: string }[] = [];

export async function sendStoreWhatsApp(text: string): Promise<void> {
  const to = env.STORE_WHATSAPP;
  if (env.NODE_ENV === 'test') {
    whatsappOutboxForTest.push({ to: to ?? '', text });
    return;
  }
  if (env.WHATSAPP_DRIVER === 'callmebot' && to && env.CALLMEBOT_API_KEY) {
    const url = new URL('https://api.callmebot.com/whatsapp.php');
    url.searchParams.set('phone', to);
    url.searchParams.set('text', text);
    url.searchParams.set('apikey', env.CALLMEBOT_API_KEY);
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`callmebot responded ${res.status}`);
    logger.info('store whatsapp sent via callmebot');
    return;
  }
  logger.info({ text }, 'WHATSAPP_DRIVER=none — store WhatsApp message logged, not sent');
}

/** A wa.me link that opens a chat with `digits`, optionally prefilled. */
export function waLink(digits: string, text?: string): string {
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}
