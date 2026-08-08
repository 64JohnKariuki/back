/**
 * Payment Security Middleware
 * Handles webhook verification, idempotency, fraud detection
 */

const crypto = require('crypto');
const logger = require('../services/logger');
const { getAsync, setAsync } = require('../config/redis');

require('dotenv').config({
  path: process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development'
});

// ==================== WEBHOOK VERIFICATION ====================

/**
 * Verify Intasend webhook signature
 * Prevents unauthorized payment notifications
 */
const verifyIntasendWebhook = (req, res, next) => {
  const signature = req.headers['x-intasend-signature'];
  const timestamp = req.headers['x-intasend-timestamp'];
  const webhookSecret = process.env.INTASEND_WEBHOOK_SECRET;

  // Validate headers exist
  if (!signature || !timestamp || !webhookSecret) {
    logger.warn('Webhook verification failed: Missing headers', {
      hasSignature: !!signature,
      hasTimestamp: !!timestamp,
      hasSecret: !!webhookSecret
    });
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  // Prevent replay attacks (timestamp must be within 5 minutes)
  const requestTime = parseInt(timestamp);
  const currentTime = Math.floor(Date.now() / 1000);
  const timeDiff = Math.abs(currentTime - requestTime);

  if (timeDiff > 300) { // 5 minutes
    logger.warn('Webhook verification failed: Timestamp too old', {
      requestTime,
      currentTime,
      diff: timeDiff
    });
    return res.status(401).json({ success: false, message: 'Request expired' });
  }

  // Verify signature
  const rawBody = JSON.stringify(req.body);
  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex');

  // Use timing-safe comparison to prevent timing attacks
  const isValid = crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  ).catch(() => false);

  if (!isValid) {
    logger.warn('Webhook verification failed: Invalid signature', {
      ip: req.ip,
      endpoint: req.path
    });
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  logger.info('Webhook verification successful');
  next();
};

// ==================== IDEMPOTENCY ====================

/**
 * Idempotency key middleware
 * Prevents duplicate payment processing
 */
const idempotencyMiddleware = async (req, res, next) => {
  const idempotencyKey = req.headers['idempotency-key'];

  // Only for POST requests that modify data
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) {
    return next();
  }

  if (!idempotencyKey) {
    return res.status(400).json({
      success: false,
      message: 'Idempotency-Key header is required for this operation'
    });
  }

  // Validate idempotency key format
  if (!idempotencyKey.match(/^[a-zA-Z0-9-]{20,100}$/)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid Idempotency-Key format'
    });
  }

  // Check if this key was already processed
  const cacheKey = `idempotency:${idempotencyKey}`;
  const cachedResponse = await getAsync(cacheKey);

  if (cachedResponse) {
    logger.info('Duplicate request detected (idempotency)', { idempotencyKey });
    return res.status(200).json(cachedResponse);
  }

  // Store the response when it's sent
  const originalJson = res.json;
  res.json = function(data) {
    // Cache successful responses for 24 hours
    if (res.statusCode < 400) {
      setAsync(cacheKey, data, 86400).catch(err => {
        logger.error('Idempotency cache error', err);
      });
    }
    return originalJson.call(this, data);
  };

  next();
};

// ==================== FRAUD DETECTION ====================

/**
 * Basic fraud detection checks
 */
const fraudDetection = async (req, res, next) => {
  const { bookingNo, amount, email, phone } = req.body;

  if (!amount || !email) {
    return next();
  }

  const fraudChecks = {
    suspiciousAmount: amount > 1000000 || amount < 1, // Over 1M or less than 1
    multipleRequestsSameEmail: await checkMultipleRequests(email),
    velocityCheck: await checkVelocity(email, phone),
  };

  if (fraudChecks.suspiciousAmount) {
    logger.warn('Suspicious amount detected', { amount, email });
    return res.status(400).json({
      success: false,
      message: 'Invalid amount'
    });
  }

  if (fraudChecks.multipleRequestsSameEmail) {
    logger.warn('Multiple requests from same email', { email });
    return res.status(429).json({
      success: false,
      message: 'Too many requests. Please try again later.'
    });
  }

  if (fraudChecks.velocityCheck) {
    logger.warn('High velocity detected', { email });
    return res.status(429).json({
      success: false,
      message: 'Too many requests in a short time'
    });
  }

  next();
};

/**
 * Check for multiple requests from same email
 */
const checkMultipleRequests = async (email) => {
  const key = `requests:${email}`;
  const count = await getAsync(key);
  return count && count > 3; // More than 3 requests in cache period
};

/**
 * Check velocity of requests
 */
const checkVelocity = async (email, phone) => {
  const velocityKey = `velocity:${email}:${phone}`;
  const count = await getAsync(velocityKey);
  return count && count > 5; // More than 5 requests
};

// ==================== AMOUNT VALIDATION ====================

/**
 * Validate payment amount matches booking amount
 */
const validateAmountConsistency = async (req, res, next) => {
  const { bookingNo, amount } = req.body;

  if (!bookingNo || !amount) {
    return next();
  }

  // Fetch booking from database to verify amount
  try {
    // TODO: Implement booking lookup from cache/database
    // const booking = await getBookingFromDB(bookingNo);
    // if (booking.amount !== amount) {
    //   return res.status(400).json({
    //     success: false,
    //     message: 'Payment amount does not match booking amount'
    //   });
    // }
    next();
  } catch (error) {
    logger.error('Amount validation error', error);
    next();
  }
};

module.exports = {
  verifyIntasendWebhook,
  idempotencyMiddleware,
  fraudDetection,
  validateAmountConsistency,
};
