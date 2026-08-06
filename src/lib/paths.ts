import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolve runtime directories against the PACKAGE ROOT, not the module.
 *
 * Why: relative hops like '../../migrations' silently change meaning once the
 * code is compiled. From src/db/ that lands on backend/migrations; from
 * dist/src/db/ it lands on dist/migrations, which does not exist — so the
 * server crashes at boot in production while working fine under tsx.
 * Walking up to the directory that owns package.json is layout-independent.
 */
function findPackageRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Last resort: the process working directory.
  return process.cwd();
}

export const PACKAGE_ROOT = findPackageRoot(path.dirname(fileURLToPath(import.meta.url)));

export const MIGRATIONS_DIR = path.join(PACKAGE_ROOT, 'migrations');
export const UPLOADS_DIR = path.join(PACKAGE_ROOT, 'uploads');
