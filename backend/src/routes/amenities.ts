import express, { Request, Response } from 'express';
import path from 'path';
import Amenity from '../models/Amenity';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { getSortObject } from '../utils/helpers';

const router = express.Router();

// Image uploads are managed exclusively via Media Library; amenities accept imageUrl only

// @route   GET /api/amenities
// @desc    Get all active amenities
// @access  Public
router.get('/', async (req: Request, res: Response) => {
  try {
    const {
      category,
      active = 'true',
      sort = 'order'
    } = req.query;

    // Build filter object
    const filter: any = {};

    if (active === 'true') {
      filter.isActive = true;
    }

    if (category) {
      filter.category = category;
    }

    const sortObject = getSortObject(sort as string);

    const amenities = await Amenity.find(filter)
      .sort(sortObject)
      .exec();

    res.status(200).json({
      success: true,
      count: amenities.length,
      data: amenities
    });
  } catch (error: any) {
    console.error('Get amenities error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while retrieving amenities'
    });
  }
});

// @route   GET /api/amenities/:id
// @desc    Get single amenity
// @access  Public
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const amenity = await Amenity.findById(req.params.id);

    if (!amenity) {
      return res.status(404).json({
        success: false,
        message: 'Amenity not found'
      });
    }

    res.status(200).json({
      success: true,
      data: amenity
    });
  } catch (error: any) {
    console.error('Get amenity error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while retrieving amenity'
    });
  }
});

// @route   POST /api/amenities
// @desc    Create new amenity
// @access  Private (Admin only)
router.post('/', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, category, order, isActive, imageUrl } = req.body;

    // Validation
    if (!name || !description) {
      return res.status(400).json({
        success: false,
        message: 'Name and description are required'
      });
    }

    if (!imageUrl) {
      return res.status(400).json({
        success: false,
        message: 'imageUrl is required. Upload images via Media Library.'
      });
    }

    const amenity = await Amenity.create({
      name: name.trim(),
      description: description.trim(),
      image: imageUrl,
      category: category || 'general',
      order: order ? parseInt(order) : 0,
      isActive: isActive !== undefined
        ? (typeof isActive === 'string' ? isActive === 'true' : Boolean(isActive))
        : true
    });

    res.status(201).json({
      success: true,
      message: 'Amenity created successfully',
      data: amenity
    });
  } catch (error: any) {
    console.error('Create amenity error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while creating amenity'
    });
  }
});

// @route   PUT /api/amenities/:id
// @desc    Update amenity
// @access  Private (Admin only)
router.put('/:id', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, category, order, isActive, imageUrl } = req.body;

    const amenity = await Amenity.findById(req.params.id);

    if (!amenity) {
      return res.status(404).json({
        success: false,
        message: 'Amenity not found'
      });
    }

    // Update fields if provided
    if (name !== undefined) amenity.name = name.trim();
    if (description !== undefined) amenity.description = description.trim();
    if (imageUrl) amenity.image = imageUrl;
    if (category !== undefined) amenity.category = category;
    if (order !== undefined) amenity.order = typeof order === 'string' ? parseInt(order) : order;
    if (isActive !== undefined) {
      amenity.isActive = typeof isActive === 'string' ? (isActive === 'true') : Boolean(isActive);
    }

    await amenity.save();

    res.status(200).json({
      success: true,
      message: 'Amenity updated successfully',
      data: amenity
    });
  } catch (error: any) {
    console.error('Update amenity error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating amenity'
    });
  }
});

// @route   DELETE /api/amenities/:id
// @desc    Delete amenity
// @access  Private (Admin only)
router.delete('/:id', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const amenity = await Amenity.findById(req.params.id);

    if (!amenity) {
      return res.status(404).json({
        success: false,
        message: 'Amenity not found'
      });
    }

    await Amenity.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'Amenity deleted successfully'
    });
  } catch (error: any) {
    console.error('Delete amenity error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while deleting amenity'
    });
  }
});

// @route   GET /api/amenities/admin/all
// @desc    Get all amenities for admin (including inactive)
// @access  Private (Admin only)
router.get('/admin/all', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const {
      category,
      active,
      page = 1,
      limit = 20,
      sort = 'order'
    } = req.query;

    // Build filter object
    const filter: any = {};

    if (active !== undefined) {
      filter.isActive = active === 'true';
    }

    if (category) {
      filter.category = category;
    }

    const pageNumber = parseInt(page as string);
    const limitNumber = parseInt(limit as string);
    const sortObject = getSortObject(sort as string);

    const amenities = await Amenity.find(filter)
      .sort(sortObject)
      .limit(limitNumber * 1)
      .skip((pageNumber - 1) * limitNumber)
      .exec();

    const total = await Amenity.countDocuments(filter);

    res.status(200).json({
      success: true,
      count: amenities.length,
      pagination: {
        page: pageNumber,
        limit: limitNumber,
        total,
        totalPages: Math.ceil(total / limitNumber)
      },
      data: amenities
    });
  } catch (error: any) {
    console.error('Get admin amenities error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while retrieving amenities'
    });
  }
});

export default router;
