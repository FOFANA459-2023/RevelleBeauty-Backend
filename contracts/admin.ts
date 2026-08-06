import type { Money } from './common';
import type { ImageDTO, ProductStatus } from './product';
import type { OrderStatus, PaymentStatus } from './order';

/* ---------- Categories ---------- */

export interface AdminCategoryDTO {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string | null;
  displayOrder: number;
  isActive: boolean;
  productCount: number;
}

export interface CategoryUpsertInput {
  name: string;
  parentId?: string | null;
  slug?: string;
  description?: string | null;
  displayOrder?: number;
  isActive?: boolean;
}

/* ---------- Products / variants ---------- */

export interface VariantUpsertInput {
  name: string;
  hexColor?: string | null;
  hexColorSecondary?: string | null;
  finish?: string | null;
  sku?: string | null;
  priceCentsOverride?: Money | null;
  stockQuantity?: number;
  isAvailable?: boolean;
  isDefault?: boolean;
  displayOrder?: number;
}

export interface ProductUpsertInput {
  categoryId: string;
  name: string;
  slug?: string;
  tagline?: string | null;
  description?: string | null;
  ingredients?: string | null;
  howToUse?: string | null;
  basePriceCents: Money;
  compareAtPriceCents?: Money | null;
  sku?: string | null;
  status?: ProductStatus;
  trackInventory?: boolean;
  variantLabel?: string;
  isFeatured?: boolean;
  displayOrder?: number;
  metaTitle?: string | null;
  metaDescription?: string | null;
  variants?: VariantUpsertInput[];
}

export interface AdminVariantDTO {
  id: string;
  productId: string;
  name: string;
  slug: string;
  hexColor: string | null;
  hexColorSecondary: string | null;
  finish: string | null;
  sku: string | null;
  priceCentsOverride: Money | null;
  effectivePriceCents: Money;
  stockQuantity: number;
  isAvailable: boolean;
  isDefault: boolean;
  displayOrder: number;
  /** True if this variant appears on any order — UI must say Archive, not Delete. */
  hasOrders: boolean;
}

export interface AdminProductSummaryDTO {
  id: string;
  slug: string;
  name: string;
  categoryId: string;
  categoryName: string;
  status: ProductStatus;
  basePriceCents: Money;
  isFeatured: boolean;
  displayOrder: number;
  variantCount: number;
  totalStock: number;
  primaryImageUrl: string | null;
  updatedAt: string;
}

export interface AdminProductDetailDTO {
  id: string;
  categoryId: string;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  ingredients: string | null;
  howToUse: string | null;
  basePriceCents: Money;
  compareAtPriceCents: Money | null;
  sku: string | null;
  status: ProductStatus;
  trackInventory: boolean;
  variantLabel: string;
  isFeatured: boolean;
  displayOrder: number;
  metaTitle: string | null;
  metaDescription: string | null;
  variants: AdminVariantDTO[];
  images: ImageDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface ReorderInput {
  items: { id: string; displayOrder: number }[];
}

export interface StockUpdateInput {
  stockQuantity?: number;
  isAvailable?: boolean;
  note?: string;
}

/* ---------- Orders ---------- */

export interface AdminOrderSummaryDTO {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  email: string | null;
  customerName: string | null;
  totalCents: Money;
  currency: string;
  itemCount: number;
  oversold: boolean;
  createdAt: string;
  paidAt: string | null;
}

export interface AdminOrderItemDTO {
  id: string;
  productId: string | null;
  variantId: string | null;
  productName: string;
  variantName: string;
  variantHex: string | null;
  sku: string | null;
  unitPriceCents: Money;
  quantity: number;
  lineTotalCents: Money;
  imageUrl: string | null;
}

export interface AdminOrderDetailDTO extends AdminOrderSummaryDTO {
  fulfillmentStage: import('./customer').FulfillmentStage;
  events: import('./customer').OrderEventDTO[];
  phone: string | null;
  shippingName: string | null;
  shippingLine1: string | null;
  shippingLine2: string | null;
  shippingCity: string | null;
  shippingState: string | null;
  shippingPostalCode: string | null;
  shippingCountry: string | null;
  subtotalCents: Money;
  shippingCents: Money;
  taxCents: Money;
  discountCents: Money;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  adminNotes: string | null;
  items: AdminOrderItemDTO[];
  fulfilledAt: string | null;
}

export interface OrderUpdateInput {
  status?: OrderStatus;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  adminNotes?: string | null;
}

export interface AdminStatsDTO {
  ordersToday: number;
  revenue30dCents: Money;
  pendingFulfillment: number;
  oversoldCount: number;
  lowStock: {
    variantId: string;
    productName: string;
    variantName: string;
    stock: number;
  }[];
}
