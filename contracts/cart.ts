import type { Money } from './common';

/** The ONLY thing the client ever sends about a cart line. No prices. */
export interface CartItemInput {
  variantId: string;
  quantity: number;
}

export type CartIssueReason =
  | 'not_found'
  | 'unavailable'
  | 'insufficient_stock'
  | 'price_changed';

export interface CartIssue {
  variantId: string;
  reason: CartIssueReason;
  available?: number;
  currentPriceCents?: Money;
}

/** Authoritative server truth for one cart line, used to reconcile the client cart. */
export interface CartLineValidated {
  variantId: string;
  productId: string;
  productSlug: string;
  productName: string;
  variantName: string;
  variantSlug: string;
  hexColor: string | null;
  hexColorSecondary: string | null;
  unitPriceCents: Money;
  available: boolean;
  maxQuantity: number;
  imageUrl: string | null;
}

export interface CartValidateResponse {
  lines: CartLineValidated[];
  /** variantIds sent by the client that no longer exist / are archived. */
  removed: string[];
}
