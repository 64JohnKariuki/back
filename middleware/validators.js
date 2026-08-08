// middleware/validators.js
const { body, param, query, validationResult } = require('express-validator');

/**
 * Validation Error Handler
 */
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array().map((e) => ({
        field: e.param,
        message: e.msg,
      })),
    });
  }
  next();
};

/**
 * Admin Login Validation
 */
const validateAdminLogin = [
  body('email')
    .trim()
    .isEmail()
    .withMessage('Invalid email format')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/[A-Z]/)
    .withMessage('Password must contain an uppercase letter')
    .matches(/[a-z]/)
    .withMessage('Password must contain a lowercase letter')
    .matches(/[0-9]/)
    .withMessage('Password must contain a number')
    .matches(/[!@#$%^&*]/)
    .withMessage('Password must contain a special character (!@#$%^&*)'),
  handleValidationErrors,
];

/**
 * Admin OTP Verification
 */
const validateAdminVerify = [
  body('email')
    .trim()
    .isEmail()
    .withMessage('Invalid email format')
    .normalizeEmail(),
  body('otp')
    .isLength({ min: 6, max: 6 })
    .withMessage('OTP must be 6 digits')
    .isNumeric()
    .withMessage('OTP must be a number'),
  handleValidationErrors,
];

/**
 * User Registration
 */
const validateUserRegister = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters'),
  body('email')
    .trim()
    .isEmail()
    .withMessage('Invalid email format')
    .normalizeEmail(),
  body('phone')
    .optional({ checkFalsy: true })
    .trim()
    .matches(/^\+?[0-9]{10,15}$/)
    .withMessage('Invalid phone number format'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/[A-Z]/)
    .withMessage('Password must contain an uppercase letter')
    .matches(/[a-z]/)
    .withMessage('Password must contain a lowercase letter')
    .matches(/[0-9]/)
    .withMessage('Password must contain a number')
    .matches(/[!@#$%^&*]/)
    .withMessage('Password must contain a special character (!@#$%^&*)'),
  handleValidationErrors
];

/**
 * User Login
 */
const validateUserLogin = [
  body('email')
    .trim()
    .isEmail()
    .withMessage('Invalid email format')
    .normalizeEmail(),
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
  handleValidationErrors
];

// ==================== BOOKING VALIDATORS ====================

const validateBookingCreate = [
  body('clientName')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Client name must be between 2 and 100 characters'),
  body('email')
    .trim()
    .isEmail()
    .withMessage('Invalid email format')
    .normalizeEmail(),
  body('phone')
    .trim()
    .matches(/^\+?[0-9]{10,15}$/)
    .withMessage('Invalid phone number format'),
  body('date')
    .isISO8601()
    .withMessage('Invalid date format')
    .custom((value) => {
      const bookingDate = new Date(value);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (bookingDate < today) {
        throw new Error('Booking date cannot be in the past');
      }
      return true;
    }),
  body('time')
    .matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
    .withMessage('Invalid time format (use HH:MM)'),
  body('amount')
    .isFloat({ min: 0.01, max: 9999999 })
    .withMessage('Invalid amount'),
  body('package')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Invalid package'),
  body('location')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Location too long'),
  handleValidationErrors
];

const validatePaymentCallback = [
  body('bookingNo')
    .trim()
    .matches(/^[A-Z0-9-]+$/)
    .withMessage('Invalid booking number format'),
  body('status')
    .isIn(['completed', 'failed', 'pending'])
    .withMessage('Invalid payment status'),
  body('paymentResults')
    .optional()
    .isObject()
    .withMessage('Invalid payment results'),
  handleValidationErrors
];

// ==================== CONTACT FORM VALIDATORS ====================

const validateContactForm = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters'),
  body('email')
    .trim()
    .isEmail()
    .withMessage('Invalid email format')
    .normalizeEmail(),
  body('phone')
    .optional()
    .trim()
    .matches(/^\+?[0-9]{10,15}$/)
    .withMessage('Invalid phone number format'),
  body('subject')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Subject too long'),
  body('message')
    .trim()
    .isLength({ min: 10, max: 5000 })
    .withMessage('Message must be between 10 and 5000 characters'),
  handleValidationErrors
];

// ==================== ID VALIDATORS ====================

const validateIdParam = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('Invalid ID format'),
  handleValidationErrors
];

const validateUUIDParam = [
  param('id')
    .isUUID()
    .withMessage('Invalid UUID format'),
  handleValidationErrors
];

// ==================== PAGINATION VALIDATORS ====================

const validatePagination = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  handleValidationErrors
];

module.exports = {
  handleValidationErrors,
  validateAdminLogin,
  validateAdminVerify,
  validateUserRegister,
  validateUserLogin,
  validateContactForm,
  validateBookingCreate,
  validatePaymentCallback,
  validateIdParam,
  validateUUIDParam,
  validatePagination,
};