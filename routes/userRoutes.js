// routes/userRoutes.js
const express = require("express");
const router = express.Router();
const userController = require("../controller/userController");
const adminController = require("../controller/adminController");
const { sendContactEmail, sendEmail, sendEmergencyContact } = require("../config/email");
const { requireAuth, requireAdmin } = require("../middleware/authMiddleware");
const { authLimiter, apiLimiter, refreshTokenLimiter, noCacheHeaders } = require("../middleware/securityMiddleware");
const {
  validateUserRegister,
  validateUserLogin,
  validateContactForm,
} = require("../middleware/validators");

// ==============================
// Authentication Routes
// ==============================

/**
 * @route POST /api/users/register
 * @desc Register a new user
 * @access Public (rate-limited)
 */
router.post("/register", authLimiter, validateUserRegister, userController.auditLog('USER_REGISTER'), userController.register);

/**
 * @route POST /api/users/login
 * @desc User login
 * @access Public (rate-limited)
 */
router.post(
  "/login",
  authLimiter,
  validateUserLogin,
  userController.auditLog('USER_LOGIN'),
  userController.login
);

/**
 * @route POST /api/users/social-login
 * @desc Social login (OAuth)
 * @access Public (rate-limited)
 */
router.post(
  "/social-login",
  authLimiter,
  userController.auditLog('USER_SOCIAL_LOGIN'),
  userController.socialLogin
);

/**
 * @route POST /api/users/logout
 * @desc Logout user - clear session & tokens
 * @access Protected
 */
router.post(
  "/logout",
  requireAuth,
  noCacheHeaders,
  userController.auditLog('USER_LOGOUT'),
  userController.logout
);

router.post(
  '/revoke-all-sessions',
  requireAuth,
  noCacheHeaders,
  userController.auditLog('REVOKE_ALL_SESSIONS'),
  userController.revokeAllSessions
);

/**
 * @route GET /api/auth/sessions
 * @desc List all active sessions
 * @access Protected
 */
router.get(
  '/sessions',
  requireAuth,
  noCacheHeaders,
  userController.auditLog('LIST_SESSIONS'),
  userController.listSessions
);

/**
 * @route DELETE /api/auth/sessions/:sessionId
 * @desc Revoke specific session
 * @access Protected
 */
router.delete(
  '/sessions/:sessionId',
  requireAuth,
  noCacheHeaders,
  userController.auditLog('REVOKE_SESSION'),
  userController.revokeSpecificSession
);

/**
 * @route GET /api/auth/validate-session
 * @desc Validate current session (keep-alive)
 * @access Protected
 */
router.get(
  '/validate-session',
  requireAuth,
  noCacheHeaders,
  userController.auditLog('VALIDATE_SESSION'),
  userController.validateSession
);

/**
 * @route POST /api/users/refresh-token
 * @desc Refresh access token
 * @access Protected
 */
router.post(
  "/refresh-token",
  noCacheHeaders,
  userController.auditLog('TOKEN_REFRESH'),
  userController.refreshAccessToken
);

/**
 * @route GET /api/users/verify
 * @desc Verify current session
 * @access Protected
 */
router.get(
  "/verify",
  requireAuth,
  noCacheHeaders,
  userController.auditLog('VERIFY_SESSION'),
  userController.verify
);

// ==============================
// User Profile Routes
// ==============================

/**
 * @route GET /api/users/:userId/data
 * @desc Get user data
 * @access Protected (self or admin)
 */
router.get(
  "/:userId/data",
  requireAuth,
  noCacheHeaders,
  userController.auditLog('USER_DATA'),
  userController.userData
);

/**
 * @route PUT /api/users/update
 * @desc Update user profile
 * @access Protected
 */
router.put(
  "/update",
  requireAuth,
  apiLimiter,
  userController.auditLog('USER_UPDATE'),
  userController.update
);

/**
 * @route GET /api/users/details
 * @desc Get current user details
 * @access Protected
 */
