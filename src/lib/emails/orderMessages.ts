import type { Mail, InlineImage } from '../mailer.js';
import { waLink } from '../whatsapp.js';

/**
 * Order emails and the store's WhatsApp alert.
 *
 *   customerOrderEmail   — the receipt: progress, items, totals, address.
 *   customerStatusEmail  — packaged / shipped (with tracking) / delivered.
 *   storeOrderEmail      — everything the store needs to act on a new order.
 *   storeOrderWhatsApp   — the same, as plain text (WhatsApp's *bold* only).
 *
 * Email clients ignore stylesheets, so it is tables and inline styles. The
 * logo and product photos are referenced as cid: images; the mailer embeds
 * them in the message (or swaps in their public URL for drivers that can't),
 * so they show even when the site serving them isn't reachable from Gmail.
 * Everything a customer typed is escaped.
 */

export type FulfillmentStage = 'payment_received' | 'packaged' | 'shipped' | 'delivered';
export type StatusStage = Exclude<FulfillmentStage, 'payment_received'>;

export interface OrderForMessage {
  id: string;
  orderNumber: string;
  placedAt: Date;
  customerName: string;
  email: string;
  phone: string | null;
  currency: string;
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  trackingNumber: string | null;
  trackingUrl: string | null;
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

export interface Links {
  /** Absolute site URL, no trailing slash. */
  site: string;
  /** The store's WhatsApp digits, if any. */
  storeWhatsapp: string | null;
}

/* ---------- helpers ---------- */

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.trim() || 'USD' }).format(cents / 100);
}

