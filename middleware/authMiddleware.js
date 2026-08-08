// middleware/authMiddleware.js - UPDATED
const jwt = require('jsonwebtoken');
const User = require('../models/userModel');
const Admin = require('../models/adminModel');
const SessionService = require('../services/sessionService');
const logger = require('../services/logger');
require('dotenv').config({
  path: process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development'
});

const ACCESS_SECRET = process.env.JWT_SECRET_KEY_ACCESS_TOKEN;
const REFRESH_SECRET = process.env.JWT_SECRET_KEY_REFRESH_TOKEN;

if (!ACCESS_SECRET || !REFRESH_SECRET) {
  throw new Error('❌ FATAL: JWT secrets not configured');
}

// ==================== TOKEN GENERATION ====================

/**
 * Generate secure access and refresh token pair
 */
exports.generateAccessAndRefreshToken = (payload) => {
  const tokenPayload = {
    id: payload.id || payload.userId,
    sessionId: payload.sessionId, // ✅ Link token to session
    isAdmin: payload.isAdmin || false,
    role: payload.role || 'user',
    iat: Math.floor(Date.now() / 1000),
  };

  const accessToken = jwt.sign(tokenPayload, ACCESS_SECRET, {
    expiresIn: '15m',
    algorithm: 'HS256',
    issuer: 'photography-api',
    audience: 'photography-app',
  });

  const refreshToken = jwt.sign(tokenPayload, REFRESH_SECRET, {
    expiresIn: '7d',
    algorithm: 'HS256',
    issuer: 'photography-api',
    audience: 'photography-app',
  });

  return { accessToken, refreshToken };
};

// ==================== TOKEN VERIFICATION ====================

/**
 * Verify access token with session validation
 */
exports.verifyToken = async (token) => {
  return new Promise((resolve, reject) => {
    jwt.verify(token, ACCESS_SECRET, async (err, decoded) => {
      if (err) {
        return reject(err);
      }

      // ✅ VALIDATE SESSION
      if (decoded.sessionId) {
        const session = await SessionService.validateSession(decoded.sessionId);
        if (!session) {
          return reject(new Error('Session invalid or expired'));
        }
        // ✅ Update activity
        await SessionService.updateSessionActivity(decoded.sessionId);
      }

      resolve(decoded);
    });
  });
};

/**
 * Refresh token with rotation and blacklisting
 */
exports.refreshToken = async (token) => {
  try {
    // ✅ Check blacklist first
    const isBlacklisted = await SessionService.isTokenBlacklisted(token);
    if (isBlacklisted) {
      throw new Error('Token has been revoked');
    }

    return new Promise((resolve, reject) => {
      jwt.verify(token, REFRESH_SECRET, async (err, decoded) => {
        if (err) {
          return reject(err);
        }

        try {
          // ✅ Blacklist old token immediately
          const decodedExpiry = decoded.exp - Math.floor(Date.now() / 1000);
          await SessionService.blacklistRefreshToken(token, Math.max(decodedExpiry, 0));

          // ✅ Issue new pair with same session ID
          const newTokens = exports.generateAccessAndRefreshToken({
            id: decoded.id,
            role: decoded.role,
            isAdmin: decoded.isAdmin,
            sessionId: decoded.sessionId, // ✅ Preserve session
          });

          logger.info('Token pair rotated', {
            userId: decoded.id,
            sessionId: decoded.sessionId,
          });
          resolve(newTokens);
        } catch (error) {
          reject(error);
        }
      });
    });
  } catch (error) {
    throw error;
  }
};

// ==================== COOKIE EXTRACTION ====================

/**
 * Extract token from Bearer header or HttpOnly cookie
 * ✅ Prefers httpOnly cookie (more secure)
 */
const extractToken = (req) => {
  // ✅ First try httpOnly cookie (most secure)
  if (req.cookies?.accessToken) {
    return req.cookies.accessToken;
  }

  // ⚠️ Fallback to Bearer header (less secure but acceptable)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  return null;
};

// ==================== MIDDLEWARE ====================

/**
 * Required authentication middleware
 */
exports.requireAuth = async (req, res, next) => {
  const token = extractToken(req);

  if (!token) {
    logger.warn('Access attempt without token', { ip: req.ip, path: req.path });
    return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
  }

  try {
    const decoded = await exports.verifyToken(token);
    let currentUser;

    if (decoded.isAdmin) {
      const admin = await Admin.getAdminById(decoded.id);
      if (!admin) {
        logger.warn('Access attempt with invalid/missing admin', { adminId: decoded.id });
        return res.status(401).json({ success: false, message: 'Access denied. Admin not found.' });
      }
      currentUser = { ...admin, id: admin.admin_id ?? admin.id, role: admin.role || 'admin', isAdmin: true };
    } else {
      const result = await User.findById(decoded.id);
      if (!result.success || !result.user || Number(result.user.active) === 0) {
        logger.warn('Access attempt with invalid/inactive user', { userId: decoded.id });
        return res.status(401).json({ success: false, message: 'Access denied. User not found or inactive.' });
      }
      currentUser = { ...result.user, id: result.user.user_id ?? result.user.id, role: 'client', isAdmin: false };
    }

    req.user = currentUser;
    req.user.sessionId = decoded.sessionId;
    next();
  } catch (err) {
    const message = err.name === 'TokenExpiredError' ? 'Access denied. Token expired.' : 'Access denied. Invalid token.';
    logger.warn(message, { error: err.message });
    return res.status(401).json({ success: false, message });
  }
};

exports.authenticate = exports.requireAuth;

/**
 * Optional authentication (doesn't fail if no token)
 */
exports.optionalAuth = async (req, res, next) => {
  try {
    const token = extractToken(req);

    if (token) {
      try {
        const decoded = await exports.verifyToken(token);

        if (decoded.isAdmin) {
          const admin = await Admin.getAdminById(decoded.id);
          if (admin) {
            req.user = { ...admin, id: admin.admin_id ?? admin.id, role: admin.role || 'admin', isAdmin: true, sessionId: decoded.sessionId };
          }
        } else {
          const result = await User.findById(decoded.id);
          if (result.success && result.user && Number(result.user.active) !== 0) {
            req.user = { ...result.user, id: result.user.user_id ?? result.user.id, role: 'client', isAdmin: false, sessionId: decoded.sessionId };
          }
        }
      } catch (jwtError) {
        logger.warn('Invalid token in optional auth', { error: jwtError.name });
      }
    }
    next();
  } catch (error) {
    logger.error('Optional auth middleware error', error);
    next();
  }
};

/**
 * Admin-only middleware
 */
exports.requireAdmin = async (req, res, next) => {
  await exports.requireAuth(req, res, () => {
    if (!req.user.isAdmin && req.user.role !== 'admin') {
      logger.warn('Unauthorized admin access attempt', {
        userId: req.user.id,
      });
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin privileges required.',
      });
    }
    next();
  });
};

/**
 * Ownership or admin check
 */
exports.ownershipOrAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Access denied. Authentication required.',
    });
  }

  if (req.user.role === 'admin' || req.user.isAdmin) {
    return next();
  }

  const resourceUserId = req.params.userId || req.body.userId || req.params.id;
  const currentUserId = req.user._id || req.user.id || req.user.user_id;

  if (
    resourceUserId &&
    currentUserId &&
    resourceUserId.toString() === currentUserId.toString()
  ) {
    return next();
  }

  logger.warn('Unauthorized resource access attempt', {
    userId: currentUserId,
    resourceId: resourceUserId,
  });

  return res.status(403).json({
    success: false,
    message: 'Access denied. You can only access your own resources.',
  });
};