router.get(
  "/details",
  requireAuth,
  noCacheHeaders,
  userController.auditLog('USER_DETAILS'),
  userController.userDetails
);

// ==============================
// Admin User Management
// ==============================

/**
 * @route GET /api/users/all
 * @desc Get all users (admin only)
 * @access Protected (admin)
 */
router.get(
  "/all",
  requireAdmin,
  noCacheHeaders,
  userController.auditLog('ALL_USERS'),
  userController.allUsers
);

// ==============================
// Contact & Communication
// ==============================

/**
 * @route POST /api/users/contact
 * @desc Submit contact form
 * @access Public (rate-limited)
 */
router.post(
  "/contact",
  apiLimiter,
  validateContactForm,
  userController.auditLog('CONTACT_FORM'),
  async (req, res) => {
    try {
      const { name, email, phone, subject, message } = req.body;

      // Basic validation (should be handled by middleware, but belt-and-suspenders)
      if (!name || !email || !message) {
        return res.status(400).json({
          success: false,
          error: "Name, email, and message are required.",
        });
      }

      // Call the email helper function
      await sendEmail({
        to: email,
        subject: subject || "Contact Form Submission",
        html: `
          <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
            <h2 style="color: #333;">New Contact Form Submission</h2>
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Email:</strong> ${email}</p>
            ${phone ? `<p><strong>Phone:</strong> ${phone}</p>` : ""}
            <p><strong>Subject:</strong> ${subject || "N/A"}</p>
            <hr />
            <p><strong>Message:</strong></p>
            <p style="white-space: pre-wrap; color: #555;">${message}</p>
          </div>
        `,
      });

      res.status(200).json({
        success: true,
        message: "Message sent successfully!",
      });
    } catch (error) {
      console.error("❌ Error in contact form:", error);
      res.status(500).json({
        success: false,
        error: "An error occurred while sending your message. Please try again later.",
      });
    }
  }
);

/**
 * @route POST /api/users/emergency
 * @desc Submit emergency contact
 * @access Public (rate-limited)
 */
router.post(
  "/emergency",
  apiLimiter,
  userController.auditLog('EMERGENCY_CONTACT'),
  async (req, res) => {
    try {
      const { name, phone, emergency } = req.body;

      if (!name || !phone || !emergency) {
        return res.status(400).json({
          success: false,
          error: "Name, phone, and emergency details are required.",
        });
      }

      // Pass req & res to the emergency contact handler
      return sendEmergencyContact(req, res);
    } catch (error) {
      console.error("❌ Error in emergency API:", error);
      res.status(500).json({
        success: false,
        error: "An error occurred while sending the emergency contact.",
      });
    }
  }
);

/**
 * @route POST /api/users/subscribe
 * @desc Subscribe to newsletter
 * @access Public (rate-limited)
 */
router.post(
  "/subscribe",
  apiLimiter,
  userController.auditLog('NEWSLETTER_SUBSCRIPTION'),
  async (req, res) => {
    try {
      const { email } = req.body;

      // Basic server-side validation
      if (!email) {
        return res.status(400).json({
          success: false,
          error: "Email is required.",
        });
      }

      // TODO: Save subscription to database
      console.log(`📧 Newsletter subscription: ${email}`);

      res.status(200).json({
        success: true,
        message: "Successfully subscribed to newsletter!",
      });
    } catch (error) {
      console.error("❌ Error in subscription API:", error.message);
      res.status(500).json({
        success: false,
        error: "An error occurred while subscribing. Please try again later.",
      });
    }
  }
);

// ==============================
// Gallery Revision Routes
// ==============================

/**
 * @route POST /api/users/gallery/:gallery_id/revision
 * @desc Submit revision request for a gallery
 * @access Protected
 */
router.post(
  "/gallery/:gallery_id/revision",
  requireAuth,
  userController.auditLog('SUBMIT_REVISION'), 
  adminController.submitRevision
);

module.exports = router;