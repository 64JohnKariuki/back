// routes/bookingRoutes.js
const express = require("express");
const router = express.Router();
const bookingController = require("../controller/bookingController");
const { requireAuth, requireAdmin } = require("../middleware/authMiddleware");
const { apiLimiter, secureCacheHeaders, noCacheHeaders } = require("../middleware/securityMiddleware");

/**
 * @route POST /api/booking/create
 * @desc Create new booking
 * @access Protected
 */
router.post(
  "/create",
  requireAuth,
  bookingController.createBooking
);

/**
 * @route POST /api/booking/payment/callback
 * @desc Handle payment callback
 * @access Public (webhook from payment provider)
 */
router.post(
  "/payment/callback",
  requireAuth,
  bookingController.handlePaymentCallback
);

/**
 * @route GET /api/booking/services
 * @desc Get available services
 * @access Public
 */
router.get(
  "/services",
  apiLimiter,
  secureCacheHeaders,
  bookingController.getData
);

/**
 * @route GET /api/booking/categories
 * @desc Get booking categories
 * @access Public
 */
router.get(
  "/categories",
  apiLimiter,
  secureCacheHeaders,
  bookingController.getData
);

/**
 * @route GET /api/booking/packages
 * @desc Get booking packages
 * @access Public
 */
router.get(
  "/packages",
  apiLimiter,
  secureCacheHeaders,
  bookingController.getData
);

/**
 * @route GET /api/booking/all
 * @desc Get all bookings (admin only)
 * @access Protected (admin)
 */
router.get(
  "/all",
  requireAdmin,
  noCacheHeaders,
  bookingController.getAllBookings
);

/**
 * @route GET /api/booking/:id
 * @desc Get booking by ID
 * @access Protected
 */
router.get(
  "/:id",
  requireAuth,
  noCacheHeaders,
  bookingController.getBookingById
);

/**
 * @route PUT /api/booking/update/:id
 * @desc Update booking
 * @access Protected (admin)
 */
router.put(
  "/update/:id",
  requireAuth,
  bookingController.updateBooking
);

/**
 * @route GET /api/booking/myPastBookings/:id
 * @desc Get user's past bookings
 * @access Protected
 */
router.get(
  "/myPastBookings/:id",
  requireAuth,
  noCacheHeaders,
  bookingController.getPastBookingsByCustomerID
);

/**
 * @route DELETE /api/booking/cancel/:id
 * @desc Cancel a booking
 * @access Protected
 */
router.patch(
  "/cancel/:id",
  requireAuth,
  bookingController.cancelBooking
);

module.exports = router;