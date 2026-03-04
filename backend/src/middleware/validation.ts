import { Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';

export const handleValidationErrors = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation errors',
      errors: errors.array()
    });
  }
  next();
};

// User validation rules
export const validateRegister = [
  body('firstName')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be between 2 and 50 characters'),

  body('lastName')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Last name must be between 2 and 50 characters'),

  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),

  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long')
    .custom((value) => {
      // In development, allow simpler passwords
      if (process.env.NODE_ENV === 'development') {
        return true;
      }
      // In production, require complex passwords
      if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(value)) {
        throw new Error('Password must contain at least one lowercase letter, one uppercase letter, and one number');
      }
      return true;
    }),

  body('phone')
    .optional()
    .matches(/^[\+]?[1-9][\d]{0,15}$/)
    .withMessage('Please provide a valid phone number'),

  handleValidationErrors
];

export const validateLogin = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),

  body('password')
    .notEmpty()
    .withMessage('Password is required'),

  handleValidationErrors
];

export const validateEmail = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),

  handleValidationErrors
];

export const validatePasswordReset = [
  body('token')
    .notEmpty()
    .withMessage('Reset token is required'),

  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain at least one lowercase letter, one uppercase letter, and one number'),

  handleValidationErrors
];

// Room validation rules
export const validateRoom = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Room name must be between 2 and 100 characters'),

  body('description')
    .trim()
    .isLength({ min: 10, max: 1000 })
    .withMessage('Description must be between 10 and 1000 characters'),

  body('status')
    .optional()
    .isIn(['active', 'inactive'])
    .withMessage('Invalid status value'),

  body('condition')
    .optional()
    .isIn(['pending_cleanup', 'clean'])
    .withMessage('Invalid condition value'),

  body('comment')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Comment must be at most 500 characters'),

  body('bedConfiguration')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Bed configuration must be between 2 and 100 characters'),

  handleValidationErrors
];

// Reservation validation rules (supports room, daypass, and event types)
export const validateReservation = [
  body('type')
    .isIn(['room', 'daypass', 'PasaTarde', 'event'])
    .withMessage('Reservation type must be one of: room, daypass, PasaTarde, event'),

  // Room-specific validations
  // Removed roomType validation; room type is no longer used

  body('checkOutDate')
    .if(body('type').equals('room'))
    .isISO8601()
    .toDate()
    .custom((value, { req }) => {
      if (new Date(value) <= new Date(req.body.checkInDate)) {
        throw new Error('Check-out date must be after check-in date');
      }
      return true;
    }),

  // Event-specific validations
  body('eventType')
    .if(body('type').equals('event'))
    .isIn(['wedding', 'conference', 'birthday', 'corporate', 'other'])
    .withMessage('Event type must be one of: wedding, conference, birthday, corporate, other'),

  body('eventDescription')
    .if(body('type').equals('event'))
    .trim()
    .isLength({ min: 10, max: 1000 })
    .withMessage('Event description must be between 10 and 1000 characters'),

  body('expectedAttendees')
    .if(body('type').equals('event'))
    .isInt({ min: 1, max: 200 })
    .withMessage('Expected attendees must be between 1 and 200'),

  // Common validations
  body('checkInDate')
    .isISO8601()
    .toDate()
    .custom((value) => {
      if (new Date(value) <= new Date()) {
        throw new Error('Check-in/event date must be in the future');
      }
      return true;
    }),

  body('guests')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('Number of guests must be between 1 and 50'),

  body('guestDetails.adults')
    .isInt({ min: 1, max: 30 })
    .withMessage('Number of adults must be between 1 and 30'),

  body('guestDetails.children')
    .optional()
    .isInt({ min: 0, max: 10 })
    .withMessage('Number of children must be between 0 and 10'),

  body('guestDetails.infants')
    .optional()
    .isInt({ min: 0, max: 5 })
    .withMessage('Number of infants must be between 0 and 5'),

  body('contactInfo.phone')
    .matches(/^[\+]?[1-9][\d]{0,15}$/)
    .withMessage('Please provide a valid phone number'),

  body('contactInfo.email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),

  handleValidationErrors
];

// Contact form validation rules
export const validateContact = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters'),

  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),

  body('phone')
    .optional()
    .matches(/^[\+]?[1-9][\d]{0,15}$/)
    .withMessage('Please provide a valid phone number'),

  body('subject')
    .trim()
    .isLength({ min: 5, max: 200 })
    .withMessage('Subject must be between 5 and 200 characters'),

  body('message')
    .trim()
    .isLength({ min: 10, max: 2000 })
    .withMessage('Message must be between 10 and 2000 characters'),

  body('category')
    .optional()
    .isIn(['general', 'reservation', 'complaint', 'suggestion', 'technical'])
    .withMessage('Invalid category'),

  handleValidationErrors
];
