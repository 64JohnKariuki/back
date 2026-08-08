// server.js - CORRECTED
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const path = require('path');
const moment = require('moment');
const logger = require('./services/logger');

require('dotenv').config({
  path: process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development'
});

const app = express();
const PORT = process.env.PORT || 8000;

// ==============================
// Security Middleware (CORRECT ORDER)
// ==============================
const {
  securityHeaders,
  authLimiter,
  apiLimiter,
  paymentLimiter,
  sanitizeInputs,
  generateCsrfToken,
  validateCsrf,
} = require('./middleware/securityMiddleware');
const setupSecureCookies = require('./middleware/cookieMiddleware');

// 1️⃣ Security headers first
app.use(securityHeaders);

// 2️⃣ Cookie parser
app.use(cookieParser());

// 3️⃣ Setup cookie helpers
const cookieHelpers = setupSecureCookies(app);
app.use(cookieHelpers.enforceSecureCookies);

// ==============================
// Logging & Parsing
// ==============================
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined'));
}
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ==============================
// CORS Configuration
// ==============================
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim())
  : ['http://localhost:3000', 'http://localhost:5173'];

const corsOptions = {
  origin: corsOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  exposedHeaders: ['X-CSRF-Token'],
  maxAge: 600,
};

app.use(cors(corsOptions));

// ==============================
// Input Sanitization (BEFORE routes)
// ==============================
app.use(sanitizeInputs);

// ==============================
// CSRF Token Generation (BEFORE routes, AFTER sanitization)
// ✅ This generates a token for GET requests to send with POST
// ==============================
app.use(generateCsrfToken);

// ✅ Apply CSRF validation middleware to ALL routes
app.use(validateCsrf);
// ==============================
// Static Files
// ==============================
app.use('/images', express.static(path.join(__dirname, 'images'), {
  maxAge: '1h',
  etag: false,
}));

// ==============================
// Routes
// ==============================
const adminRoutes = require('./routes/adminRoutes');
const userRoutes = require('./routes/userRoutes');
const dataRoutes = require('./routes/dataRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const cartRoutes = require('./routes/cartRoutes');
const orderRoutes = require('./routes/orderRoutes');
const productRoutes = require('./routes/productRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const emailRoutes = require('./routes/emailRoutes');
const imageRoutes = require('./routes/imageRoutes').default || require('./routes/imageRoutes');


// Routes with their rate limiters
app.use('/api/admin', authLimiter, adminRoutes);
app.use('/api/users', userRoutes);
app.use('/api/data', apiLimiter, dataRoutes);
app.use('/api/booking', apiLimiter, bookingRoutes);
app.use('/api/cart', apiLimiter, cartRoutes);
app.use('/api/order', apiLimiter, orderRoutes);
app.use('/api/products', apiLimiter, productRoutes);
app.use('/api/payments', paymentLimiter, paymentRoutes);
app.use('/api/contact', apiLimiter, emailRoutes);
app.use('/api/image', apiLimiter, imageRoutes);

// ==============================
// Health Check
// ==============================
app.get('/health', (req, res) => {
  const timestamp = moment().format('YYYY-MM-DD HH:mm:ss');
  res.status(200).json({
    status: 'ok',
    environment: process.env.NODE_ENV,
    timestamp,
  });
});

// ==============================
// Root Route
// ==============================
app.get('/', (req, res) => {
  const timestamp = moment().format('YYYY-MM-DD HH:mm:ss');
  logger.info('Root route accessed', { ip: req.ip });
  res.status(200).json({
    message: 'Photography API running securely 🔐',
    env: process.env.NODE_ENV,
    timestamp,
  });
});

// ==============================
// 404 Handler
// ==============================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.originalUrl}`,
  });
});

// ==============================
// Global Error Handler
// ==============================
app.use((err, req, res, next) => {
  logger.error('Unhandled error', err);

  const statusCode = err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production'
    ? 'An error occurred'
    : err.message;

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
});

// ==============================
// Start Server
// ==============================
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
    console.log(`🔐 Security headers: ENABLED`);
    console.log(`🛡️  CSRF protection: ENABLED (smart validation)`);
    console.log(`🍪 Secure cookies: ENABLED`);
    console.log(`⏱️  Rate limiting: ENABLED`);
  });
}

module.exports = app;