import type { Money } from './common';
import type { CartItemInput } from './cart';

export type OrderStatus =
  | 'pending'
  | 'paid'
  | 'fulfilled'
  | 'cancelled'
  | 'refunded'
  | 'expired'
  | 'needs_review'
  /** Placed without online payment; the store arranges payment directly. */
  | 'preorder';

export type PaymentStatus = 'unpaid' | 'paid' | 'refunded' | 'partially_refunded';

export interface CreateCheckoutSessionBody {
  items: CartItemInput[];
  /** Collected on our checkout page; email comes from the login session. */
  shipping: import('./customer').ShippingInput;
  saveAsDefault?: boolean;
}

export interface PreorderBody {
  items: CartItemInput[];
  shipping: import('./customer').ShippingInput;
  saveAsDefault?: boolean;
  /** Anything the customer wants the store to know. Max 500 characters. */
  note?: string | null;
}

export interface PreorderResponse {
  /** Pass to the confirmation page as ?session_id=. */
  reference: string;
  orderId: string;
  orderNumber: string;
  totals: {
    subtotalCents: Money;
    shippingCents: Money;
    totalCents: Money;
    currency: string;
  };
}

export interface CreateCheckoutSessionResponse {
  checkoutUrl: string;
  sessionId: string;
  orderId: string;
  orderNumber: string;
  totals: {
    subtotalCents: Money;
    shippingCents: Money;
    totalCents: Money;
    currency: string;
  };
}

export interface OrderConfirmationItem {
  productName: string;
  productSlug: string;
  variantName: string;
  variantHex: string | null;
  quantity: number;
  unitPriceCents: Money;
  lineTotalCents: Money;
  imageUrl: string | null;
}

export interface OrderConfirmation {
  orderNumber: string;
  email: string | null;
  placedAt: string;
  currency: string;
  subtotalCents: Money;
  shippingCents: Money;
  taxCents: Money;
  totalCents: Money;
  shipping: {
    name: string | null;
    line1: string | null;
    line2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    country: string | null;
  } | null;
  items: OrderConfirmationItem[];
}

export interface OrderConfirmationResponse {
  status: 'paid' | 'preorder' | 'processing' | 'expired' | 'failed';
  order: OrderConfirmation | null;
}
