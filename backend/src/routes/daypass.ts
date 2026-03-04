import express, { Request, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import DayPassBooking from '../models/DayPassBooking';
import mongoose from 'mongoose';

const router = express.Router();

const DAYPASS_PRICES = {
  adult: 30,
  child: 20,
  infant: 0, // Infants are free
};

// @route   POST /api/daypass/book
// @desc    Book a day pass
// @access  Public
router.post('/book', async (req: Request, res: Response) => {
  try {
    const { date, adults, children, infants, contactInfo, specialRequests } = req.body;

    // Validation
    if (!date || !adults || adults < 1) {
      return res.status(400).json({
        success: false,
        message: 'Date and at least one adult are required'
      });
    }

    if (!contactInfo || !contactInfo.firstName || !contactInfo.lastName || !contactInfo.email) {
      return res.status(400).json({
        success: false,
        message: 'First name, last name, and email are required'
      });
    }

    const bookingDate = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (bookingDate < today) {
      return res.status(400).json({
        success: false,
        message: 'Cannot book day pass for past dates'
      });
    }

    // Calculate totals
    const totalGuests = adults + children + infants;
    const totalPrice = (adults * DAYPASS_PRICES.adult) + (children * DAYPASS_PRICES.child);

    // Create booking
    const booking = new DayPassBooking({
      user: null, // No user required for public bookings
      date: bookingDate,
      adults: adults || 0,
      children: children || 0,
      infants: infants || 0,
      totalGuests,
      totalPrice,
      contactInfo,
      specialRequests: specialRequests || '',
      // Default to pending; booking gets confirmed once fully paid via admin flow
      status: 'pending'
    });

    await booking.save();

    res.status(201).json({
      success: true,
      message: 'Day pass booked successfully!',
      data: {
        booking: {
          _id: booking._id,
          date: booking.date,
          adults: booking.adults,
          children: booking.children,
          infants: booking.infants,
          totalGuests: booking.totalGuests,
          totalPrice: booking.totalPrice,
          contactInfo: booking.contactInfo,
          specialRequests: booking.specialRequests,
          status: booking.status,
          createdAt: booking.createdAt
        }
      }
    });
  } catch (error: any) {
    console.error('Day pass booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while booking day pass'
    });
  }
});

// @route   GET /api/daypass/my-passes
// @desc    Get user's day pass bookings
// @access  Private
router.get('/my-passes', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const bookings = await DayPassBooking.find({
      user: req.user?._id
    }).sort({ date: -1 });

    res.status(200).json({
      success: true,
      data: {
        bookings: bookings.map(booking => ({
          _id: booking._id,
          date: booking.date,
          adults: booking.adults,
          children: booking.children,
          infants: booking.infants,
          totalGuests: booking.totalGuests,
          totalPrice: booking.totalPrice,
          contactInfo: booking.contactInfo,
          specialRequests: booking.specialRequests,
          status: booking.status,
          createdAt: booking.createdAt
        }))
      }
    });
  } catch (error: any) {
    console.error('Get day passes error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while retrieving day passes'
    });
  }
});

// @route   GET /api/daypass/admin
// @desc    Get all day pass bookings (Admin only)
// @access  Private (Admin)
router.get('/admin', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const bookings = await DayPassBooking.find({})
      .populate('user', 'firstName lastName email')
      .sort({ date: -1 });

    res.status(200).json({
      success: true,
      data: {
        bookings: bookings.map(booking => ({
          _id: booking._id,
          user: booking.user,
          date: booking.date,
          adults: booking.adults,
          children: booking.children,
          infants: booking.infants,
          totalGuests: booking.totalGuests,
          totalPrice: booking.totalPrice,
          contactInfo: booking.contactInfo,
          specialRequests: booking.specialRequests,
          status: booking.status,
          createdAt: booking.createdAt
        }))
      }
    });
  } catch (error: any) {
    console.error('Get all day passes error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while retrieving day passes'
    });
  }
});

// @route   PATCH /api/daypass/:id/cancel
// @desc    Cancel a day pass booking
// @access  Private
router.patch('/:id/cancel', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid booking ID'
      });
    }

    const booking = await DayPassBooking.findById(id);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Day pass booking not found'
      });
    }

    // Check ownership (user can only cancel their own bookings, unless admin)
    if (req.user?.role !== 'admin' && booking.user.toString() !== req.user?._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    if (booking.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Day pass is already cancelled'
      });
    }

    // Check if booking date is in the future (allow cancellation only for future dates)
    const bookingDate = new Date(booking.date);
    const today = new Date();
    today.setHours(23, 59, 59, 999); // End of today

    if (bookingDate <= today) {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel day pass for today or past dates'
      });
    }

    booking.status = 'cancelled';
    booking.updatedAt = new Date();
    await booking.save();

    res.status(200).json({
      success: true,
      message: 'Day pass cancelled successfully',
      data: {
        booking: {
          _id: booking._id,
          date: booking.date,
          adults: booking.adults,
          children: booking.children,
          infants: booking.infants,
          totalGuests: booking.totalGuests,
          totalPrice: booking.totalPrice,
          contactInfo: booking.contactInfo,
          specialRequests: booking.specialRequests,
          status: booking.status,
          updatedAt: booking.updatedAt
        }
      }
    });
  } catch (error: any) {
    console.error('Cancel day pass error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while cancelling day pass'
    });
  }
});

export default router;
