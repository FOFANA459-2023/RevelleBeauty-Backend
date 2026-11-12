import type { Mail } from '../mailer.js';
import { waLink } from '../whatsapp.js';

/**
 * The three messages a new pre-order sends:
 *
 *   store email     — everything needed to act on it: items, totals, the
 *                     customer's contact details and address, their note,
 *                     one tap to WhatsApp them and one to open the order.
 *   store WhatsApp  — the same, as plain text (WhatsApp's *bold* only).
 *   customer email  — their order back to them, what happens next, and a
 *                     one-tap way to message the store.
 *
 * Table layout + inline styles because email clients ignore stylesheets.
 * Everything a customer typed is escaped.
 */

export interface OrderForMessage {
  id: string;
  orderNumber: string;
  placedAt: Date;
  customerName: string;
  email: string;
  phone: string | null;
  note: string | null;
  currency: string;
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  shipping: {
    name: string;
    line1: string;
    line2: string | null;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  items: {
    productName: string;
    variantName: string;
    quantity: number;
    unitPriceCents: number;
    lineTotalCents: number;
    imageUrl: string | null;
  }[];
}

/* ---------- helpers ---------- */

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.trim() || 'USD' }).format(cents / 100);
}

function when(d: Date): string {
  return `${d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC`;
}

const shadeOf = (variantName: string) => (variantName && variantName !== 'Default' ? variantName : null);

function addressLines(o: OrderForMessage): string[] {
  const s = o.shipping;
  return [
    s.name,
    s.line1,
    ...(s.line2 ? [s.line2] : []),
    `${s.city}, ${s.state} ${s.postalCode}`,
    s.country,
  ];
}

/** Digits of a phone number, if there are enough to dial internationally. */
export function phoneDigits(phone: string | null): string | null {
  const d = (phone ?? '').replace(/\D/g, '');
  return d.length >= 8 && d.length <= 15 ? d : null;
}

const firstName = (full: string) => full.trim().split(/\s+/)[0] || 'there';

/* ---------- shared HTML pieces ---------- */

const C = {
  page: '#fbf3e6', card: '#ffffff', line: '#e8ce94', rule: '#cfa456', ink: '#14110e',
  soft: '#4a423a', muted: '#857a6e', gold: '#6c4f27', button: '#14110e', buttonText: '#f7e7c4',
};
const SERIF = "Georgia,'Times New Roman',serif";
const SANS = 'Arial,Helvetica,sans-serif';

