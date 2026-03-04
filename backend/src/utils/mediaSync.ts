import path from 'path';
import fs from 'fs';
import Media from '../models/Media';
import { getTenantId } from '../middleware/tenantContext';

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.webm']);

function getTypeFromExt(ext: string): 'image' | 'video' {
  const e = ext.toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(e)) return 'image';
  return 'video';
}

/**
 * Syncs files from the tenant's uploads sub-directory into the Media collection.
 * When called inside a tenant async context (via tenantLocalStorage), it will
 * automatically scope to that tenant's directory and the Media queries will be
 * scoped by the Mongoose plugin.
 */
export async function syncUploadsToMedia(): Promise<{ created: number; skipped: number }> {
  const uploadsBase = process.env.UPLOADS_DIR || path.join(__dirname, '../../uploads');
  const tenantId = getTenantId();

  // If a tenantId is available, scan the per-tenant sub-directory: uploads/<tenantId>/
  // Otherwise (legacy / migration), scan the base directory directly.
  const uploadsDir = tenantId ? path.join(uploadsBase, tenantId) : uploadsBase;

  if (!fs.existsSync(uploadsDir)) {
    return { created: 0, skipped: 0 };
  }

  const files = fs.readdirSync(uploadsDir);
  let created = 0;
  let skipped = 0;

  for (const file of files) {
    // Skip dotfiles and directories
    const fullPath = path.join(uploadsDir, file);
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) { continue; }
    if (file.startsWith('.')) { continue; }

    const ext = path.extname(file).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) { skipped++; continue; }

    // URL uses a tenant-namespaced path: /uploads/<tenantId>/filename  OR  /uploads/filename (legacy)
    const url = tenantId ? `/uploads/${tenantId}/${file}` : `/uploads/${file}`;

    const existing = await Media.findOne({ $or: [ { filename: file }, { url } ] }).lean();
    if (existing) { skipped++; continue; }

    const title = path.parse(file).name;
    const type = getTypeFromExt(ext);

    await Media.create({
      filename: file,
      title,
      url,
      type,
      category: 'general',
      isPublic: true,
      isFeatured: false,
      tags: [],
      fileSize: stat.size,
    });
    created++;
  }

  return { created, skipped };
}
