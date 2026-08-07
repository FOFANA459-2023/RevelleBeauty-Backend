import type { Money } from './common';
import type { OrderConfirmationItem, OrderStatus } from './order';

export type FulfillmentStage =
  | 'awaiting_payment'
  | 'payment_received'
  | 'packaged'
  | 'shipped'
  | 'delivered';

export interface CustomerAddress {
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export type UserRole = 'customer' | 'admin';

export interface CustomerProfile {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  phone: string | null;
  address: CustomerAddress | null;
}

export interface RegisterBody {
  email: string;
  password: string;
  name: string;
  phone?: string;
}

export interface CustomerLoginBody {
  email: string;
  password: string;
}

export interface ProfilePatch {
  name?: string;
  phone?: string | null;
  address?: CustomerAddress | null;
}

export interface ShippingInput {
  name: string;
  phone: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface CustomerMessageDTO {
  id: string;
  orderId: string | null;
  kind: 'welcome' | 'order' | 'tracking';
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

export interface MessagesResponse {
  messages: CustomerMessageDTO[];
  unreadCount: number;
}

export interface OrderEventDTO {
  id: string;
  stage: FulfillmentStage | null;
  note: string | null;
  actor: 'admin' | 'customer' | 'system';
  createdAt: string;
}

export interface CustomerOrderSummaryDTO {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  fulfillmentStage: FulfillmentStage;
  totalCents: Money;
  currency: string;
  itemCount: number;
  trackingNumber: string | null;
  trackingUrl: string | null;
  thumbUrl: string | null;
  placedAt: string;
}

export interface CustomerOrderDetailDTO {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  fulfillmentStage: FulfillmentStage;
  placedAt: string;
  currency: string;
  subtotalCents: Money;
  shippingCents: Money;
  taxCents: Money;
  totalCents: Money;
  trackingNumber: string | null;
  trackingUrl: string | null;
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
  events: OrderEventDTO[];
}
