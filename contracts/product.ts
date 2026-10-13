import type { Money } from './common';

export type ProductStatus = 'draft' | 'active' | 'archived';

export interface ImageDTO {
  id: string;
  url: string;
  altText: string | null;
  width: number | null;
  height: number | null;
  isPrimary: boolean;
  variantId: string | null;
  displayOrder: number;
}

export interface VariantDTO {
  id: string;
  name: string;
  slug: string;
  /** Maker shade code from the line sheet ("HS01"), shown beside the name. */
  shadeCode: string | null;
  /** Lowercase #rrggbb, or null for non-shade variants (scrubs, skincare). */
  hexColor: string | null;
  /** Second hex for duochrome / glitter shades — render as a gradient swatch. */
  hexColorSecondary: string | null;
  finish: string | null;
  /** Resolved: COALESCE(variant override, product base). */
  priceCents: Money;
  /** stock_quantity is NEVER exposed publicly — boolean only. */
  inStock: boolean;
  isDefault: boolean;
  displayOrder: number;
  imageId: string | null;
}

export interface SwatchDTO {
  id: string;
  name: string;
  slug: string;
  shadeCode: string | null;
  hexColor: string | null;
  hexColorSecondary: string | null;
  /**
   * Every photograph of this shade, in gallery order — a card walks through
   * them while the pointer rests on the bead. Capped; the product page is
   * where the full set lives.
   */
  imageUrls: string[];
}

export interface ProductSummaryDTO {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  categoryId: string;
  categorySlug: string;
  priceCents: Money;
  priceMaxCents: Money;
  compareAtPriceCents: Money | null;
  isFeatured: boolean;
  inStock: boolean;
  primaryImage: ImageDTO | null;
  /**
   * The product's opening photographs, in gallery order — a card turns through
   * them while the pointer is on the image. Capped; `primaryImage` is [0].
   */
  previewImageUrls: string[];
  swatches: SwatchDTO[];
}

export interface ProductDetailDTO extends ProductSummaryDTO {
  description: string | null;
  ingredients: string | null;
  howToUse: string | null;
  /** 'Shade' | 'Size' | 'Type' — label above the variant picker. */
  variantLabel: string;
  variants: VariantDTO[];
  images: ImageDTO[];
  meta: { title: string | null; description: string | null };
}

export interface CategoryDTO {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  urlPath: string;
  displayOrder: number;
  productCount: number;
  children: CategoryDTO[];
}

export interface StoreSettingsDTO {
  currency: string;
  flatShippingCents: Money;
  freeShippingThresholdCents: Money | null;
  announcement: string | null;
  checkoutEnabled: boolean;
  allowedShippingCountries: string[];
}

export type ProductSort = 'featured' | 'newest' | 'price_asc' | 'price_desc' | 'name';

export interface ProductListQuery {
  category?: string;
  featured?: boolean;
  q?: string;
  sort?: ProductSort;
  limit?: number;
  offset?: number;
}

export interface ProductListResponse {
  products: ProductSummaryDTO[];
  total: number;
  limit: number;
  offset: number;
}
