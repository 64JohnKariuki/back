// controller/adminController.js
const path = require('path');
const jwt = require('jsonwebtoken'); // ✅ ADDED
const cloudinary = require("../config/cloudinary");
const galleryStorage = require("../Utility/galleryStorage");
const multer = require('multer');
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const fs = require("fs").promises;
const { v4: uuidv4 } = require('uuid');
const fsPromises = require("fs/promises");
const fsSync = require("fs");
const archiver = require('archiver');
const axios = require('axios');
const NodeCache = require("node-cache");
const { promisify } = require('util');
const SessionService = require('../services/sessionService');
// ✅ SINGLE IMPORT, BOTH SYMBOLS
const { generateAccessAndRefreshToken, refreshToken } = require('../middleware/authMiddleware');
const setupSecureCookies = require('../middleware/cookieMiddleware');
const logger = require('../services/logger');

const { sendEmail, sendAxiosEmail } = require("../config/email");
const adminModel = require("../models/adminModel");
const userModel = require("../models/userModel");
const bookModel = require("../models/bookModel");
const brandModel = require("../models/brandModel");
const { invalidateDataCache } = require("./dataController");

const cookieHelpers = setupSecureCookies();

// ✅ Helper functions
async function ensureDirectoryExists(dir) {
  try {
    await fsPromises.mkdir(dir, { recursive: true });
  } catch (err) {
    console.error("Failed to ensure directory:", dir, err);
    throw err;
  }
}

function slugifyForFolder(name = '') {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 200) || `untitled_${Date.now()}`;
}

async function cleanupFiles(filePaths) {
  for (const filePath of filePaths) {
    try {
      if (fsSync.existsSync(filePath)) {
        await fsPromises.unlink(filePath);
      }
    } catch (err) {
      console.warn("Failed to clean up temp file:", filePath, err.message);
    }
  }
}

function invalidateCache(keys = []) {
  invalidateDataCache(keys);
}

// Storage config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, "../images/uploads");
    if (!fsSync.existsSync(uploadPath)) {
      fsSync.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

/**
 * Step 1: Initiate Admin Login Pipeline (Send OTP only)
 * @route POST /api/admin/login
 * @access Public (rate-limited)
 */
exports.login = async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body.',
      });
    }

    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Look up admin profile
    const admin = await adminModel.getAdminByEmail(normalizedEmail);

    if (!admin || admin.status !== 'active') {
      logger.warn('Login attempt with invalid/inactive admin', { email: normalizedEmail });
      return res.status(401).json({
        success: false,
        message: "Invalid administrative credentials or inactive account status.",
      });
    }

    // Compare passwords
    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      logger.warn('Failed login attempt (wrong password)', { email: normalizedEmail });
      return res.status(401).json({
        success: false,
        message: "Invalid administrative credentials.",
      });
    }

    // Generate secure 6-digit OTP
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const ttlMs = 120000; // 2 minutes
    const createdAt = Date.now();

    // Store OTP in session/DB
    await adminModel.saveAuthChallenge(normalizedEmail, verificationCode, createdAt, ttlMs, 0);

    // Send OTP email
    const htmlPayload = `
      <div style="font-family: sans-serif; padding: 20px; max-width: 500px; border: 1px solid #eee; border-radius: 12px;">
        <h2 style="color: #1e293b; margin-bottom: 4px;">Security Verification Code</h2>
        <p style="color: #64748b; font-size: 14px; margin-top: 0;">A sign-in attempt was detected from your admin dashboard.</p>
        <div style="background-color: #fff7ed; border: 1px solid #ffedd5; border-radius: 8px; text-align: center; padding: 16px; margin: 24px 0;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #ea580c;">
            ${verificationCode}
          </span>
        </div>
        <p style="font-size: 12px; color: #94a3b8; margin-bottom: 0;">This code is valid for 2 minutes.</p>
      </div>
    `;

    let mailSent = false;
    await sendEmail({
      to: normalizedEmail,
      subject: "Admin 2FA Verification Code",
      html: htmlPayload,
    })
      .then(() => {
        mailSent = true;
      })
      .catch((err) => {
        logger.error('Failed to send 2FA email', err);
      });

    // Dev logging
    console.log(`\n🔑 [DEV] Admin 2FA Code for ${normalizedEmail}: ${verificationCode} (Sent: ${mailSent})\n`);

    // ✅ STEP 1: ONLY RETURN CHALLENGE DETAILS, NOT TOKENS YET
    return res.status(200).json({
      success: true,
      requiresVerification: true,
      message: 'Verification code sent to your email',
      createdAt,
      ttl: ttlMs,
      resendCount: 0,
    });
  } catch (err) {
    console.error("Login initiation error:", err);
    logger.error('Login error', err);
    return res.status(500).json({
      success: false,
      message: err.message || "An error occurred during login initialization.",
    });
  }
};

