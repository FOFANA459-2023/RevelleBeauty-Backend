import type { Pool } from 'pg';
import type { ProductSummaryDTO } from '@contracts/index';
import { notFound } from '../../lib/errors.js';

/**
 * Content-based product recommendations with a collaborative boost.
 *
 * For a small catalog the right design is transparent, explainable scoring
 * over real signals rather than a black box. Signals, weighted:
 *
 *   1. Category kinship      (0–30)  same subcategory > same root > none
 *   2. Palette similarity    (0–25)  perceptual distance between SHADE HEXES —
 *                                    the color story is the brand's spine, so
 *                                    "has shades near yours" is the strongest
 *                                    content signal after category
 *   3. Price proximity       (0–15)  shoppers browse within a budget band
 *   4. Finish overlap        (0–10)  matte people buy matte; gloss begets gloss
 *   5. Text affinity         (0–10)  shared meaningful tokens in name/tagline
 *   6. Co-purchase           (0–25)  bought together in real orders (grows
 *                                    stronger as order history accumulates)
 *   7. Featured nudge        (0–2)   gentle merchandising thumb on the scale
 *   8. Out-of-stock penalty  (−20)   never lead with something unbuyable
 *
 * Total possible ≈ 117. Ties broken by display_order for determinism.
 */

interface ScoredCandidate {
  productId: string;
  score: number;
  reasons: string[];
}

interface CandidateRow {
  id: string;
  category_id: string;
  parent_category_id: string | null;
  base_price_cents: number;
  is_featured: boolean;
  in_stock: boolean;
  display_order: number;
  name: string;
  tagline: string | null;
  hexes: string[] | null;
  finishes: string[] | null;
}

/* ---------- color math ---------- */

/**
 * "Redmean" perceptual RGB distance — a well-known cheap approximation of
 * CIE deltaE that respects human sensitivity per channel. Range ~0–765.
 * Good enough to say "Rose Elixir is near Velvet Mauve" without a color lib.
 */
export function colorDistance(hexA: string, hexB: string): number {
  const a = parseInt(hexA.slice(1), 16);
  const b = parseInt(hexB.slice(1), 16);
  const rA = (a >> 16) & 255, gA = (a >> 8) & 255, bA = a & 255;
  const rB = (b >> 16) & 255, gB = (b >> 8) & 255, bB = b & 255;
  const rMean = (rA + rB) / 2;
  const dR = rA - rB, dG = gA - gB, dB = bA - bB;
  return Math.sqrt(
    (2 + rMean / 256) * dR * dR + 4 * dG * dG + (2 + (255 - rMean) / 256) * dB * dB,
  );
}

/**
 * Palette similarity between two shade sets: average of each set's best match
 * into the other (symmetric chamfer distance), mapped to 0..1.
 */
export function paletteSimilarity(hexesA: string[], hexesB: string[]): number {
  if (hexesA.length === 0 || hexesB.length === 0) return 0;
  const best = (from: string[], to: string[]) =>
    from.reduce((sum, h) => sum + Math.min(...to.map((o) => colorDistance(h, o))), 0) /
    from.length;
  const chamfer = (best(hexesA, hexesB) + best(hexesB, hexesA)) / 2;
  // 0 distance -> 1.0; ~180+ (clearly different color family) -> 0.
  return Math.max(0, 1 - chamfer / 180);
}

/* ---------- text ---------- */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'with', 'of', 'for', 'in', 'on', 'to', 'your',
  'lip', 'lips', // every lip product shares these; they carry no signal
]);