function day(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function when(d: Date): string {
  return `${d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC`;
}

const shadeOf = (variantName: string) => (variantName && variantName !== 'Default' ? variantName : null);
const itemCount = (o: OrderForMessage) => o.items.reduce((n, i) => n + i.quantity, 0);

function addressLines(o: OrderForMessage): string[] {
  const s = o.shipping;
  return [s.name, s.line1, ...(s.line2 ? [s.line2] : []), `${s.city}, ${s.state} ${s.postalCode}`, s.country];
}

/** Digits of a phone number, if there are enough to dial internationally. */
export function phoneDigits(phone: string | null): string | null {
  const d = (phone ?? '').replace(/\D/g, '');
  return d.length >= 8 && d.length <= 15 ? d : null;
}

const firstName = (full: string) => full.trim().split(/\s+/)[0] || 'there';

const LOGO_CID = 'logo@revelle';
const itemCid = (i: number) => `item${i}@revelle`;

/** The cid images an order email uses: the logo plus one per photographed item. */
function inlineImages(o: OrderForMessage, links: Links): InlineImage[] {
  return [
    { cid: LOGO_CID, url: `${links.site}/email/logo.png` },
    ...o.items.flatMap((it, i) => (it.imageUrl ? [{ cid: itemCid(i), url: it.imageUrl }] : [])),
  ];
}

/* ---------- design tokens ---------- */

const C = {
  page: '#f6eee2',
  card: '#ffffff',
  panel: '#fbf6ee',
  line: '#ecdcc0',
  gold: '#b8893f',
  goldDeep: '#6c4f27',
  ink: '#14110e',
  soft: '#4a423a',
  muted: '#8a7f73',
  cream: '#f7e7c4',
};
const SERIF = "'Cormorant Garamond',Georgia,'Times New Roman',serif";
const SANS = "'Helvetica Neue',Arial,Helvetica,sans-serif";

/* ---------- building blocks ---------- */

function layout(opts: { title: string; preheader: string; body: string; footerNote: string; links: Links }): string {
  const { links } = opts;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light only" />
  <title>${esc(opts.title)}</title>
</head>
<body style="margin:0;padding:0;background-color:${C.page};-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${esc(opts.preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${C.page};">
    <tr><td align="center" style="padding:28px 12px 40px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
        <tr><td style="background-color:${C.card};border:1px solid ${C.line};border-radius:6px;overflow:hidden;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td align="center" style="padding:30px 24px 22px;background-color:${C.card};">
                <a href="${esc(links.site)}" style="text-decoration:none;">
                  <img src="cid:${LOGO_CID}" width="88" height="88" alt="Revelle Beauty" style="display:block;width:88px;height:88px;border:0;margin:0 auto;" />
                </a>
              </td>
            </tr>
            <tr><td style="height:3px;line-height:3px;font-size:0;background-color:${C.gold};">&nbsp;</td></tr>
${opts.body}
            <tr>
              <td style="padding:30px 32px 34px;background-color:${C.panel};border-top:1px solid ${C.line};text-align:center;">
                <p style="margin:0;font-family:${SERIF};font-size:20px;font-style:italic;color:${C.ink};">Be you. Be bold. Be Revelle.</p>
                <p style="margin:14px 0 0;font-family:${SANS};font-size:12px;line-height:20px;color:${C.muted};">
                  <a href="${esc(links.site)}/shop" style="color:${C.goldDeep};text-decoration:none;">Shop</a>
                  &nbsp;&middot;&nbsp;
                  <a href="${esc(links.site)}/account/orders" style="color:${C.goldDeep};text-decoration:none;">Your orders</a>
                  ${links.storeWhatsapp ? `&nbsp;&middot;&nbsp;<a href="${esc(waLink(links.storeWhatsapp))}" style="color:${C.goldDeep};text-decoration:none;">WhatsApp us</a>` : ''}
                </p>
                <p style="margin:12px 0 0;font-family:${SANS};font-size:11px;line-height:17px;color:${C.muted};">${opts.footerNote}</p>
              </td>
            </tr>
          </table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function hero(eyebrow: string, title: string, intro: string): string {
  return `            <tr>
              <td align="center" style="padding:34px 32px 6px;">
                <p style="margin:0;font-family:${SANS};font-size:11px;font-weight:bold;letter-spacing:3px;text-transform:uppercase;color:${C.gold};">${esc(eyebrow)}</p>
                <h1 style="margin:12px 0 0;font-family:${SERIF};font-size:34px;line-height:40px;font-weight:normal;color:${C.ink};">${esc(title)}</h1>
                <p style="margin:14px auto 0;max-width:440px;font-family:${SANS};font-size:15px;line-height:24px;color:${C.soft};">${intro}</p>
              </td>
            </tr>`;
}

const STEPS: { stage: FulfillmentStage; label: string }[] = [
  { stage: 'payment_received', label: 'Confirmed' },
  { stage: 'packaged', label: 'Packed' },
  { stage: 'shipped', label: 'Shipped' },
  { stage: 'delivered', label: 'Delivered' },
];

/** Four-step progress bar; every step up to `current` is filled. */
function tracker(current: FulfillmentStage): string {
  const at = STEPS.findIndex((s) => s.stage === current);
  const cells = STEPS.map((s, i) => {
    const done = i <= at;
    return `<td width="25%" style="width:25%;padding:0 3px;vertical-align:top;">
                      <div style="height:6px;line-height:6px;font-size:0;border-radius:3px;background-color:${done ? C.gold : C.line};">&nbsp;</div>
                      <p style="margin:9px 0 0;font-family:${SANS};font-size:10px;line-height:14px;letter-spacing:0.5px;text-transform:uppercase;text-align:center;color:${i === at ? C.ink : done ? C.goldDeep : C.muted};${i === at ? 'font-weight:bold;' : ''}">${s.label}</p>
                    </td>`;
  }).join('');
  return `            <tr>
              <td style="padding:26px 29px 4px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;"><tr>${cells}</tr></table>
              </td>
            </tr>`;
}

function metaRow(o: OrderForMessage, third: [string, string]): string {
  const cell = (label: string, value: string, align: string) =>
    `<td style="padding:14px 12px;text-align:${align};vertical-align:top;">
                      <p style="margin:0;font-family:${SANS};font-size:10px;letter-spacing:2px;text-transform:uppercase;color:${C.muted};">${label}</p>
                      <p style="margin:5px 0 0;font-family:${SANS};font-size:14px;font-weight:bold;color:${C.ink};">${value}</p>
                    </td>`;
  return `            <tr>
              <td style="padding:24px 32px 0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${C.panel};border:1px solid ${C.line};border-radius:4px;">
                  <tr>
                    ${cell('Order', esc(o.orderNumber), 'left')}
                    ${cell('Placed', esc(day(o.placedAt)), 'center')}
                    ${cell(third[0], third[1], 'right')}
                  </tr>
                </table>
              </td>
            </tr>`;
}

function itemsTable(o: OrderForMessage, opts: { totals: boolean }): string {
  const rows = o.items
    .map((it, i) => {
      const shade = shadeOf(it.variantName);
      const img = it.imageUrl
        ? `<img src="cid:${itemCid(i)}" width="64" height="64" alt="" style="display:block;width:64px;height:64px;border:1px solid ${C.line};border-radius:4px;background-color:#ffffff;" />`
        : `<div style="width:64px;height:64px;border:1px solid ${C.line};border-radius:4px;background-color:${C.panel};font-family:${SERIF};font-size:20px;line-height:64px;text-align:center;color:${C.gold};">RB</div>`;
      return `<tr>
                    <td width="76" style="padding:14px 0;border-bottom:1px solid ${C.line};vertical-align:middle;">${img}</td>
                    <td style="padding:14px 10px;border-bottom:1px solid ${C.line};vertical-align:middle;">
                      <p style="margin:0;font-family:${SANS};font-size:15px;line-height:20px;color:${C.ink};">${esc(it.productName)}</p>
                      ${shade ? `<p style="margin:3px 0 0;font-family:${SERIF};font-size:16px;font-style:italic;color:${C.soft};">${esc(shade)}</p>` : ''}
                      <p style="margin:4px 0 0;font-family:${SANS};font-size:12px;color:${C.muted};">Qty ${it.quantity} &times; ${money(it.unitPriceCents, o.currency)}</p>
                    </td>
                    <td align="right" style="padding:14px 0;border-bottom:1px solid ${C.line};vertical-align:middle;font-family:${SANS};font-size:15px;color:${C.ink};white-space:nowrap;">${money(it.lineTotalCents, o.currency)}</td>
                  </tr>`;
    })
    .join('\n');

  const line = (label: string, value: string, strong = false) => `<tr>
                    <td colspan="2" style="padding:${strong ? '14px' : '6px'} 10px 0 0;text-align:right;font-family:${SANS};font-size:${strong ? '16px' : '13px'};color:${strong ? C.ink : C.muted};${strong ? 'font-weight:bold;' : ''}">${label}</td>
                    <td align="right" style="padding:${strong ? '14px' : '6px'} 0 0;font-family:${SANS};font-size:${strong ? '16px' : '13px'};color:${C.ink};white-space:nowrap;${strong ? 'font-weight:bold;' : ''}">${value}</td>
                  </tr>`;

  const heading = itemCount(o) === 1 ? 'Your item' : `Your items (${itemCount(o)})`;
  return `            <tr>
              <td style="padding:22px 32px 0;">
                <p style="margin:0 0 4px;font-family:${SANS};font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:${C.ink};">${heading}</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  ${rows}
                  ${opts.totals ? [
                    line('Subtotal', money(o.subtotalCents, o.currency)),
                    line('Shipping', o.shippingCents === 0 ? 'Complimentary' : money(o.shippingCents, o.currency)),
                    line('Total paid', money(o.totalCents, o.currency), true),
                  ].join('\n') : ''}
                </table>
              </td>
            </tr>`;
}

/** Up to two side-by-side panels that stack on narrow screens. */
function panels(...list: [string, string][]): string {
  const panel = ([label, html]: [string, string]) =>
    `<div style="display:inline-block;width:100%;max-width:${list.length > 1 ? '262px' : '524px'};vertical-align:top;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:8px 6px;">
                    <p style="margin:0 0 6px;font-family:${SANS};font-size:10px;letter-spacing:2px;text-transform:uppercase;color:${C.muted};">${label}</p>
                    <p style="margin:0;font-family:${SANS};font-size:14px;line-height:22px;color:${C.soft};">${html}</p>
                  </td></tr></table>
                </div>`;
  return `            <tr>
              <td style="padding:22px 26px 0;font-size:0;">
                ${list.map(panel).join('')}
              </td>
            </tr>`;
}

function buttons(list: { href: string; label: string; dark?: boolean }[]): string {
  const cells = list
    .map(
      (b) => `<td style="padding:0 5px 10px;">
                      <a href="${esc(b.href)}" style="display:inline-block;padding:14px 26px;border-radius:3px;font-family:${SANS};font-size:12px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;text-decoration:none;${
                        b.dark
                          ? `background-color:${C.ink};color:${C.cream};border:1px solid ${C.ink};`
                          : `background-color:#ffffff;color:${C.ink};border:1px solid ${C.gold};`
                      }">${esc(b.label)}</a>
                    </td>`,
    )
    .join('');
  return `            <tr>
              <td align="center" style="padding:28px 22px 8px;">
                <table role="presentation" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table>
              </td>
            </tr>`;
}

function note(html: string): string {
  return `            <tr>
              <td style="padding:14px 32px 30px;text-align:center;font-family:${SANS};font-size:13px;line-height:20px;color:${C.muted};">${html}</td>
            </tr>`;
}

function itemsText(o: OrderForMessage): string[] {
  return o.items.map((i) => `${i.quantity} × ${i.productName}${shadeOf(i.variantName) ? ` — ${i.variantName}` : ''}  ${money(i.lineTotalCents, o.currency)}`);
}

/* ---------- the customer's receipt ---------- */

export function customerOrderEmail(o: OrderForMessage, links: Links): Mail {
  const subject = `Your Revelle order ${o.orderNumber} is confirmed`;
  const ordersUrl = `${links.site}/account/orders`;
  const chat = links.storeWhatsapp
    ? waLink(links.storeWhatsapp, `Hi Revelle Beauty, a question about my order ${o.orderNumber}.`)
    : null;

  const html = layout({
    title: subject,
    preheader: `Thank you, ${firstName(o.customerName)} — ${itemCount(o)} item(s), ${money(o.totalCents, o.currency)}. We'll email you when it ships.`,
    links,
    footerNote: `You're receiving this because you placed order ${esc(o.orderNumber)} at Revelle Beauty.`,
    body: [
      hero('Order confirmed', `Thank you, ${firstName(o.customerName)}`,
        "Your payment went through and your order is in good hands. We'll pack it with care and email you as soon as it ships."),
      tracker('payment_received'),
      metaRow(o, ['Total', esc(money(o.totalCents, o.currency))]),
      itemsTable(o, { totals: true }),
      panels(
        ['Shipping to', addressLines(o).map(esc).join('<br />')],
        ['Payment', `Paid by card<br /><span style="color:${C.muted};font-size:13px;">Confirmation sent to ${esc(o.email)}</span>`],
      ),
      buttons([
        { href: ordersUrl, label: 'View your order', dark: true },
        ...(chat ? [{ href: chat, label: 'WhatsApp us' }] : []),
      ]),
      note(`Questions? Just reply to this email${chat ? ' or message us on WhatsApp' : ''} and quote <strong style="color:${C.ink};">${esc(o.orderNumber)}</strong>.`),
    ].join('\n'),
  });

  const text = [
    `Thank you, ${firstName(o.customerName)}.`,
    '',
    `Your order ${o.orderNumber} is confirmed and paid.`,
    "We'll pack it with care and email you as soon as it ships.",
    '',
    ...itemsText(o),
    '',
    `Subtotal    ${money(o.subtotalCents, o.currency)}`,
    `Shipping    ${o.shippingCents === 0 ? 'Complimentary' : money(o.shippingCents, o.currency)}`,
    `Total paid  ${money(o.totalCents, o.currency)}`,
    '',
    'Shipping to',
    ...addressLines(o),
    '',
    `Your orders: ${ordersUrl}`,
    ...(chat ? [`WhatsApp us: ${chat}`] : []),
    '',
    'Be you. Be bold. Be Revelle.',
  ].join('\n');

  return { to: o.email, subject, html, text, inline: inlineImages(o, links) };
}