/**
 * Step 2: Verify OTP and Issue Tokens
 * @route POST /api/admin/verify
 * @access Public (rate-limited)
 */
exports.verifyAdminCode = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Missing email or OTP',
      });
    }

    if (otp.length !== 6 || isNaN(otp)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP format',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    logger.debug('Admin OTP verification attempt', { email: normalizedEmail });

    const challenge = await adminModel.getAuthChallenge(normalizedEmail);

    if (!challenge) {
      logger.warn('Admin verification failed: no challenge found', { email: normalizedEmail });
      return res.status(400).json({
        success: false,
        message: 'Authentication challenge expired or not found. Please login again.',
      });
    }

    // Verify OTP matches
    if (challenge.code !== otp) {
      logger.warn('Admin verification failed: invalid OTP', { email: normalizedEmail });
      const wrongAttemptCount = Number(challenge.resend_count || 0) + 1;
      
      if (wrongAttemptCount >= 3) {
        await adminModel.clearAuthChallenge(normalizedEmail);
        return res.status(429).json({ 
          success: false, 
          maxExceeded: true, 
          message: "Too many incorrect entries. Challenge session cancelled." 
        });
      }

      await adminModel.saveAuthChallenge(normalizedEmail, challenge.code, challenge.created_at, challenge.ttl, wrongAttemptCount);
      return res.status(401).json({ 
        success: false, 
        message: `Invalid security code. You have ${3 - wrongAttemptCount} attempts remaining.` 
      });
    }

    // Check OTP expiration (Fixed comparison: Evaluated strictly in milliseconds)
    const createdAt = new Date(challenge.created_at).getTime();
    const now = Date.now();
    const elapsedMs = now - createdAt;

    if (elapsedMs > Number(challenge.ttl)) {
      logger.warn('Admin verification failed: OTP expired', { email: normalizedEmail });
      await adminModel.clearAuthChallenge(normalizedEmail);
      return res.status(401).json({
        success: false,
        message: 'OTP expired. Please login again.',
      });
    }

    // Fetch administrative profile once
    const admin = await adminModel.getAdminByEmail(normalizedEmail);

    if (!admin) {
      logger.error('Admin not found during verification', { email: normalizedEmail });
      return res.status(500).json({
        success: false,
        message: 'Admin profile not found',
      });
    }

    const numericId = admin.admin_id ?? admin.id;

    // Create server session
    const newSession = await SessionService.createSession({
      userId: admin.admin_id || admin.id,
      deviceId: req.get('user-agent')?.substring(0, 100),
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    // Generate tokens linked directly to the newly registered session
    const { accessToken, refreshToken: newRefreshToken } = generateAccessAndRefreshToken({
      id: admin.admin_id || admin.id,
      sessionId: newSession.sessionId,
      isAdmin: true,
      role: 'admin',
    });

    // Clear OTP challenge now that authentication is completed
    await adminModel.clearAuthChallenge(normalizedEmail);

    // Set secure HTTP-only cookies
    cookieHelpers.setAccessTokenCookie(res, accessToken);
    cookieHelpers.setRefreshTokenCookie(res, newRefreshToken);

    logger.audit('ADMIN_LOGIN_SUCCESS', admin.admin_id || admin.id, {
      email: admin.email,
      sessionId: newSession.sessionId,
    });

    return res.status(200).json({
      success: true,
      message: 'Admin authenticated successfully',
      // ✅ Cookies are already set above (defense in depth), but the frontend's
      // AuthContext also persists the token client-side — it needs these in
      // the body or the whole session silently never populates.
      token: accessToken,
      refreshToken: newRefreshToken,
      admin: {
        id: admin.admin_id || admin.id,
        email: admin.email,
        name: admin.name,
        phone: admin.phone,
        role: 'admin',
      },
      // `user` mirrors `admin` — AuthContext reads `res.data.user`, not `res.data.admin`.
      user: {
        id: numericId,
        email: admin.email,
        name: admin.name,
        role: 'admin',
        isVerified: true, // admins are verified by definition (passed OTP 2FA)
      },
    });
  } catch (error) {
    logger.error('Admin verification error', error);
    return res.status(500).json({
      success: false,
      message: 'Verification failed. Please try again.',
    });
  }
};

/**
 * Admin Logout - Revoke Session & Tokens
 * @route POST /api/admin/logout
 * @access Protected
 */
exports.logout = async (req, res) => {
  try {
    const userId = req.user.id || req.user.admin_id;
    const refreshTokenCookie = req.cookies.refreshToken;

    // Blacklist refresh token
    if (refreshTokenCookie) {
      try {
        const decoded = jwt.decode(refreshTokenCookie);
        if (decoded && decoded.exp) {
          const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);
          await SessionService.blacklistRefreshToken(refreshTokenCookie, Math.max(expiresIn, 0));
        }
      } catch (decodeErr) {
        logger.warn('Failed to decode refresh token for blacklisting', decodeErr);
      }
    }

    logger.audit('ADMIN_LOGOUT', userId, {});

    // ✅ Clear cookies
    const cookieHelpers = setupSecureCookies();
    cookieHelpers.clearAuthCookies(res);

    // Clear cookies
    res.clearCookie('accessToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      path: '/',
    });
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      path: '/',
    });

    return res.status(200).json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    logger.error('Logout error', error);
    res.status(500).json({
      success: false,
      message: 'Logout failed',
    });
  }
};

