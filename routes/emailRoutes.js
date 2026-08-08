// routes/emailRoutes.js
const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/authMiddleware");
const { apiLimiter } = require("../middleware/securityMiddleware");
const { validateContactForm } = require("../middleware/validators");
const userController = require("../controller/userController");

/**
 * @route POST /api/contact/send
 * @desc Send contact email
 * @access Public (rate-limited)
 */
router.post(
  "/send",
  apiLimiter,
  validateContactForm,
  userController.submitContact
);

/**
 * @route POST /api/contact/contact
 * @desc Alternative contact form submission
 * @access Public (rate-limited)
 */
router.post(
  "/contact",
  apiLimiter,
  validateContactForm,
  userController.submitContact
);

/**
 * @route POST /api/contact/emergency
 * @desc Submit emergency contact
 * @access Public (rate-limited)
 */
router.post(
  "/emergency",
  apiLimiter,
  userController.submitContact
);

/**
 * @route POST /api/contact/subscribe
 * @desc Subscribe to newsletter
 * @access Public (rate-limited)
 */
router.post(
  "/subscribe",
  apiLimiter,
  userController.toggleSubscription
);

module.exports = router;