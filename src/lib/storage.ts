import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';
import { logger } from './logger.js';
import { UPLOADS_DIR } from './paths.js';

/**
 * Storage abstraction. Dev: local disk under backend/uploads, served at
 * /uploads by Express. Later: set STORAGE_DRIVER=supabase + credentials and
 * the same interface uploads to Supabase Storage — no call-site changes.
 */
export interface StorageDriver {
  /** Store the buffer at the given path, return the public URL. */
  put(storagePath: string, buf: Buffer, contentType: string): Promise<string>;
  /** Best-effort delete. Never throws. */
  remove(storagePath: string): Promise<void>;
  /** Public URL for a stored path. */
  publicUrl(storagePath: string): string;
}

export { UPLOADS_DIR };

class LocalDiskStorage implements StorageDriver {
  async put(storagePath: string, buf: Buffer): Promise<string> {
    const full = path.join(UPLOADS_DIR, storagePath);
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    await fs.promises.writeFile(full, buf);
    return this.publicUrl(storagePath);
  }

  async remove(storagePath: string): Promise<void> {
    try {
      await fs.promises.unlink(path.join(UPLOADS_DIR, storagePath));
    } catch (err) {
      logger.warn({ err, storagePath }, 'local storage remove failed (ignored)');
    }
  }

  publicUrl(storagePath: string): string {
    // Relative URL — the Vite proxy (dev) or same-host deploy makes it resolve.
    return `/uploads/${storagePath}`;
  }
}

class SupabaseStorage implements StorageDriver {
  private base: string;
  private key: string;
  private bucket: string;

  constructor() {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('STORAGE_DRIVER=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    }
    this.base = env.SUPABASE_URL.replace(/\/$/, '');
    this.key = env.SUPABASE_SERVICE_ROLE_KEY;
    this.bucket = env.SUPABASE_STORAGE_BUCKET;
  }

  async put(storagePath: string, buf: Buffer, contentType: string): Promise<string> {
    const res = await fetch(
      `${this.base}/storage/v1/object/${this.bucket}/${storagePath}`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.key}`,
          'content-type': contentType,
          'cache-control': 'max-age=31536000',
          'x-upsert': 'false',
        },
        body: new Uint8Array(buf),
      },
    );
    if (!res.ok) {
      throw new Error(`supabase storage upload failed: ${res.status} ${await res.text()}`);
    }
    return this.publicUrl(storagePath);
  }

  async remove(storagePath: string): Promise<void> {
    try {
      await fetch(`${this.base}/storage/v1/object/${this.bucket}/${storagePath}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${this.key}` },
      });
    } catch (err) {
      logger.warn({ err, storagePath }, 'supabase storage remove failed (ignored)');
    }
  }

  publicUrl(storagePath: string): string {
    return `${this.base}/storage/v1/object/public/${this.bucket}/${storagePath}`;
  }
}

export const storage: StorageDriver =
  env.STORAGE_DRIVER === 'supabase' ? new SupabaseStorage() : new LocalDiskStorage();