/**
 * Refresh Access Token
 * @route POST /api/admin/refresh-token
 * @access Protected
 */
exports.refreshAccessToken = async (req, res) => {
  try {
    const refreshTokenCookie = req.cookies.refreshToken;

    if (!refreshTokenCookie) {
      logger.warn('Refresh token not found in cookies');
      return res.status(401).json({
        success: false,
        message: 'Refresh token not found',
      });
    }


    // Call refreshToken once and destructure result
    const { accessToken, refreshToken: newRefreshToken } = await refreshToken(refreshTokenCookie);

    const cookieHelpers = setupSecureCookies();
    cookieHelpers.setAccessTokenCookie(res, accessToken);
    cookieHelpers.setRefreshTokenCookie(res, newRefreshToken);

    // Set new cookies for backward compatibility
    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: 15 * 60 * 1000,
      path: '/',
    });

    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    logger.info('Admin token refreshed', { userId: req.user?.id });

    res.status(200).json({
      success: true,
      message: 'Token refreshed',
      accessToken,
    });
  } catch (error) {
    logger.error('Token refresh error', error);
    res.status(401).json({
      success: false,
      message: 'Token refresh failed',
    });
  }
};

/**
 * Step 3: Resend Verification Code
 * @route POST /api/admin/resend-code
 * @access Public (rate-limited)
 */
exports.resendAdminCode = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required.",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Lookup active challenge
    const challenge = await adminModel.getAuthChallenge(normalizedEmail);
    if (!challenge) {
      logger.warn('Resend attempted without active challenge', { email: normalizedEmail });
      return res.status(400).json({
        success: false,
        message: "No active verification session found. Please login again.",
      });
    }

    // Check resend limits
    const resendCount = Number(challenge.resend_count || 0) + 1;
    if (resendCount > 3) {
      await adminModel.clearAuthChallenge(normalizedEmail);
      logger.warn('Max resend attempts exceeded', { email: normalizedEmail });
      return res.status(429).json({
        success: false,
        maxExceeded: true,
        message: "Maximum resend attempts exceeded.",
      });
    }

    // Generate new code
    const newVerificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const ttlMs = 120000;
    const createdAt = Date.now();

    // Save updated challenge
    await adminModel.saveAuthChallenge(normalizedEmail, newVerificationCode, createdAt, ttlMs, resendCount);

    // Send email
    await sendEmail({
      to: normalizedEmail,
      subject: "Resent Admin Verification Code",
      html: `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 8px; max-width: 450px;">
          <h3 style="color: #334155;">Your new verification code:</h3>
          <h2 style="color: #ea580c; letter-spacing: 4px; font-size: 28px;">${newVerificationCode}</h2>
          <p style="font-size: 13px; color: #64748b;">Attempt ${resendCount} of 3. Code expires in 2 minutes.</p>
        </div>
      `,
    }).catch((err) => {
      logger.error('Failed to send resend email', err);
    });

    console.log(`\n🔄 [DEV] Resent 2FA Code: ${newVerificationCode} (Attempt ${resendCount})\n`);

    logger.audit('ADMIN_OTP_RESEND', normalizedEmail, { attempt: resendCount });

    return res.json({
      success: true,
      message: 'Verification code resent',
      resendCount,
    });
  } catch (err) {
    console.error("Resend code error:", err);
    logger.error('Resend code error', err);
    return res.status(500).json({
      success: false,
      message: "Failed to resend verification code.",
    });
  }
};

/**
 * Step 4: Cancel Active Challenge
 * @route POST /api/admin/cancel-challenge
 * @access Public
 */
exports.cancelAdminChallenge = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required.",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Clear challenge
    await adminModel.clearAuthChallenge(normalizedEmail);

    logger.audit('ADMIN_CHALLENGE_CANCELLED', normalizedEmail, {});

    return res.json({
      success: true,
      message: "Challenge cancelled successfully.",
    });
  } catch (err) {
    console.error("Cancel challenge error:", err);
    logger.error('Cancel challenge error', err);
    return res.status(500).json({
      success: false,
      message: "Failed to cancel challenge.",
    });
  }
};

