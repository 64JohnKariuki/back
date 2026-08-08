// middleware/securityMiddleware.js - CORRECTED
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const csrf = require('csurf');
const logger = require('../services/logger');
const crypto = require('crypto');

require('dotenv').config({
  path: process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development'
});

/**
 * ✅ HELMET: Set secure HTTP headers
 */
const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net'],
      styleSrc: ["'self'", "'unsafe-inline'", 'fonts.googleapis.com'],
      fontSrc: ["'self'", 'fonts.gstatic.com'],
      connectSrc: ["'self'", 'api.intasend.com', 'sandbox.intasend.com'],
      frameSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      objectSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  frameguard: { action: 'deny' },
  xssFilter: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  noSniff: true,
});

// ==================== CSRF SETUP ====================

/**
 * ✅ CSRF Protection (cookie-based, not session-based)
 * Only validates on state-changing requests
 */
const csrfProtection = csrf({
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 2 * 60 * 60 * 1000, // 2 hours
    domain: process.env.COOKIE_DOMAIN || undefined,
  },
});

/**
 * ✅ Generate CSRF token for every request
 * Middleware that creates a new token if needed
 */
const generateCsrfToken = (req, res, next) => {
  // Only generate token for GET requests (safe to expose)
  if (req.method === 'GET') {
    try {
      const token = req.csrfToken ? req.csrfToken() : null;
      res.locals.csrfToken = token;
      res.set('X-CSRF-Token', token || '');
    } catch (err) {
      logger.warn('CSRF token generation failed (non-critical)', { error: err.message });
    }
  }
  next();
};

/**
 * ✅ Smart CSRF validation - only on state-changing methods
 * Exclude public endpoints like login, register, social-login
 */
const validateCsrf = (req, res, next) => {
  // ✅ Exempt public/auth endpoints entirely (no CSRF cookie/token needed before login)
  const exemptPaths = [
    '/api/users/register',
    '/api/users/login',
    '/api/users/social-login',
    '/api/users/refresh-token',
    '/api/users/contact',
    '/api/users/emergency',
    '/api/users/subscribe',
    '/api/admin/login',
    '/api/admin/verify',
    '/api/admin/resend-code',
    '/api/admin/cancel-challenge',
    '/api/booking/payment/callback', // ✅ Webhook - verify via signature instead
    '/api/data/galleries/token', // ✅ Public gallery access
  ];

  // ✅ Check if path matches exempt list
  const isExempt = exemptPaths.some(path => 
    req.path === path || req.path.startsWith(path)
  );

  if (isExempt) {
    logger.debug('CSRF check skipped for exempt path', { path: req.path, method: req.method });
    return next();
  }

  // ✅ Skip CSRF in development if disabled
  if (process.env.NODE_ENV === 'development' && process.env.DISABLE_CSRF === 'true') {
    logger.warn('CSRF validation disabled (development only)', { path: req.path });
    return next();
  }

  // ✅ Always run csrfProtection — including on GET — so the secret cookie and
  // req.csrfToken() actually get established. csurf's own default
  // ignoreMethods (GET/HEAD/OPTIONS) already skips *validation* for safe
  // methods internally, so this doesn't block reads; it just means a token
  // can now actually be minted and handed to the frontend on a GET, instead
  // of every request silently having no CSRF token to send back on writes.
  csrfProtection(req, res, (err) => {
    if (err) {
      logger.warn('CSRF validation failed', {
        ip: req.ip,
        endpoint: req.path,
        method: req.method,
        error: err.message,
      });
      return res.status(403).json({
        success: false,
        message: 'Invalid or missing CSRF token. Please refresh and try again.',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined,
      });
    }

    // ✅ On safe (GET) requests, hand the freshly-established token back to
    // the frontend so it has something to send on the next write.
    if (req.method === 'GET' && req.csrfToken) {
      try {
        const token = req.csrfToken();
        res.locals.csrfToken = token;
        res.set('X-CSRF-Token', token);
      } catch (tokenErr) {
        logger.warn('CSRF token issuance failed (non-critical)', { error: tokenErr.message });
      }
    }

    next();
  });
};

// ==================== RATE LIMITERS ====================

const refreshTokenLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30,
  message: {
    success: false,
    message: 'Too many token refresh attempts from this IP, please try again after an hour.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV === 'development',
  handler: (req, res) => {
    logger.warn('Rate limit exceeded: Token Refresh', { ip: req.ip });
    res.status(429).json({
      success: false,
      message: 'Too many token refresh attempts. Please try again in 1 hour.',
    });
  },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: 'Too many authentication attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV === 'development',
  handler: (req, res) => {
    logger.warn('Rate limit exceeded: Authentication', { ip: req.ip, endpoint: req.path });
    res.status(429).json({
      success: false,
      message: 'Too many attempts. Please try again in 15 minutes.',
    });
  },
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100,
  message: 'Too many requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV === 'development',
  handler: (req, res) => {
    logger.warn('Rate limit exceeded: API', { ip: req.ip, endpoint: req.path });
    res.status(429).json({
      success: false,
      message: 'Rate limit exceeded. Please try again later.',
    });
  },
});

const paymentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: 'Too many payment attempts. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV === 'development',
  handler: (req, res) => {
    logger.warn('Rate limit exceeded: Payment', {
      ip: req.ip,
      userId: req.user?.id,
    });
    res.status(429).json({
      success: false,
      message: 'Too many payment attempts. Please try again in 1 hour.',
    });
  },
});

// ==================== INPUT SANITIZATION ====================

const sanitizeInputs = (req, res, next) => {
  // ✅ Prevent NoSQL injection
  if (req.body) mongoSanitize.sanitize(req.body);
  if (req.query) mongoSanitize.sanitize(req.query);
  if (req.params) mongoSanitize.sanitize(req.params);

  // ✅ Clean string values
  const cleanString = (str) => {
    if (typeof str !== 'string') return str;
    return str
      .trim()
      .slice(0, 5000)
      .replace(/[<>]/g, ''); // Remove brackets
  };

  // ✅ Clean query params
  if (req.query && typeof req.query === 'object') {
    Object.keys(req.query).forEach(key => {
      req.query[key] = cleanString(req.query[key]);
    });
  }

  // ✅ Clean body params
  if (req.body && typeof req.body === 'object') {
    Object.keys(req.body).forEach(key => {
      req.body[key] = cleanString(req.body[key]);
    });
  }

  next();
};

// ==================== CACHE CONTROL ====================

const noCacheHeaders = (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Vary', 'Accept-Encoding, Authorization');
  next();
};

const secureCacheHeaders = (req, res, next) => {
  res.set({
    'Cache-Control': 'public, max-age=3600, must-revalidate, s-maxage=7200',
    'ETag': `"${Date.now()}"`,
    'Vary': 'Accept-Encoding',
  });
  next();
};

// ==================== AUDIT LOGGING ====================

const auditLog = (action) => (req, res, next) => {
  const originalJson = res.json;
  res.json = function(data) {
    logger.audit(action, req.user?.id || 'anonymous', {
      method: req.method,
      path: req.path,
      ip: req.ip,
      statusCode: res.statusCode,
      success: data?.success !== false,
    });
    return originalJson.call(this, data);
  };
  next();
};

module.exports = {
  securityHeaders,
  csrfProtection,
  generateCsrfToken,
  validateCsrf, // ✅ NEW - Smart validation
  authLimiter,
  refreshTokenLimiter,
  apiLimiter,
  paymentLimiter,
  sanitizeInputs,
  noCacheHeaders,
  secureCacheHeaders,
  auditLog,
};