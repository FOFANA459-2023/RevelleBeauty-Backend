/** Shared API contract — type-only. No runtime values may live in contracts/. */

/** Integer cents. Never a float, never a string. */
export type Money = number;

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
