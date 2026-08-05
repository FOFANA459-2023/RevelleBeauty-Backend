import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import crypto from 'node:crypto';
import type { Pool } from 'pg';
import { env } from '../../config/env.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { storage } from '../../lib/storage.js';
import { uploadLimiter } from '../../middleware/rateLimit.js';
import { imagePatchSchema } from './admin.schemas.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1 },
});

/** Sniff magic bytes — never trust the client's Content-Type. */
function sniffImage(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  // AVIF/HEIF: ftyp box
  if (buf.subarray(4, 8).toString('ascii') === 'ftyp') return 'image/avif';
  return null;
}

export function adminImageRoutes(pool: Pool): Router {
  const r = Router();

  r.post('/products/:id/images', uploadLimiter, upload.single('file'), async (req, res) => {
    const productId = req.params.id;
    const file = req.file;
    if (!file) throw badRequest('No file uploaded');
    if (!sniffImage(file.buffer)) throw badRequest('File is not a supported image (jpeg/png/webp/avif)');

    const { rows: productRows } = await pool.query(`select id from products where id = $1`, [productId]);
    if (!productRows[0]) throw notFound('Product not found');

    const variantId = typeof req.body.variantId === 'string' && req.body.variantId ? req.body.variantId : null;
    const altText = typeof req.body.altText === 'string' && req.body.altText ? req.body.altText : null;
    const isPrimary = req.body.isPrimary === 'true' || req.body.isPrimary === true;

    // Normalize: rotate per EXIF (then strip EXIF incl. GPS), cap width, webp.
    const pipeline = sharp(file.buffer).rotate().resize({ width: 1600, withoutEnlargement: true });
    const buf = await pipeline.webp({ quality: 82 }).toBuffer();
    const meta = await sharp(buf).metadata();

    const imageId = crypto.randomUUID();
    const storagePath = `products/${productId}/${imageId}.webp`;
    const url = await storage.put(storagePath, buf, 'image/webp');

    try {
      if (isPrimary) {
        await pool.query(`update product_images set is_primary = false where product_id = $1`, [productId]);
      }
      const { rows: existing } = await pool.query<{ count: string }>(
        `select count(*) from product_images where product_id = $1`, [productId],
      );
      const makePrimary = isPrimary || Number(existing[0]!.count) === 0;

      const { rows } = await pool.query(
        `insert into product_images
           (id, product_id, variant_id, storage_path, alt_text, width, height, is_primary, display_order)
         values ($1,$2,$3,$4,$5,$6,$7,$8,
                 coalesce((select max(display_order) + 1 from product_images where product_id = $2), 1))
         returning *`,
        [imageId, productId, variantId, storagePath, altText, meta.width ?? null, meta.height ?? null, makePrimary],
      );
      const img = rows[0]!;
      res.status(201).json({
        image: {
          id: img.id,
          url,
          altText: img.alt_text,
          width: img.width,
          height: img.height,
          isPrimary: img.is_primary,
          variantId: img.variant_id,
          displayOrder: img.display_order,
        },
      });
    } catch (err) {
      // Compensate: DB failed, remove the just-uploaded object.
      await storage.remove(storagePath);
      throw err;
    }
  });

  r.patch('/images/:id', async (req, res) => {
    const patch = imagePatchSchema.parse(req.body);
    const { rows } = await pool.query(`select * from product_images where id = $1`, [req.params.id]);
    const img = rows[0];
    if (!img) throw notFound('Image not found');

    if (patch.isPrimary === true) {
      await pool.query(`update product_images set is_primary = false where product_id = $1`, [img.product_id]);
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (col: string, val: unknown) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };
    if (patch.altText !== undefined) push('alt_text', patch.altText);
    if (patch.isPrimary !== undefined) push('is_primary', patch.isPrimary);
    if (patch.variantId !== undefined) push('variant_id', patch.variantId);
    if (patch.displayOrder !== undefined) push('display_order', patch.displayOrder);

    if (sets.length) {
      params.push(req.params.id);
      await pool.query(`update product_images set ${sets.join(', ')} where id = $${params.length}`, params);
    }
    const { rows: after } = await pool.query(`select * from product_images where id = $1`, [req.params.id]);
    const a = after[0]!;
    res.json({
      image: {
        id: a.id,
        url: storage.publicUrl(a.storage_path),
        altText: a.alt_text,
        width: a.width,
        height: a.height,
        isPrimary: a.is_primary,
        variantId: a.variant_id,
        displayOrder: a.display_order,
      },
    });
  });

  r.delete('/images/:id', async (req, res) => {
    // Row first, then best-effort object removal — an orphaned object costs
    // nothing; an orphaned row renders a broken image.
    const { rows } = await pool.query(
      `delete from product_images where id = $1 returning storage_path`,
      [req.params.id],
    );
    if (!rows[0]) throw notFound('Image not found');
    await storage.remove(rows[0].storage_path);
    res.status(204).end();
  });

  return r;
}