/* ---------- the customer's status updates ---------- */

const STATUS_COPY: Record<StatusStage, {
  subject: (n: string) => string; eyebrow: string; title: string; intro: (first: string) => string;
}> = {
  packaged: {
    subject: (n) => `Your Revelle order ${n} is packed`,
    eyebrow: 'Packed with care',
    title: 'Your order is packed',
    intro: (f) => `Good news, ${f} — your shades are wrapped up and ready to go. We'll email you again the moment it ships.`,
  },
  shipped: {
    subject: (n) => `Your Revelle order ${n} is on its way`,
    eyebrow: 'On its way',
    title: 'Your order has shipped',
    intro: (f) => `It's on the move, ${f}! Follow it with the tracking details below, and confirm delivery from your account when it arrives.`,
  },
  delivered: {
    subject: (n) => `Your Revelle order ${n} was delivered`,
    eyebrow: 'Delivered',
    title: 'Enjoy your new shades',
    intro: (f) => `Your order has arrived, ${f}. We hope you love every shade — thank you for choosing Revelle.`,
  },
};

export function customerStatusEmail(
  o: OrderForMessage,
  stage: StatusStage,
  links: Links,
  storeNote: string | null = null,
): Mail {
  const copy = STATUS_COPY[stage];
  const subject = copy.subject(o.orderNumber);
  const ordersUrl = `${links.site}/account/orders`;
  const first = firstName(o.customerName);
  const tracking = stage === 'shipped' && Boolean(o.trackingNumber || o.trackingUrl);
  const trackUrl = tracking ? o.trackingUrl : null;

  const trackingBlock = tracking
    ? `            <tr>
              <td style="padding:22px 32px 0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.gold};border-radius:4px;">
                  <tr><td style="padding:16px 18px;">
                    <p style="margin:0;font-family:${SANS};font-size:10px;letter-spacing:2px;text-transform:uppercase;color:${C.muted};">Tracking number</p>
                    <p style="margin:6px 0 0;font-family:${SANS};font-size:17px;font-weight:bold;letter-spacing:1px;color:${C.ink};">${esc(o.trackingNumber ?? 'Use the tracking link below')}</p>
                  </td></tr>
                </table>
              </td>
            </tr>`
    : '';

  const html = layout({
    title: subject,
    preheader: `${copy.title} — order ${o.orderNumber}.`,
    links,
    footerNote: `You're receiving this update about order ${esc(o.orderNumber)} at Revelle Beauty.`,
    body: [
      hero(copy.eyebrow, copy.title, esc(copy.intro(first))),
      tracker(stage),
      metaRow(o, ['Items', String(itemCount(o))]),
      trackingBlock,
      storeNote ? panels(['A note from us', esc(storeNote).replace(/\n/g, '<br />')]) : '',
      itemsTable(o, { totals: false }),
      stage === 'delivered' ? '' : panels(['Shipping to', addressLines(o).map(esc).join('<br />')]),
      buttons(
        stage === 'delivered'
          ? [
              { href: `${links.site}/shop`, label: 'Shop new shades', dark: true },
              { href: ordersUrl, label: 'Your orders' },
            ]
          : [
              ...(trackUrl ? [{ href: trackUrl, label: 'Track your package', dark: true }] : []),
              { href: ordersUrl, label: 'View your order', dark: !trackUrl },
            ],
      ),
      note(`Questions? Reply to this email and quote <strong style="color:${C.ink};">${esc(o.orderNumber)}</strong>.`),
    ].join('\n'),
  });

  const text = [
    `${copy.title}.`,
    '',
    copy.intro(first),
    '',
    `Order ${o.orderNumber}`,
    ...(tracking ? ['', `Tracking number: ${o.trackingNumber ?? '—'}`, ...(trackUrl ? [`Track it: ${trackUrl}`] : [])] : []),
    ...(storeNote ? ['', 'A note from us:', storeNote] : []),
    '',
    ...itemsText(o),
    '',
    `Your orders: ${ordersUrl}`,
    '',
    'Be you. Be bold. Be Revelle.',
  ].join('\n');

  return { to: o.email, subject, html, text, inline: inlineImages(o, links) };
}