/**
 * Get All Users
 * @route GET /api/admin/users/all
 * @access Protected (admin)
 */
exports.allUsers = async (req, res) => {
  try {
    if (!userModel || typeof userModel.allUsers !== 'function') {
      throw new Error("userModel not properly configured.");
    }

    const result = await userModel.allUsers();

    return res.json({
      success: true,
      users: result || [],
    });
  } catch (err) {
    console.error("allUsers error:", err.message);
    logger.error('Get all users error', err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch users.",
    });
  }
};

/**
 * Get User Details
 * @route GET /api/admin/user-details
 * @access Protected (admin)
 */
exports.userDetails = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized. User context missing.",
      });
    }

    const userId = req.user.id || req.user.user_id || req.user._id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Malformed user payload.",
      });
    }

    const result = await userModel.getUserDetails(userId);

    if (!result) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    return res.json({
      success: true,
      user: result,
    });
  } catch (err) {
    console.error("userDetails error:", err.message);
    logger.error('Get user details error', err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch user details.",
    });
  }
};

// ==============================
// BRANDS
// ==============================

/**
 * Create Brand
 * @route POST /api/admin/brands/create
 * @access Protected (admin)
 */
exports.createBrand = async (req, res) => {
  let tempImagePath = null;
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Brand name is required.',
      });
    }

    let iconUrl = null;

    // Handle file upload to Cloudinary
    if (req.file) {
      tempImagePath = req.file.path;

      const result = await cloudinary.uploader.upload(tempImagePath, {
        folder: 'brands',
        use_filename: true,
      });
      iconUrl = result.secure_url;
    }

    // Save to database
    const newBrand = await brandModel.createBrand({
      name,
      description,
      icon: iconUrl,
    });

    // Cleanup temp file
    if (tempImagePath) await fs.unlink(tempImagePath).catch(() => {});

    invalidateCache(['brands']);

    logger.audit('BRAND_CREATED', req.user.id, { brandId: newBrand.id, name });

    res.status(201).json({
      success: true,
      message: "Brand created successfully",
      brand: newBrand,
    });
  } catch (err) {
    if (tempImagePath) {
      await fs.unlink(tempImagePath).catch(() => {});
    }
    console.error("Create brand error:", err);
    logger.error('Create brand error', err);
    res.status(500).json({
      success: false,
      message: "Failed to create brand",
    });
  }
};

/**
 * Update Brand
 * @route PUT /api/admin/brands/update/:id
 * @access Protected (admin)
 */
exports.updateBrand = async (req, res) => {
  let tempImagePath = null;
  try {
    // ✅ FIX: Use 'id' from route params
    const { id } = req.params;
    const { name, description, active } = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Brand ID is required.',
      });
    }

    // Get existing brand
    const existingBrand = await brandModel.getBrandById(id);
    if (!existingBrand) {
      return res.status(404).json({
        success: false,
        message: "Brand not found",
      });
    }

    let iconUrl = existingBrand.icon;

    // Handle new image upload
    if (req.file) {
      tempImagePath = req.file.path;

      const result = await cloudinary.uploader.upload(tempImagePath, {
        folder: 'brands',
      });
      iconUrl = result.secure_url;

      // Delete old image from Cloudinary if exists
      if (existingBrand.icon && existingBrand.icon.includes('cloudinary')) {
        try {
          const publicId = existingBrand.icon
            .split('/')
            .pop()
            .split('.')[0];
          await cloudinary.uploader.destroy(`brands/${publicId}`);
        } catch (deleteErr) {
          logger.warn('Failed to delete old Cloudinary image', deleteErr);
        }
      }
    }

    // Update database
    const updatedBrand = await brandModel.updateBrand(id, {
      name,
      description,
      icon: iconUrl,
      ...(active !== undefined && { active: active === 'true' || active === true || active === 1 || active === '1' }),
    });

    // Cleanup temp file
    if (tempImagePath) await fs.unlink(tempImagePath).catch(() => {});

    invalidateCache(['brands']);

    logger.audit('BRAND_UPDATED', req.user.id, { brandId: id, name });

    res.json({
      success: true,
      message: "Brand updated successfully",
      brand: updatedBrand,
    });
  } catch (err) {
    if (tempImagePath) {
      await fs.unlink(tempImagePath).catch(() => {});
    }
    console.error("Update brand error:", err);
    logger.error('Update brand error', err);
    res.status(500).json({
      success: false,
      message: "Failed to update brand",
    });
  }
};

/**
 * Delete Brand
 * @route DELETE /api/admin/brands/delete/:id
 * @access Protected (admin)
 */
