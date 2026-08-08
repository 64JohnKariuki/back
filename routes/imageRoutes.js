// routes/imageRoutes.js
const express = require("express");
const router = express.Router();
const upload = require("../middleware/uploadMiddleware");
const { requireAdmin } = require("../middleware/authMiddleware");
const { apiLimiter, secureCacheHeaders } = require("../middleware/securityMiddleware");
const {
  uploadCldImage,
  getAllImages,
  getGalleryImages,
  fetchGalleries,
  updateGallery,
  deleteGallery,
  getDeletedGalleries,
  restoreGallery,
} = require("../controller/uploadController");
const fs = require("fs");
const path = require("path");

const IMAGES_DIR = path.resolve(process.cwd(), "images");
const STATIC_URL_PREFIX = "/images";

const isImageFile = (filename) => {
  const extension = path.extname(filename).toLowerCase();
  return [".jpg", ".jpeg", ".png", ".gif", ".webp", ".tiff"].includes(extension);
};

/**
 * @route GET /api/image/allImages
 * @desc Get all local images
 * @access Public
 */
router.get("/allImages", apiLimiter, secureCacheHeaders, (req, res) => {
  try {
    if (!fs.existsSync(IMAGES_DIR)) {
      return res.status(200).json([]);
    }

    const files = fs.readdirSync(IMAGES_DIR);
    const imagesData = files
      .filter(isImageFile)
      .map((filename) => ({
        id: path.parse(filename).name,
        name: filename,
        url: `${req.protocol}://${req.get("host")}${STATIC_URL_PREFIX}/${filename}`,
      }));

      console.log("These are the images", imagesData)
    res.status(200).json(imagesData);
  } catch (error) {
    console.error("Error fetching images:", error);
    res.status(500).json({
      message: "Failed to retrieve images",
    });
  }
});

/**
 * @route POST /api/image/upload/local
 * @desc Upload single image locally
 * @access Protected (admin)
 */
router.post(
  "/upload/local",
  requireAdmin,
  upload.single("file"),
  (req, res, next) => {
    req.body.uploadMode = "single";
    next();
  },
  uploadCldImage
);

/**
 * @route POST /api/image/upload/cloudinary
 * @desc Upload multiple images to Cloudinary
 * @access Protected (admin)
 */
router.post(
  "/upload/cloudinary",
  requireAdmin,
  upload.array("files", 20),
  (req, res, next) => {
    req.body.uploadMode = "bulk";
    next();
  },
  uploadCldImage
);

/**
 * @route GET /api/image/galleries
 * @desc Get all galleries
 * @access Public
 */
router.get(
  "/galleries",
  apiLimiter,
  secureCacheHeaders,
  fetchGalleries
);

/**
 * @route PUT /api/image/galleries/edit/:id
 * @desc Update gallery (admin only)
 * @access Protected (admin)
 */
router.put("/galleries/edit/:id", requireAdmin, updateGallery);

/**
 * @route DELETE /api/image/galleries/delete
 * @desc Delete gallery (admin only)
 * @access Protected (admin)
 */
router.delete("/galleries/delete", requireAdmin, deleteGallery);

/**
 * @route GET /api/image/galleries/deleted
 * @desc Get deleted galleries (admin only)
 * @access Protected (admin)
 */
router.get(
  "/galleries/deleted",
  requireAdmin,
  getDeletedGalleries
);

/**
 * @route PATCH /api/image/galleries/restore/:gallery_id
 * @desc Restore deleted gallery (admin only)
 * @access Protected (admin)
 */
router.patch("/galleries/restore/:gallery_id", requireAdmin, restoreGallery);

/**
 * @route GET /api/image/gallery/:galleryName
 * @desc Get images from gallery
 * @access Public
 */
router.get(
  "/gallery/:galleryName",
  apiLimiter,
  secureCacheHeaders,
  getGalleryImages
);

/**
 * @route GET /api/image/all
 * @desc Get all images
 * @access Public
 */
router.get("/all", apiLimiter, secureCacheHeaders, getAllImages);

module.exports = router;