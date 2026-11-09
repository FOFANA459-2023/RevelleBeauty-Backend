/** Average and count of a product's published reviews. */
export interface RatingSummaryDTO {
  /** 1–5, one decimal. */
  average: number;
  count: number;
}

export interface ReviewDTO {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  /** First name and last initial ("Amara J."); never the full name or email. */
  author: string;
  /** The author has a paid order containing this product. Worked out, not claimed. */
  verifiedPurchase: boolean;
  createdAt: string;
  /** Present on the homepage feed, where reviews of many products mix. */
  product?: { slug: string; name: string };
}

export interface ProductReviewsResponse {
  /** Null until the first review. */
  summary: (RatingSummaryDTO & {
    /** Count of reviews per star, index 0 = one star … index 4 = five stars. */
    distribution: [number, number, number, number, number];
  }) | null;
  reviews: ReviewDTO[];
  total: number;
}

/** The signed-in customer's own review of a product, for editing. */
export interface MyReviewDTO {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  status: 'published' | 'hidden';
}

export interface ReviewInput {
  rating: number;
  title?: string | null;
  body: string;
}

export interface AdminReviewDTO extends ReviewDTO {
  status: 'published' | 'hidden';
  customerEmail: string;
  product: { slug: string; name: string };
}