exports.deleteBrand = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Brand ID is required.',
      });
    }

    const brand = await brandModel.getBrandById(id);
    if (!brand) {
      return res.status(404).json({
        success: false,
        message: "Brand not found",
      });
    }

    // Delete image from Cloudinary if exists
    if (brand.icon && brand.icon.includes('cloudinary')) {
      try {
        const publicId = brand.icon.split('/').pop().split('.')[0];
        await cloudinary.uploader.destroy(`brands/${publicId}`);
      } catch (deleteErr) {
        logger.warn('Failed to delete Cloudinary image', deleteErr);
      }
    }

    // Delete from database
    await brandModel.deleteBrand(id);

    invalidateCache(['brands']);

    logger.audit('BRAND_DELETED', req.user.id, { brandId: id });

    res.json({
      success: true,
      message: "Brand deleted successfully",
    });
  } catch (err) {
    console.error("Delete brand error:", err);
    logger.error('Delete brand error', err);
    res.status(500).json({
      success: false,
      message: "Failed to delete brand",
    });
  }
};

/**
 * Get All Brands
 * @route GET /api/admin/brands
 * @access Protected (admin)
 */
exports.getBrands = async (req, res) => {
  try {
    const brands = await brandModel.getAllBrands();

    res.json({
      success: true,
      brands: brands || [],
    });
  } catch (err) {
    console.error("Get brands error:", err);
    logger.error('Get brands error', err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch brands",
    });
  }
};

/**
 * Get Brand by ID
 * @route GET /api/admin/brands/:id
 * @access Protected (admin)
 */
exports.getBrandById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Brand ID is required.',
      });
    }

    const brand = await brandModel.getBrandById(id);

    if (!brand) {
      return res.status(404).json({
        success: false,
        message: "Brand not found",
      });
    }

    res.json({
      success: true,
      brand,
    });
  } catch (err) {
    console.error("Get brand error:", err);
    logger.error('Get brand error', err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch brand",
    });
  }
};

// ==============================
// GALLERIES
// ==============================
exports.getGalleries = async (req, res) => {
  try {
    const galleries = await adminModel.getGalleries();
    res.json(galleries);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Error fetching categories." });
  }
};

// Fetch a single gallery with its current image list/count/thumbnail.
// Lets the frontend re-sync a gallery's authoritative state (e.g. right
// after an upload) instead of hand-patching counts locally.
exports.getGallery = async (req, res) => {
  try {
    const { id } = req.params;
    const gallery = await adminModel.getGalleryById(id);
    if (!gallery) return res.status(404).json({ error: "Gallery not found" });
    res.json({ success: true, gallery });
  } catch (err) {
    console.error("getGallery error:", err.message);
    res.status(500).json({ error: "Error fetching gallery." });
  }
};

/**
 * Uploads multiple images to the local 'images' folder without expecting any metadata.
 * Each image is given a unique filename if a collision is detected.
 *
 * @param {object} req - Express request object (must contain req.files from multer).
 * @param {object} res - Express response object.
 */
exports.uploadBulk = async (req, res) => {
  const tempFiles = [];
  try {
    const gallery_id = req.params.id || req.body.gallery_id;
    if (!gallery_id) return res.status(400).json({ error: "gallery_id is required" });

    console.log("uploadBulk initiating R2 storage pipeline. Gallery:", gallery_id, "Files payload count:", (req.files || []).length);

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    // Retain full reference tracking array for cleaning up local storage nodes later
    req.files.forEach(f => { if (f.path) tempFiles.push(f.path); });

    const results = [];

    // Process file transfers directly from local multi-part fields straight to Cloudflare
    for (const file of req.files) {
      console.log(`Processing media payload stream [${file.mimetype}] for file: ${file.originalname}`);
 
      // Upload directly to R2 — streams from disk, loads onto cloud storage, and unlinks file internally
      const { key, url, bytes } = await galleryStorage.uploadFromDisk({
        gallery_id,
        filePath:     file.path,
        originalname: file.originalname,
        mimetype:     file.mimetype,
      });
 
      results.push({
        r2_key: key,          // Parsed in database schema for presigned URLs & mutations
        url,                  // Accessible direct CDN fallback location link 
        name:   file.originalname,
        bytes,
      });
    }

    // Commit cleanly mapped image structural assets straight to database records
    await adminModel.addImagesToGallery(gallery_id, results);

    // Evacuate lingering local storage paths safely
    await cleanupFiles(tempFiles);
    invalidateCache(['galleries']);

    return res.json({ 
      success: true, 
      count: results.length, 
      files: results 
    });

  } catch (error) {
    console.error("CRITICAL ERROR: uploadBulk R2 pipeline failure:", error);
    // Always sweep disk files even during runtime operational faults
    await cleanupFiles(tempFiles).catch(() => {});
    return res.status(500).json({ error: error.message || "Bulk storage upload operations collapsed." });
  }
};

