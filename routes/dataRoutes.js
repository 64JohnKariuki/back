// routes/dataRoutes.js
const express = require("express");
const router = express.Router();
const dataController = require("../controller/dataController");
const { requireAuth, requireAdmin } = require("../middleware/authMiddleware");
const { apiLimiter, noCacheHeaders, secureCacheHeaders } = require("../middleware/securityMiddleware");

/**
 * @route GET /api/data
 * @desc Get all cached e-commerce data
 * @access Public
 */
router.get(
  "/",
  apiLimiter,
  secureCacheHeaders,
  dataController.getAllData
);

/**
 * @route POST /api/data/refresh
 * @desc Force refresh cache (admin only)
 * @access Protected (admin)
 */
router.post(
  "/refresh",
  requireAdmin,
  dataController.refreshCache
);

/**
 * @route GET /api/data/cache-status
 * @desc Get cache status (admin only)
 * @access Protected (admin)
 */
router.get(
  "/cache-status",
  requireAdmin,
  noCacheHeaders,
  dataController.getCacheStatus
);

/**
 * @route POST /api/data/galleries/token/:token
 * @desc Get public gallery by password token
 * @access Public
 */
router.post(
  "/galleries/token/:token",
  apiLimiter,
  dataController.getPublicGalleryByToken
);

/**
 * @route GET /api/data/client/galleries
 * @desc Get galleries for authenticated clients
 * @access Protected
 */
router.get(
  "/client/galleries",
  requireAuth,
  noCacheHeaders,
  dataController.getClientGalleries
);

/**
 * @route GET /api/data/client/galleries/:id
 * @desc Get specific client gallery
 * @access Protected
 */
router.get(
  "/client/galleries/:id",
  requireAuth,
  noCacheHeaders,
  dataController.getClientGalleryById
);

module.exports = router;