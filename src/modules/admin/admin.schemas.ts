import { z } from 'zod';

export const hexSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .transform((s) => s.toLowerCase());

export const variantUpsertSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    hexColor: hexSchema.nullish(),
    hexColorSecondary: hexSchema.nullish(),
    finish: z.string().trim().max(40).nullish(),
    sku: z.string().trim().max(60).nullish(),
    priceCentsOverride: z.number().int().min(0).nullish(),
    stockQuantity: z.number().int().min(0).optional(),
    isAvailable: z.boolean().optional(),
    isDefault: z.boolean().optional(),
    displayOrder: z.number().int().optional(),
  })
  .strict();

export const productUpsertSchema = z
  .object({
    categoryId: z.string().uuid(),
    name: z.string().trim().min(1).max(140),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
    tagline: z.string().trim().max(200).nullish(),
    description: z.string().max(5000).nullish(),
    ingredients: z.string().max(5000).nullish(),
    howToUse: z.string().max(5000).nullish(),
    basePriceCents: z.number().int().min(0),
    compareAtPriceCents: z.number().int().min(0).nullish(),
    sku: z.string().trim().max(60).nullish(),
    status: z.enum(['draft', 'active', 'archived']).optional(),
    trackInventory: z.boolean().optional(),
    variantLabel: z.string().trim().max(30).optional(),
    isFeatured: z.boolean().optional(),
    displayOrder: z.number().int().optional(),
    metaTitle: z.string().trim().max(120).nullish(),
    metaDescription: z.string().trim().max(200).nullish(),
    variants: z.array(variantUpsertSchema).max(50).optional(),
  })
  .strict();

export const productPatchSchema = productUpsertSchema.partial().strict();

export const categoryUpsertSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    parentId: z.string().uuid().nullish(),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
    description: z.string().max(2000).nullish(),
    displayOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const reorderSchema = z
  .object({
    items: z.array(z.object({ id: z.string().uuid(), displayOrder: z.number().int() }).strict()).min(1).max(200),
  })
  .strict();

export const stockUpdateSchema = z
  .object({
    stockQuantity: z.number().int().min(0).optional(),
    isAvailable: z.boolean().optional(),
    note: z.string().max(500).optional(),
  })
  .strict();

export const orderUpdateSchema = z
  .object({
    status: z.enum(['pending', 'paid', 'fulfilled', 'cancelled', 'refunded', 'expired', 'needs_review']).optional(),
    trackingNumber: z.string().trim().max(100).nullish(),
    trackingUrl: z.string().url().max(500).nullish(),
    adminNotes: z.string().max(5000).nullish(),
  })
  .strict();

export const imagePatchSchema = z
  .object({
    altText: z.string().trim().max(300).nullish(),
    isPrimary: z.boolean().optional(),
    variantId: z.string().uuid().nullish(),
    displayOrder: z.number().int().optional(),
  })
  .strict();

export const adminListQuerySchema = z.object({
  status: z.enum(['draft', 'active', 'archived']).optional(),
  category: z.string().optional(),
  q: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const orderListQuerySchema = z.object({
  status: z.enum(['pending', 'paid', 'fulfilled', 'cancelled', 'refunded', 'expired', 'needs_review']).optional(),
  q: z.string().max(120).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