/* ---------- the store's email ---------- */

export function storeOrderEmail(o: OrderForMessage, opts: { to: string; adminUrl: string; links: Links }): Mail {
  const phone = phoneDigits(o.phone);
  const subject = `New order ${o.orderNumber} · PAID ${money(o.totalCents, o.currency)} · ${o.customerName}`;
  const contact = [
    `<strong style="color:${C.ink};">${esc(o.customerName)}</strong>`,
    `<a href="mailto:${esc(o.email)}" style="color:${C.goldDeep};">${esc(o.email)}</a>`,
    o.phone ? esc(o.phone) : null,
  ].filter(Boolean).join('<br />');

  const html = layout({
    title: subject,
    preheader: `${o.customerName} paid ${money(o.totalCents, o.currency)} for ${itemCount(o)} item(s). Ready to pack.`,
    links: opts.links,
    footerNote: 'Sent to the Revelle Beauty store team for every new paid order.',
    body: [
      hero('New order · Paid', `${money(o.totalCents, o.currency)} from ${firstName(o.customerName)}`,
        `Placed ${esc(when(o.placedAt))} and <strong style="color:${C.ink};">paid online</strong>. Pack it, then mark it packaged in the admin and the customer is emailed automatically.`),
      metaRow(o, ['Items', String(itemCount(o))]),
      itemsTable(o, { totals: true }),
      panels(['Customer', contact], ['Ship to', addressLines(o).map(esc).join('<br />')]),
      buttons([
        { href: opts.adminUrl, label: 'Open order', dark: true },
        ...(phone
          ? [{ href: waLink(phone, `Hi ${firstName(o.customerName)}, thank you for your Revelle Beauty order ${o.orderNumber}!`), label: 'WhatsApp customer' }]
          : []),
      ]),
      note(`Reply to the customer at <a href="mailto:${esc(o.email)}?subject=${encodeURIComponent(`Your Revelle order ${o.orderNumber}`)}" style="color:${C.goldDeep};">${esc(o.email)}</a>.`),
    ].join('\n'),
  });

  const text = [
    `New order ${o.orderNumber}`,
    `Placed ${when(o.placedAt)} — PAID online, ready to pack and ship.`,
    '',
    ...itemsText(o),
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
    '',
    ...(phone ? [`WhatsApp the customer: ${waLink(phone)}`] : []),
    `Open the order: ${opts.adminUrl}`,
  ].join('\n');

  return { to: opts.to, subject, html, text, inline: inlineImages(o, opts.links) };
}

/* ---------- the store's WhatsApp ---------- */

export function storeOrderWhatsApp(o: OrderForMessage, opts: { adminUrl: string }): string {
  const phone = phoneDigits(o.phone);
  return [
    `*New order ${o.orderNumber}* ✅ PAID`,
    `${money(o.totalCents, o.currency)} · paid online, ready to ship`,
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
    '',
    ...(phone ? [`Chat: ${waLink(phone)}`] : []),
    `Order: ${opts.adminUrl}`,
  ].join('\n');
}
