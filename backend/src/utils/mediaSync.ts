import path from 'path';
import fs from 'fs';
import Media from '../models/Media';

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.webm']);

function getTypeFromExt(ext: string): 'image' | 'video' {
  const e = ext.toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(e)) return 'image';
  return 'video';
}

export async function syncUploadsToMedia(): Promise<{ created: number; skipped: number }> {
  const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, '../../uploads');
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

    const existing = await Media.findOne({ $or: [ { filename: file }, { url: `/uploads/${file}` } ] }).lean();
    if (existing) { skipped++; continue; }

    const title = path.parse(file).name;
    const type = getTypeFromExt(ext);

    await Media.create({
      filename: file,
      title,
      url: `/uploads/${file}`,
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
