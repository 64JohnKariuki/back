// routes/adminRoutes.js
const express = require('express');
const router = express.Router();
const upload = require('../middleware/uploadMiddleware');
const adminController = require('../controller/adminController');
const { requireAdmin, requireAuth } = require('../middleware/authMiddleware');
const { authLimiter } = require('../middleware/securityMiddleware');
const {
  validateAdminLogin,
  validateAdminVerify,
} = require('../middleware/validators');
const { noCacheHeaders } = require('../middleware/securityMiddleware');

// ==============================
// Admin Auth Routes
// ==============================

/**
 * @route POST /api/admin/login
 * @desc Initialize admin authentication challenge
 * @access Public (rate-limited)
 */
router.post('/login', authLimiter, validateAdminLogin, adminController.login);

/**
 * @route POST /api/admin/verify
 * @desc Verify admin OTP
 * @access Public (rate-limited)
 */
router.post('/verify', authLimiter, validateAdminVerify, adminController.verifyAdminCode);

/**
 * @route POST /api/admin/resend-code
 * @desc Resend OTP
 * @access Public (rate-limited)
 */
router.post('/resend-code', authLimiter, adminController.resendAdminCode);

/**
 * @route POST /api/admin/cancel-challenge
 * @desc Cancel active OTP challenge
 * @access Public
 */
router.post('/cancel-challenge', adminController.cancelAdminChallenge);

/**
 * @route POST /api/admin/logout
 * @desc Logout admin - revoke session & tokens
 * @access Protected
 */
router.post('/logout', requireAuth, adminController.logout);

/**
 * @route POST /api/admin/refresh-token
 * @desc Refresh access token
 * @access Protected
 */
router.post('/refresh-token', requireAuth, adminController.refreshAccessToken);

// ==============================
// Brands Routes (Admin Only)
// ==============================
router.get(
  '/brands',
  requireAdmin,
  noCacheHeaders,
  adminController.getBrands
);
router.post(
  '/brands/create',
  requireAdmin,
  upload.single('icon'),
  adminController.createBrand
);
router.put(
  '/brands/update/:id',
  requireAdmin,
  adminController.updateBrand
);
router.delete(
  '/brands/delete/:id',
  requireAdmin,
  adminController.deleteBrand
);

// ==============================
// Gallery Routes (Admin Only)
// ==============================
router.get(
  '/galleries',
  requireAdmin,
  noCacheHeaders,
  adminController.getGalleries
);
router.post(
  '/galleries/create',
  requireAdmin,
  adminController.createGallery
);
router.post('/galleries/send', requireAdmin, adminController.sendGallery);
router.get(
  '/galleries/revisions/pending',
  requireAdmin,
  noCacheHeaders,
  adminController.getPendingRevisions
);
router.put(
  '/galleries/update/:id',
  requireAdmin,
  adminController.updateGallery
);
router.delete(
  '/galleries/delete/:id',
  requireAdmin,
  adminController.deleteGallery
);
router.post(
  '/galleries/:id/upload',
  requireAdmin,
  upload.array('files', 50),
  adminController.uploadBulk
);
router.delete(
  '/galleries/:gallery_id/images/:image_id',
  requireAdmin,
  adminController.deleteGalleryImage
);
router.get(
  '/galleries/:id',
  requireAdmin,
  noCacheHeaders,
  adminController.getGallery
);
router.post(
  '/galleries/:gallery_id/revisions',
  requireAdmin,
  adminController.submitRevision
);
router.get(
  '/galleries/:gallery_id/revisions',
  requireAdmin,
  noCacheHeaders,
  adminController.getRevisions
);
router.put(
  '/revisions/:revision_id/resolve',
  requireAdmin,
  adminController.resolveRevision
);

// ==============================
// Categories Routes (Admin Only)
// ==============================
router.get(
  '/categories',
  requireAdmin,
  noCacheHeaders,
  adminController.getCategories
);
router.post('/categories/create', requireAdmin, adminController.addCategory);
router.put(
  '/categories/update/:id',
  requireAdmin,
  adminController.updateCategory
);
router.delete(
  '/categories/delete/:id',
  requireAdmin,
  adminController.deleteCategory
);

// ==============================
// Packages Routes (Admin Only)
// ==============================
router.get(
  '/packages',
  requireAdmin,
  noCacheHeaders,
  adminController.getPackages
);
router.post('/packages/create', requireAdmin, adminController.addPackage);
router.put(
  '/packages/update/:id',
  requireAdmin,
  adminController.updatePackage
);
router.delete(
  '/packages/delete/:id',
  requireAdmin,
  adminController.deletePackage
);

// ==============================
// Genres Routes (Admin Only)
// ==============================
router.get(
  '/genres',
  requireAdmin,
  noCacheHeaders,
  adminController.getGenres
);
router.post('/genres/create', requireAdmin, adminController.addGenre);
router.put(
  '/genres/update/:genre_id',
  requireAdmin,
  adminController.updateGenre
);
router.delete(
  '/genres/delete/:genre_id',
  requireAdmin,
  adminController.deleteGenre
);

module.exports = router;