function tokens(...texts: (string | null)[]): Set<string> {
  const out = new Set<string>();
  for (const t of texts) {
    if (!t) continue;
    for (const w of t.toLowerCase().split(/[^a-z0-9]+/)) {
      if (w.length > 2 && !STOPWORDS.has(w)) out.add(w);
    }
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/* ---------- the scorer ---------- */

export async function getRelatedProductIds(
  pool: Pool,
  slug: string,
  limit: number,
): Promise<ScoredCandidate[]> {
  // ONE round trip: candidates + source marker + per-candidate co-purchase
  // count against the source product, all in a single statement (the DB is
  // remote — sequential queries cost real latency).
  const { rows } = await pool.query<CandidateRow & { is_source: boolean; co_orders: string }>(`
    with src as (select id from products where slug = $1 and status = 'active')
    select p.id, p.category_id, c.parent_id as parent_category_id,
           p.base_price_cents, p.is_featured, p.display_order, p.name, p.tagline,
           (p.id = (select id from src)) as is_source,
           exists (
             select 1 from product_variants v
              where v.product_id = p.id and v.is_available
                and (not p.track_inventory or v.stock_quantity > 0)
           ) as in_stock,
           (select array_agg(v.hex_color) from product_variants v
             where v.product_id = p.id and v.hex_color is not null) as hexes,
           (select array_agg(distinct v.finish) from product_variants v
             where v.product_id = p.id and v.finish is not null) as finishes,
           (select count(distinct oi1.order_id)
              from order_items oi1
              join order_items oi2 on oi2.order_id = oi1.order_id
              join orders o on o.id = oi1.order_id
             where oi1.product_id = (select id from src)
               and oi2.product_id = p.id
               and o.payment_status = 'paid'
           ) as co_orders
      from products p
      join categories c on c.id = p.category_id
     where p.status = 'active'
  `, [slug]);

  const src = rows.find((r) => r.is_source);
  if (!src) throw notFound('Product not found');
  const sourceId = src.id;
  const coPurchase = new Map(rows.map((r) => [r.id, Number(r.co_orders)]));

  const srcTokens = tokens(src.name, src.tagline);
  const srcHexes = src.hexes ?? [];
  const srcFinishes = new Set(src.finishes ?? []);

  const scored: ScoredCandidate[] = rows
    .filter((r) => r.id !== sourceId)
    .map((cand) => {
      let score = 0;
      const reasons: string[] = [];

      // 1. category kinship
      if (cand.category_id === src.category_id) {
        score += 30;
        reasons.push('same collection');
      } else if (
        cand.parent_category_id != null &&
        cand.parent_category_id === src.parent_category_id
      ) {
        score += 18;
        reasons.push('same category');
      }

      // 2. palette similarity — the brand's defining signal
      const pal = paletteSimilarity(srcHexes, cand.hexes ?? []);
      if (pal > 0) {
        score += 25 * pal;
        if (pal > 0.55) reasons.push('similar shades');
      }

      // 3. price proximity
      const maxPrice = Math.max(src.base_price_cents, cand.base_price_cents, 1);
      const priceCloseness = 1 - Math.min(
        Math.abs(src.base_price_cents - cand.base_price_cents) / maxPrice, 1,
      );
      score += 15 * priceCloseness;

      // 4. finish overlap
      const candFinishes = new Set(cand.finishes ?? []);
      if (srcFinishes.size && candFinishes.size) {
        let inter = 0;
        for (const f of srcFinishes) if (candFinishes.has(f)) inter++;
        const j = inter / (srcFinishes.size + candFinishes.size - inter);
        score += 10 * j;
        if (j >= 0.5) reasons.push('same finish');
      }

      // 5. text affinity
      score += 10 * jaccard(srcTokens, tokens(cand.name, cand.tagline));

      // 6. co-purchase (capped at 3 shared orders for full credit)
      const co = coPurchase.get(cand.id) ?? 0;
      if (co > 0) {
        score += 25 * Math.min(co / 3, 1);
        reasons.push('often bought together');
      }

      // 7. merchandising nudge
      if (cand.is_featured) score += 2;

      // 8. never lead with the unbuyable
      if (!cand.in_stock) score -= 20;

      return { productId: cand.id, score, reasons, displayOrder: cand.display_order };
    })
    .sort((a, b) => b.score - a.score || a.displayOrder - b.displayOrder)
    .slice(0, limit)
    .map(({ productId, score, reasons }) => ({
      productId,
      score: Math.round(score * 10) / 10,
      reasons,
    }));

  return scored;
}

export type { ScoredCandidate };
export type RelatedResult = { products: ProductSummaryDTO[]; scores: ScoredCandidate[] };