exports.createGallery = async (req, res) => {
  try {
    const { title, client, client_email, user_id, clientUserId, category, password, downloadable, notes, expires_at } = req.body;
    console.log(req.body)
    if (!title) return res.status(400).json({ error: "Gallery name is required" });

    // Generate a cryptographically secure, unguessable token
    const access_token = crypto.randomBytes(16).toString("hex");

    const gallery = await adminModel.createGallery({
      title, access_token, client, client_email,
      user_id: user_id || clientUserId || null,
      category,
      password: password || null,
      downloadable: downloadable !== 'false' && downloadable !== false,
      notes: notes || null,
      expires_at: expires_at || null,
      status: 'draft',
    });

    invalidateCache(['galleries']);
    return res.status(201).json({ success: true, gallery });
  } catch (err) {
    console.error("createGallery error:", err);
    res.status(500).json({ error: "Failed to create gallery" });
  }
};

exports.updateGallery = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body; // title, client, status, password, downloadable, notes, expires_at
    const gallery = await adminModel.updateGallery(id, updates);
    invalidateCache(['galleries']);
    return res.json({ success: true, gallery });
  } catch (err) {
    console.error("updateGallery error:", err);
    res.status(500).json({ error: "Failed to update gallery" });
  }
};
 
exports.deleteGallery = async (req, res) => {
  try {
    const { id } = req.params;
 
    // Fetch images so we can delete their R2 objects (and Cloudinary legacy ones)
    const images = await adminModel.getGalleryImages(id);
 
    // ── Delete R2 objects (new uploads) ──
    const r2Keys = images.map(img => img.r2_key).filter(Boolean);
    await galleryStorage.bulkDeleteFromR2(r2Keys);
 
    // ── Delete legacy Cloudinary objects (images uploaded before migration) ──
    const legacyCloudinaryIds = images
      .filter(img => !img.r2_key && img.public_id)
      .map(img => img.public_id);
 
    for (const pid of legacyCloudinaryIds) {
      await cloudinary.uploader.destroy(pid).catch(e =>
        console.warn("Legacy Cloudinary delete failed for", pid, e.message)
      );
    }
 
    // ── Delete from DB (cascades to gallery_images and revision_requests) ──
    await adminModel.deleteGallery(id);
    invalidateCache(['galleries']);
 
    return res.json({ success: true });
  } catch (err) {
    console.error("deleteGallery error:", err);
    res.status(500).json({ error: "Failed to delete gallery" });
  }
};
 
exports.relockGallery = async (req, res) => {
  try {
    await adminModel.relockGallery(req.params.id);
    invalidateCache(['galleries']);
    return res.json({ success: true });
  } catch (err) {
    console.error("relockGallery error:", err);
    res.status(500).json({ error: "Failed to lock gallery" });
  }
};

exports.deleteGalleryImage = async (req, res) => {
  try {
    const { gallery_id, image_id } = req.params;
    const image = await adminModel.getImageById(image_id);
    if (!image) return res.status(404).json({ error: "Image not found" });
 
    if (image.r2_key) {
      // New upload → delete from R2
      await galleryStorage.deleteFromR2(image.r2_key);
    } else if (image.public_id) {
      // Legacy Cloudinary upload → delete from Cloudinary
      await cloudinary.uploader.destroy(image.public_id).catch(e =>
        console.warn("Legacy Cloudinary delete failed", e.message)
      );
    }
 
    await adminModel.deleteGalleryImage(image_id);
    invalidateCache(['galleries']);
 
    return res.json({ success: true });
  } catch (err) {
    console.error("deleteGalleryImage error:", err);
    res.status(500).json({ error: "Failed to delete image" });
  }
};

exports.uploadImage = (req, res) => {
  const image = req.file;
  if (!image) {
    return res.status(400).send("No file uploaded or file type not allowed");
  }

  const dir = path.join(__dirname, '../images');
  // Create the images directory if it doesn't exist
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }

  // Define the path where the image will be saved
  const filePath = path.join(dir, image.originalname);

  // Move the file to the desired location
  fs.rename(image.path, filePath, (err) => {
    if (err) {
      console.error(err);
      return res.status(500).send("Error saving image.");
    } else {
      return res.status(200).json({ message: "Image uploaded successfully", filePath });
    }
  });
};

