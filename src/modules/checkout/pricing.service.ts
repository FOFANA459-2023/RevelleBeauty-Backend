import type { Pool } from 'pg';
import type { CartItemInput, CartIssue, CartLineValidated, CartValidateResponse } from '@contracts/index';
import { storage } from '../../lib/storage.js';
import { env } from '../../config/env.js';

/**
 * The price-authority boundary. Client sends { variantId, quantity } and
 * NOTHING else; everything money-related is read from the database here.
 * Shared by cart validation and checkout so there is exactly one pricing path.
 */

export interface PricedLine extends CartLineValidated {
  quantity: number;
  stockQuantity: number;
  trackInventory: boolean;
}

interface PriceRow {
  variant_id: string;
  product_id: string;
  product_slug: string;
  product_name: string;
  product_status: string;
  track_inventory: boolean;
  base_price_cents: number;
  variant_name: string;
  variant_slug: string;
  hex_color: string | null;
  hex_color_secondary: string | null;
  sku: string | null;
  price_cents_override: number | null;
  stock_quantity: number;
  is_available: boolean;
  image_path: string | null;
}

export async function priceCart(
  pool: Pool,
  items: CartItemInput[],
): Promise<{ lines: PricedLine[]; removed: string[]; issues: CartIssue[] }> {
  const ids = items.map((i) => i.variantId);
  const { rows } = await pool.query<PriceRow>(
    `select v.id as variant_id, p.id as product_id, p.slug as product_slug,
            p.name as product_name, p.status::text as product_status,
            p.track_inventory, p.base_price_cents,
            v.name as variant_name, v.slug as variant_slug,
            v.hex_color, v.hex_color_secondary, v.sku,
            v.price_cents_override, v.stock_quantity, v.is_available,
            (select i.storage_path from product_images i
              where i.product_id = p.id
              order by (i.variant_id = v.id) desc nulls last, i.is_primary desc, i.display_order
              limit 1) as image_path
       from product_variants v
       join products p on p.id = v.product_id
      where v.id = any($1::uuid[])`,
    [ids],
  );

  const byId = new Map(rows.map((r) => [r.variant_id, r]));
  const lines: PricedLine[] = [];
  const removed: string[] = [];
  const issues: CartIssue[] = [];

  for (const item of items) {
    const r = byId.get(item.variantId);
    if (!r || r.product_status !== 'active') {
      removed.push(item.variantId);
      issues.push({ variantId: item.variantId, reason: 'not_found' });
      continue;
    }
    const unitPriceCents = r.price_cents_override ?? r.base_price_cents;
    const available = r.is_available && (!r.track_inventory || r.stock_quantity > 0);

    if (!available) {
      issues.push({ variantId: item.variantId, reason: 'unavailable' });
    } else if (r.track_inventory && item.quantity > r.stock_quantity) {
      issues.push({
        variantId: item.variantId,
        reason: 'insufficient_stock',
        available: r.stock_quantity,
      });
    }

    lines.push({
      variantId: r.variant_id,
      productId: r.product_id,
      productSlug: r.product_slug,
      productName: r.product_name,
      variantName: r.variant_name,
      variantSlug: r.variant_slug,
      hexColor: r.hex_color,
      hexColorSecondary: r.hex_color_secondary,
      unitPriceCents,
      available,
      maxQuantity: r.track_inventory
        ? Math.min(r.stock_quantity, env.MAX_QTY_PER_LINE)
        : env.MAX_QTY_PER_LINE,
      imageUrl: r.image_path ? storage.publicUrl(r.image_path) : null,
      quantity: Math.min(item.quantity, env.MAX_QTY_PER_LINE),
      stockQuantity: r.stock_quantity,
      trackInventory: r.track_inventory,
    });
  }

  return { lines, removed, issues };
}

export async function validateCart(
  pool: Pool,
  items: CartItemInput[],
): Promise<CartValidateResponse> {
  const { lines, removed } = await priceCart(pool, items);
  return {
    lines: lines.map(({ quantity: _q, stockQuantity: _s, trackInventory: _t, ...rest }) => rest),
    removed,
  };
}
