import express, { Request, Response } from 'express';
import Media from '../models/Media';
import { authenticate, authorize, optionalAuth, AuthRequest } from '../middleware/auth';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { getSortObject } from '../utils/helpers';
import { syncUploadsToMedia } from '../utils/mediaSync';

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = process.env.UPLOADS_DIR || path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    // Temporary filename; we will rename after handling user-provided filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req: any, file: any, cb: any) => {
  // Accept images and videos
  if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image and video files are allowed'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

// @route   GET /api/media
// @desc    Get media files with filtering
// @access  Public
router.get('/', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const {
      category,
      type,
      featured,
      tags,
      page = 1,
      limit = 20,
      sort = '-createdAt'
    } = req.query;

    // Build filter object
    const filter: any = {};
    // Allow admins to view all media, otherwise restrict to public
    if (!req.user || (req.user && req.user.role !== 'admin')) {
      filter.isPublic = true;
    }

    if (category) filter.category = category;
    if (type) filter.type = type;
    if (featured !== undefined) filter.isFeatured = featured === 'true';
    if (tags) {
      const tagList = (tags as string).split(',').map(tag => tag.trim().toLowerCase());
      filter.tags = { $in: tagList };
    }

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    const media = await Media.find(filter)
      .populate('uploadedBy', 'firstName lastName')
      .sort(getSortObject(sort))
      .limit(limitNum)
      .skip(skip)
      .lean();

    const total = await Media.countDocuments(filter);
    const totalPages = Math.ceil(total / limitNum);

    res.status(200).json({
      success: true,
      data: media,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalMedia: total,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1
      }
    });
  } catch (error: any) {
    console.error('Get media error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching media'
    });
  }
});

// @route   GET /api/media/featured
// @desc    Get featured media for homepage carousel
// @access  Public
router.get('/featured', async (req, res) => {
  try {
    const featuredMedia = await Media.find({
      isFeatured: true,
      isPublic: true,
      type: 'image'
    })
      .sort('-createdAt')
      .limit(10)
      .select('title url category tags dimensions')
      .lean();

    res.status(200).json({
      success: true,
      data: featuredMedia
    });
  } catch (error: any) {
    console.error('Get featured media error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching featured media'
    });
  }
});

// @route   GET /api/media/categories
// @desc    Get media grouped by categories
// @access  Public
router.get('/categories', async (req, res) => {
  try {
    const categories = await Media.aggregate([
      { $match: { isPublic: true } },
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          media: {
            $push: {
              _id: '$_id',
              title: '$title',
              url: '$url',
              type: '$type',
              isFeatured: '$isFeatured'
            }
          }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.status(200).json({
      success: true,
      data: categories
    });
  } catch (error: any) {
    console.error('Get categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching categories'
    });
  }
});

// @route   POST /api/media/upload
// @desc    Upload media file
// @access  Private (Admin/Staff)
router.post('/upload', authenticate, authorize('admin', 'staff'), upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const { title, description, category, tags, isFeatured, isPublic, filename } = req.body;

    // Determine desired final filename (slug + original extension)
    const sanitizeSlug = (input: string) => {
      return (input || '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9-_]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    };

    const extFromOriginal = () => {
      const ext = path.extname(req.file!.originalname);
      if (ext) return ext.toLowerCase();
      const map: Record<string, string> = {
        'image/jpeg': '.jpg',
        'image/jpg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp',
        'image/gif': '.gif',
        'video/mp4': '.mp4',
        'video/webm': '.webm',
      };
      return map[req.file!.mimetype] || '';
    };

    const base = sanitizeSlug(filename || path.parse(req.file.originalname).name);
    const ext = extFromOriginal();
    if (!ext) {
      // Clean up temp file
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ success: false, message: 'Unsupported file type or missing extension' });
    }

    const finalName = `${base}${ext}`;
    const uploadDir = process.env.UPLOADS_DIR || path.join(__dirname, '../../uploads');
    const finalPath = path.join(uploadDir, finalName);

    // Enforce uniqueness: check DB and filesystem
    const existing = await Media.findOne({ $or: [ { filename: finalName }, { url: `/uploads/${finalName}` } ] });
    if (existing || fs.existsSync(finalPath)) {
      // Clean up temp file
      fs.unlink(req.file.path, () => {});
      return res.status(409).json({ success: false, message: 'Filename already exists. Choose a different name.' });
    }

    // Move temp file to final filename
    fs.renameSync(req.file.path, finalPath);
    const fileUrl = `/uploads/${finalName}`;

    // Get file dimensions for images (you might want to use a library like sharp for this)
    let dimensions;
    if (req.file.mimetype.startsWith('image/')) {
      // For now, we'll leave dimensions empty - implement with sharp or similar library
      dimensions = undefined;
    }

    const media = new Media({
      filename: finalName,
      title: title || req.file.originalname,
      description,
      url: fileUrl,
      type: req.file.mimetype.startsWith('image/') ? 'image' : 'video',
      category: category || 'general',
      tags: tags ? tags.split(',').map((tag: string) => tag.trim().toLowerCase()) : [],
      isFeatured: isFeatured === 'true',
      isPublic: isPublic !== 'false', // default to true
      uploadedBy: req.user!.id,
      fileSize: fs.statSync(finalPath).size,
      dimensions
    });

    await media.save();
    await media.populate('uploadedBy', 'firstName lastName');

    res.status(201).json({
      success: true,
      message: 'Media uploaded successfully',
      data: media
    });
  } catch (error: any) {
    // Delete uploaded file if database save failed
    if (req.file) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('Error deleting file:', err);
      });
    }

    console.error('Upload media error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while uploading media'
    });
  }
});