// Send gallery link + email to client
// Send gallery link + email to client
exports.sendGallery = async (req, res) => {
  try {
    const { gallery_id, email, message, password, clearPassword } = req.body;
    if (!gallery_id || !email) {
      return res.status(400).json({ error: "gallery_id and email are required" });
    }
 
    const gallery = await adminModel.getGalleryById(gallery_id);
    if (!gallery) return res.status(404).json({ error: "Gallery not found" });
 
    const SITE_URL = process.env.FRONTEND_URL || process.env.WEBSITE_URL || 'http://localhost:5173';
    
    // Append the unguessable public access token to the route query so clients bypass account logs
    const galleryLink = `${SITE_URL}/gallery/public/${gallery.access_token}`;
    
    const passwordLine = password
      ? `<p style="margin:8px 0;"><strong>Gallery Password:</strong> <code>${password}</code></p>`
      : '';
 
    const images = await galleryStorage.resolveGalleryUrls(gallery.images || [], true, 604800);
    const previewHtml = images.slice(0, 4).map(img =>
      `<img src="${img.url}" alt="preview" style="width:140px;height:100px;object-fit:cover;border-radius:6px;margin:4px;" />`
    ).join('');
 
    const html = `
      <div style="font-family:sans-serif;max-width:620px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px;">
        <h2 style="color:#10b981;margin-bottom:16px;">📸 Your Gallery is Ready!</h2>
        <p style="color:#374151;line-height:1.6;">
          ${message || `Hi ${gallery.client || 'there'},<br><br>Your photography gallery is ready to view and download.`}
        </p>
        ${passwordLine}
        ${previewHtml ? `<div style="margin:20px 0;text-align:center;">${previewHtml}</div>` : ''}
        <p style="margin:24px 0;text-align:center;">
          <a href="${galleryLink}" style="display:inline-block;padding:14px 28px;background:#10b981;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px;">
            View Full Gallery →
          </a>
        </p>
      </div>
    `;
 
    await sendEmail({ to: email.trim().toLowerCase(), subject: `Your Gallery is Ready — ${gallery.title || 'LaUnit Gallery'}`, html });
 
    const normalizedEmail  = email.trim().toLowerCase();
    const resolvedUserId   = await adminModel.getUserIdByEmail(normalizedEmail);
 
    // NOTE: previously this hashed `password` here AND adminModel.updateGallery
    // hashed it again on the way into the DB — a hash-of-a-hash that can never
    // match the real password again with bcrypt.compare(). updateGallery is
    // the single place that hashes; this just passes the plaintext through,
    // and only when a genuinely new password was actually submitted (an
    // empty/missing password here means "keep whatever's already set").
    await adminModel.updateGallery(gallery_id, {
      status:       'delivered',
      client_email: normalizedEmail,
      ...(resolvedUserId ? { user_id: resolvedUserId } : {}),
      ...(clearPassword ? { password: null } : password ? { password } : {}),
    });
 
    if (typeof invalidateCache === 'function') invalidateCache(['galleries']);
    return res.json({ success: true, message: "Gallery sent successfully" });
  } catch (err) {
    console.error("sendGallery error:", err);
    res.status(500).json({ error: "Failed to send gallery" });
  }
};
 
// Client re-edit request
exports.submitRevision = async (req, res) => {
  try {
    const { gallery_id } = req.params;
    const { note, client_name, client_email } = req.body;
    if (!note) return res.status(400).json({ error: "Revision note is required" });
 
    const revision = await adminModel.createRevisionRequest({
      gallery_id, note,
      client_name: client_name || 'Client',
      client_email: client_email || '',
    });
 
    // Update gallery status to 'revision' so admin sees the alert
    await adminModel.updateGallery(gallery_id, { status: 'revision' });
    invalidateCache(['galleries']);
 
    // Notify admin by email
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });
    await transporter.sendMail({
      from: `"LaUnit Creatives" <${process.env.EMAIL_USER}>`,
      to: process.env.ADMIN_EMAIL || 'info@launit.com',
      subject: `Re-edit Request — Gallery ${gallery_id}`,
      html: `
        <p><strong>Client:</strong> ${client_name} (${client_email})</p>
        <p><strong>Gallery ID:</strong> ${gallery_id}</p>
        <p><strong>Request:</strong></p>
        <blockquote style="border-left:3px solid #e11d48;padding-left:12px;color:#444">${note}</blockquote>
      `,
    }).catch(e => console.warn("Revision email notify failed:", e.message));
 
    return res.status(201).json({ success: true, revision });
  } catch (err) {
    console.error("submitRevision error:", err);
    res.status(500).json({ error: "Failed to submit revision request" });
  }
};
 
exports.getPendingRevisions = async (req, res) => {
  try {
    const revisions = await adminModel.getPendingRevisions();
    return res.json({ success: true, revisions });
  } catch (err) {
    console.error("getPendingRevisions error:", err.message);
    res.status(500).json({ error: "Failed to fetch pending revisions" });
  }
};

exports.getRevisions = async (req, res) => {
  try {
    const { gallery_id } = req.params;
    const revisions = await adminModel.getRevisionsByGallery(gallery_id);
    return res.json({ success: true, revisions });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch revisions" });
  }
};
 
exports.resolveRevision = async (req, res) => {
  try {
    const { revision_id } = req.params;
    const { action } = req.body; // 'approve' | 'reject'
    await adminModel.resolveRevision(revision_id, action);
    return res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to resolve revision" });
  }
};