function frame(title: string, preheader: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:${C.page};">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${esc(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${C.page};padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:${C.card};border:1px solid ${C.line};border-radius:4px;">
        <tr>
          <td style="padding:36px 32px 0;text-align:center;">
            <p style="margin:0;font-family:${SERIF};font-size:26px;letter-spacing:6px;color:${C.ink};">REVELLE</p>
            <p style="margin:6px 0 0;font-family:${SANS};font-size:10px;letter-spacing:3px;text-transform:uppercase;color:${C.gold};">Beauty</p>
            <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:22px auto 0;">
              <tr><td style="width:120px;border-bottom:1px solid ${C.rule};font-size:0;line-height:0;">&nbsp;</td></tr>
            </table>
          </td>
        </tr>
${body}
        <tr>
          <td style="padding:28px 32px 36px;text-align:center;font-family:${SANS};font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${C.muted};">
            Be you. Be bold. Be Revelle.
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function heading(eyebrow: string, title: string, intro?: string): string {
  return `        <tr>
          <td style="padding:28px 32px 0;text-align:center;">
            <p style="margin:0;font-family:${SANS};font-size:11px;letter-spacing:3px;text-transform:uppercase;color:${C.gold};">${esc(eyebrow)}</p>
            <p style="margin:10px 0 0;font-family:${SERIF};font-size:24px;color:${C.ink};">${esc(title)}</p>
            ${intro ? `<p style="margin:14px 0 0;font-family:${SANS};font-size:14px;line-height:22px;color:${C.soft};">${intro}</p>` : ''}
          </td>
        </tr>`;
}

function itemsTable(o: OrderForMessage): string {
  const rows = o.items
    .map((i) => {
      const shade = shadeOf(i.variantName);
      const img = i.imageUrl
        ? `<img src="${esc(i.imageUrl)}" width="56" height="56" alt="" style="display:block;width:56px;height:56px;object-fit:contain;background:#ffffff;border:1px solid ${C.line};border-radius:3px;" />`
        : '';
      return `<tr>
              <td width="64" style="padding:12px 0;border-bottom:1px solid ${C.line};vertical-align:top;">${img}</td>
              <td style="padding:12px 8px;border-bottom:1px solid ${C.line};vertical-align:top;font-family:${SANS};font-size:14px;line-height:20px;color:${C.ink};">
                ${esc(i.productName)}
                ${shade ? `<br /><span style="font-family:${SERIF};font-style:italic;color:${C.soft};">${esc(shade)}</span>` : ''}
                <br /><span style="font-size:12px;color:${C.muted};">Qty ${i.quantity} × ${money(i.unitPriceCents, o.currency)}</span>
              </td>
              <td align="right" style="padding:12px 0;border-bottom:1px solid ${C.line};vertical-align:top;font-family:${SANS};font-size:14px;color:${C.ink};white-space:nowrap;">${money(i.lineTotalCents, o.currency)}</td>
            </tr>`;
    })
    .join('\n');

  const total = (label: string, value: string, strong = false) => `<tr>
              <td></td>
              <td style="padding:${strong ? '10px' : '4px'} 8px 0;font-family:${SANS};font-size:${strong ? '15px' : '13px'};color:${strong ? C.ink : C.muted};${strong ? 'font-weight:bold;' : ''}">${label}</td>
              <td align="right" style="padding:${strong ? '10px' : '4px'} 0 0;font-family:${SANS};font-size:${strong ? '15px' : '13px'};color:${C.ink};${strong ? 'font-weight:bold;' : ''}">${value}</td>
            </tr>`;

  return `        <tr>
          <td style="padding:24px 32px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${rows}
            ${total('Subtotal', money(o.subtotalCents, o.currency))}
            ${total('Shipping', o.shippingCents === 0 ? 'Complimentary' : money(o.shippingCents, o.currency))}
            ${total('Total', money(o.totalCents, o.currency), true)}
            </table>
          </td>
        </tr>`;
}

function block(label: string, html: string): string {
  return `        <tr>
          <td style="padding:22px 32px 0;">
            <p style="margin:0 0 6px;font-family:${SANS};font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${C.muted};">${esc(label)}</p>
            <p style="margin:0;font-family:${SANS};font-size:14px;line-height:22px;color:${C.soft};">${html}</p>
          </td>
        </tr>`;
}

function buttons(list: { href: string; label: string; dark?: boolean }[]): string {
  const cells = list
    .map(
      (b) => `<td style="padding:0 6px 10px;">
                <a href="${esc(b.href)}" style="display:inline-block;padding:13px 22px;border-radius:3px;font-family:${SANS};font-size:12px;letter-spacing:2px;text-transform:uppercase;text-decoration:none;${
                  b.dark
                    ? `background-color:${C.button};color:${C.buttonText};`
                    : `border:1px solid ${C.rule};color:${C.ink};`
                }">${esc(b.label)}</a>
              </td>`,
    )
    .join('');
  return `        <tr>
          <td align="center" style="padding:26px 26px 0;">
            <table role="presentation" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table>
          </td>
        </tr>`;
}

/* ---------- the store's email ---------- */

export function storeOrderEmail(o: OrderForMessage, opts: { to: string; adminUrl: string }): Mail {
  const phone = phoneDigits(o.phone);
  const subject = `New pre-order ${o.orderNumber} · ${money(o.totalCents, o.currency)} · ${o.customerName}`;
  const contact = [
    esc(o.customerName),
    `<a href="mailto:${esc(o.email)}" style="color:${C.ink};">${esc(o.email)}</a>`,
    o.phone ? esc(o.phone) : null,
  ].filter(Boolean).join('<br />');

  const html = frame(
    subject,
    `${o.customerName} pre-ordered ${o.items.reduce((n, i) => n + i.quantity, 0)} item(s), ${money(o.totalCents, o.currency)}.`,
    [
      heading(`Pre-order ${o.orderNumber}`, 'A new order is in', `Placed ${esc(when(o.placedAt))}. No payment has been taken — contact the customer to arrange payment and delivery.`),
      itemsTable(o),
      block('Customer', contact),
      block('Ship to', addressLines(o).map(esc).join('<br />')),
      o.note ? block('Note from the customer', esc(o.note).replace(/\n/g, '<br />')) : '',
      buttons([
        ...(phone
          ? [{ href: waLink(phone, `Hi ${firstName(o.customerName)}, thank you for your Revelle Beauty pre-order ${o.orderNumber}!`), label: 'WhatsApp customer', dark: true }]
          : []),
        { href: `mailto:${o.email}?subject=${encodeURIComponent(`Your Revelle pre-order ${o.orderNumber}`)}`, label: 'Email customer' },
        { href: opts.adminUrl, label: 'Open order' },
      ]),
    ].join('\n'),
  );

  const text = [
    `New pre-order ${o.orderNumber}`,
    `Placed ${when(o.placedAt)} — no payment taken yet.`,
    '',
    ...o.items.map((i) => `${i.quantity} × ${i.productName}${shadeOf(i.variantName) ? ` — ${i.variantName}` : ''}  ${money(i.lineTotalCents, o.currency)}`),
    '',
    `Subtotal  ${money(o.subtotalCents, o.currency)}`,
    `Shipping  ${o.shippingCents === 0 ? 'Complimentary' : money(o.shippingCents, o.currency)}`,
    `Total     ${money(o.totalCents, o.currency)}`,
    '',
    'Customer',
    o.customerName,
    o.email,
    ...(o.phone ? [o.phone] : []),
    '',
    'Ship to',
    ...addressLines(o),
    ...(o.note ? ['', 'Note from the customer', o.note] : []),
    '',
    ...(phone ? [`WhatsApp the customer: ${waLink(phone)}`] : []),
    `Open the order: ${opts.adminUrl}`,
  ].join('\n');

  return { to: opts.to, subject, html, text };
}

/* ---------- the store's WhatsApp ---------- */

export function storeOrderWhatsApp(o: OrderForMessage, opts: { adminUrl: string }): string {
  const phone = phoneDigits(o.phone);
  return [
    `*New pre-order ${o.orderNumber}*`,
    `${money(o.totalCents, o.currency)} · no payment taken yet`,
    '',
    ...o.items.map((i) => `• ${i.quantity} × ${i.productName}${shadeOf(i.variantName) ? ` — ${i.variantName}` : ''} (${money(i.lineTotalCents, o.currency)})`),
    '',
    `Subtotal ${money(o.subtotalCents, o.currency)}`,
    `Shipping ${o.shippingCents === 0 ? 'free' : money(o.shippingCents, o.currency)}`,
    `*Total ${money(o.totalCents, o.currency)}*`,
    '',
    `*Customer:* ${o.customerName}`,
    `${o.email}${o.phone ? ` · ${o.phone}` : ''}`,
    `*Ship to:* ${addressLines(o).slice(1).join(', ')}`,
    ...(o.note ? [`*Note:* ${o.note}`] : []),
    '',
    ...(phone ? [`Chat: ${waLink(phone)}`] : []),
    `Order: ${opts.adminUrl}`,
  ].join('\n');
}

/* ---------- the customer's email ---------- */

export function customerOrderEmail(
  o: OrderForMessage,
  opts: { storeWhatsapp: string | null; accountUrl: string },
): Mail {
  const subject = `Your Revelle pre-order ${o.orderNumber}`;
  const chat = opts.storeWhatsapp
    ? waLink(opts.storeWhatsapp, `Hi Revelle Beauty, I placed pre-order ${o.orderNumber}.`)
    : null;

  const html = frame(
    subject,
    `We have your pre-order ${o.orderNumber}. We'll be in touch to arrange payment and delivery.`,
    [
      heading(
        `Pre-order ${o.orderNumber}`,
        `Thank you, ${firstName(o.customerName)}`,
        "We've received your pre-order. <strong>Nothing has been charged.</strong> We'll contact you on WhatsApp or by email shortly to confirm availability, payment and delivery.",
      ),
      itemsTable(o),
      block('Ship to', addressLines(o).map(esc).join('<br />')),
      o.note ? block('Your note', esc(o.note).replace(/\n/g, '<br />')) : '',
      buttons([
        ...(chat ? [{ href: chat, label: 'Message us on WhatsApp', dark: true }] : []),
        { href: opts.accountUrl, label: 'View your orders' },
      ]),
      `        <tr>
          <td style="padding:18px 32px 0;text-align:center;font-family:${SANS};font-size:12px;line-height:18px;color:${C.muted};">
            Questions? Reply to this email${chat ? ' or message us on WhatsApp' : ''} and quote ${esc(o.orderNumber)}.
          </td>
        </tr>`,
    ].join('\n'),
  );

  const text = [
    `Thank you, ${firstName(o.customerName)}.`,
    '',
    `We've received your pre-order ${o.orderNumber}. Nothing has been charged.`,
    "We'll contact you on WhatsApp or by email shortly to confirm availability, payment and delivery.",
    '',
    ...o.items.map((i) => `${i.quantity} × ${i.productName}${shadeOf(i.variantName) ? ` — ${i.variantName}` : ''}  ${money(i.lineTotalCents, o.currency)}`),
    '',
    `Subtotal  ${money(o.subtotalCents, o.currency)}`,
    `Shipping  ${o.shippingCents === 0 ? 'Complimentary' : money(o.shippingCents, o.currency)}`,
    `Total     ${money(o.totalCents, o.currency)}`,
    '',
    'Ship to',
    ...addressLines(o),
    ...(o.note ? ['', 'Your note', o.note] : []),
    '',
    ...(chat ? [`Message us on WhatsApp: ${chat}`] : []),
    `Your orders: ${opts.accountUrl}`,
    '',
    'Be you. Be bold. Be Revelle.',
  ].join('\n');

  return { to: o.email, subject, html, text };
}