// @route   PUT /api/media/:id
// @desc    Update media metadata
// @access  Private (Admin/Staff)
router.put('/:id', authenticate, authorize('admin', 'staff'), async (req, res) => {
  try {
    const { title, description, category, tags, isFeatured, isPublic } = req.body;

    const media = await Media.findById(req.params.id);
    if (!media) {
      return res.status(404).json({
        success: false,
        message: 'Media not found'
      });
    }

    // Update fields
    if (title) media.title = title;
    if (description !== undefined) media.description = description;
    if (category) media.category = category;
    if (tags) media.tags = tags.split(',').map((tag: string) => tag.trim().toLowerCase());
    if (isFeatured !== undefined) {
      media.isFeatured = typeof isFeatured === 'string' ? (isFeatured === 'true') : Boolean(isFeatured);
    }
    if (isPublic !== undefined) {
      media.isPublic = typeof isPublic === 'string' ? (isPublic === 'true') : Boolean(isPublic);
    }

    await media.save();
    await media.populate('uploadedBy', 'firstName lastName');

    res.status(200).json({
      success: true,
      message: 'Media updated successfully',
      data: media
    });
  } catch (error: any) {
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid media ID'
      });
    }

    console.error('Update media error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating media'
    });
  }
});

// @route   DELETE /api/media/:id
// @desc    Delete media file
// @access  Private (Admin)
router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const media = await Media.findById(req.params.id);
    if (!media) {
      return res.status(404).json({
        success: false,
        message: 'Media not found'
      });
    }

    // Delete file from filesystem
    const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, '../../uploads');
    const filePath = path.join(uploadsDir, media.filename || path.basename(media.url));
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Delete from database
    await Media.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'Media deleted successfully'
    });
  } catch (error: any) {
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid media ID'
      });
    }

    console.error('Delete media error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while deleting media'
    });
  }
});

export default router;

// @route   POST /api/media/sync-uploads
// @desc    Sync files in uploads/ folder into Media collection
// @access  Private (Admin)
router.post('/sync-uploads', authenticate, authorize('admin'), async (req: Request, res: Response) => {
  try {
    const { created, skipped } = await syncUploadsToMedia();
    res.status(200).json({
      success: true,
      message: `Sync complete: ${created} created, ${skipped} skipped`,
      data: { created, skipped }
    });
  } catch (error: any) {
    console.error('Sync uploads error:', error);
    res.status(500).json({ success: false, message: 'Server error while syncing uploads' });
  }
});