// ==============================
// CATEGORIES
// ==============================
exports.getCategories = async (req, res) => {
  try {
    const categories = await adminModel.getCategories();
    res.json(categories);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Error fetching categories." });
  }
};
 
exports.addCategory = async (req, res) => {
  try {
    const { name, service_id, description } = req.body;
 
    if (!name || !service_id) {
      return res.status(400).json({ error: "Category name and service are required." });
    }
 
    const newCategory = await adminModel.createCategory({ name, service_id, description });
    res.json(newCategory);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Error adding category." });
  }
};
 
exports.updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, service_id, description } = req.body;
    const updatedCategory = await adminModel.updateCat(id, { name, service_id, description });
    res.json(updatedCategory);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Error updating category." });
  }
};
 
exports.deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;
    await adminModel.deleteCategory(id);
    res.json({ message: "Category deleted successfully." });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Error deleting category." });
  }
};
 
// ==============================
// PACKAGES
// ==============================
exports.getPackages = async (req, res) => {
  try {
    const packages = await adminModel.getPackages();
    res.json(packages);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Error fetching packages." });
  }
};
 
exports.addPackage = async (req, res) => {
  try {
    const { category_id, packages } = req.body;
 
    if (!category_id || !Array.isArray(packages) || packages.length === 0) {
      return res.status(400).json({ error: "Category and at least one package are required." });
    }
 
    const createdPackages = [];
 
    for (const pkg of packages) {
      const { name, description, price, duration, features } = pkg;
 
      if (!name || !price) {
        return res.status(400).json({ error: "Each package requires a name and price." });
      }
 
      const formattedFeatures = Array.isArray(features) ? features : [];
 
      const newPackage = await adminModel.createPackage({
        category_id,
        name,
        description: description || "",
        price: parseFloat(price),
        duration: duration || null,
        features: formattedFeatures,
      });
 
      createdPackages.push(newPackage);
    }
 
    res.json({
      message: "Packages created successfully",
      packages: createdPackages,
    });
  } catch (err) {
    console.error("addPackage error:", err.message);
    res.status(500).json({ error: "Error adding package(s)." });
  }
};
 
exports.updatePackage = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, price, duration, features } = req.body;
 
    if (!id) {
      return res.status(400).json({ error: "Package ID is required." });
    }
 
    const formattedFeatures = Array.isArray(features) ? features : [];
 
    const updatedPackage = await adminModel.updatePackage(id, {
      name,
      description: description || "",
      price: parseFloat(price),
      duration: duration || null,
      features: formattedFeatures,
    });
 
    res.json({
      message: "Package updated successfully",
      package: updatedPackage,
    });
  } catch (err) {
    console.error("updatePackage error:", err.message);
    res.status(500).json({ error: "Error updating package." });
  }
};
 
exports.deletePackage = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: "Package ID is required." });
 
    await adminModel.deletePackage(id);
    res.json({ message: "Package deleted successfully." });
  } catch (err) {
    console.error("deletePackage error:", err.message);
    res.status(500).json({ error: "Error deleting package." });
  }
};

// ==============================
// GENRES
// ==============================
exports.getGenres = async (req, res) => {
  try {
    const genres = await adminModel.getGenres();
    res.json(genres);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Error fetching genres." });
  }
};

exports.addGenre = async (req, res) => {
  try {
    const { title, description } = req.body;
    const newGenre = await adminModel.createGenre({ title, description });
    res.json(newGenre);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Error adding genre." });
  }
};

// Update a genre
exports.updateGenre = async (req, res) => {
  try {
    const { genre_id } = req.params;
    if (!genre_id) return res.status(400).json({ error: "Genre ID is required" });

    const { title, description } = req.body;

    // Validate input
    if (!title) {
      return res.status(400).json({ error: "Genre title is required" });
    }

    // Get existing genre
    const existingGenre = await adminModel.getGenreById(genre_id);
    if (!existingGenre) {
      return res.status(404).json({ error: "Genre not found" });
    }

    // Update genre
    const updatedGenre = await adminModel.updateGenre(genre_id, { title, description });

    res.json({
      message: "Genre updated successfully",
      genre: updatedGenre,
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Error updating genre." });
  }
};

// Delete a genre
exports.deleteGenre = async (req, res) => {
  try {
    const { genre_id } = req.params;

    // Get existing genre
    const existingGenre = await adminModel.getGenreById(genre_id);
    if (!existingGenre) {
      return res.status(404).json({ error: "Genre not found" });
    }

    // Delete genre
    await adminModel.deleteGenre(genre_id);

    res.json({
      message: "Genre deleted successfully",
      genre: existingGenre, // optionally return the deleted genre
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Error deleting genre." });
  }
};

module.exports = exports;