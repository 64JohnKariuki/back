// bookingController.js
// bookingController.js
const bookModel = require("../models/bookModel");
const serviceModel = require("../models/serviceModel");
const puppeteer = require('puppeteer');
const fs = require('fs').promises;
var qs = require('qs');
const path = require('path');
const NodeCache = require("node-cache");

const { OAuth2Client } = require('google-auth-library');
const { google } = require('googleapis');
const { createInvoice } = require('../config/pdfGenerator.js')
const logger = require("../services/logger");
const { setAsync, getAsync, delAsync } = require("../config/redis");

// Calendar
const gcal = require('../Utility/gcal.js');
const credentials = require('../Utility/credentials.json').installed;

const { sendWhatsAppInvoice, sendWhatsAppMessage } = require('../config/whatsapp.js');
const { paymentStatusWebhook, createPayment, initiatePayment } = require('../config/intasend.js');

// Load environment variables based on NODE_ENV
require('dotenv').config({
  path: process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development'
});

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events"
];

// Initialize OAuth2 Client
const oAuth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const logoPath = path.join(__dirname, "../images/Logos/logo.png");

const refreshToken = process.env.G_REFRESH_TOKEN;

if (refreshToken) {
  oAuth2Client.setCredentials({ refresh_token: refreshToken });

  // Automatically refresh the access token if expired
  oAuth2Client.getAccessToken()
    .then(({ token }) => {
      console.log("✅ Google OAuth2 client initialized with refresh token");
      console.log("🔑 New access token acquired:", token ? "Success" : "Failed");
    })
    .catch((err) => {
      console.error("🚨 Failed to refresh access token:", err.message);
    });

} else {
  console.warn("⚠️ No G_REFRESH_TOKEN found in environment variables");
  console.log("👉 To get a refresh token, run `get-refresh-token.js` or visit /api/auth/google/url");
}

// Generate auth URL (accessible via endpoint, not auto-run)
const generateAuthUrl = () => {
  return oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });
};

// Endpoint to get Google OAuth URL
exports.getGoogleAuthUrl = async (req, res) => {
  try {
    const url = generateAuthUrl();
    res.json({
      message: "Visit this URL to authorize the app",
      authUrl: url,
      instructions: "After authorizing, you'll be redirected. Copy the 'code' parameter and use it in /api/auth/google/callback?code=YOUR_CODE"
    });
  } catch (error) {
    console.error("Error generating auth URL:", error);
    res.status(500).json({ error: "Failed to generate auth URL" });
  }
};

// Endpoint to exchange code for tokens
exports.getGoogleAuthToken = async (req, res) => {
  const code = req.query.code;

  if (!code) {
    return res.status(400).json({ 
      error: "Missing authorization code",
      hint: "Visit /api/auth/google/url first to get the authorization URL"
    });
  }

  try {
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);

    console.log("✅ Tokens retrieved successfully");
    console.log("Add this to your .env file:");
    console.log(`G_REFRESH_TOKEN=${tokens.refresh_token}`);

    res.json({
      message: "Google OAuth2 tokens retrieved successfully",
      refreshToken: tokens.refresh_token,
      instructions: "Copy the refreshToken above and add it to your .env file as G_REFRESH_TOKEN"
    });
  } catch (error) {
    console.error("🚨 Error exchanging code for token:", error.message);
    res.status(500).json({ 
      error: "Failed to exchange code for token",
      details: error.message 
    });
  }
};

// Test access token (optional, for debugging)
const testAccessToken = async () => {
  try {
    const token = await oAuth2Client.getAccessToken();
    console.log("✅ Access token retrieved successfully");
    return true;
  } catch (err) {
    console.error("🚨 Error getting access token:", err.message);
    return false;
  }
};

// Initialize the calendar API
const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

// Test calendar connection
async function testCalendar() {
  if (!refreshToken) {
    console.log("⚠️ Skipping calendar test - no refresh token configured");
    return;
  }

  try {
    const res = await calendar.calendarList.list();
    console.log("✅ Calendar API connected. Available calendars:", 
      res.data.items.map(c => c.summary).join(", "));
  } catch (err) {
    console.error("🚨 Calendar API error:", err.message);
    console.log("💡 You may need to regenerate your refresh token at /api/auth/google/url");
  }
}

// Run calendar test on startup (only if refresh token exists)
if (refreshToken) {
  testCalendar();
}

// Constants
const BOOKING_CACHE_TTL = 24 * 60 * 60; // 24 hours
const BOOKING_CACHE_PREFIX = 'booking:';

/**
 * Sanitizes and cleans up client input data for security and consistency.
 */
const sanitizeBookingInput = (clientInfo) => {
  if (!clientInfo || typeof clientInfo !== 'object') {
    return {};
  }

  const sanitized = {};

  // Sanitize name: trim whitespace
  if (clientInfo.name) {
    sanitized.name = String(clientInfo.name).trim();
  } else {
    sanitized.name = '';
  }

  // Sanitize email: trim and convert to lowercase
  if (clientInfo.email) {
    sanitized.email = String(clientInfo.email).trim().toLowerCase();
  } else {
    sanitized.email = '';
  }

  // Sanitize phone: trim and remove most non-digit characters for storage/consistency
  if (clientInfo.phone) {
    let phoneString = String(clientInfo.phone).trim();
    if (phoneString.startsWith('+')) {
      sanitized.phone = '+' + phoneString.slice(1).replace(/[^0-9]/g, '');
    } else {
      sanitized.phone = phoneString.replace(/[^0-9]/g, '');
    }
  } else {
    sanitized.phone = '';
  }

  // Sanitize location: trim whitespace
  if (clientInfo.location) {
    sanitized.location = String(clientInfo.location).trim();
  } else {
    sanitized.location = '';
  }
  
  // Include userId if present
  if (clientInfo.userId) {
    sanitized.userId = clientInfo.userId;
  }
  
  return sanitized;
};

/**
 * Parse date and time strings into a Date object
 */
function parseDateTime(dateStr, timeStr) {
  // Example: date="2025-09-17", time="10:00 AM"
  const [hour, minute] = timeStr.replace(/(AM|PM)/i, "").trim().split(":");
  let h = parseInt(hour, 10);
  const m = parseInt(minute || "0", 10);
  const isPM = timeStr.toLowerCase().includes("pm");

  if (isPM && h < 12) h += 12;
  if (!isPM && h === 12) h = 0;

  return new Date(`${dateStr}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+03:00`);
}

const bookingCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 }); // 10 min

// 🔒 Tracks bookingNo values currently being saved to the DB.
const inFlightBookings = new Set();

// Cache booking data
const cacheBookingData = async (bookingNo, bookingData) => {
  try {
    await setAsync(
      `${BOOKING_CACHE_PREFIX}${bookingNo}`,
      bookingData,
      BOOKING_CACHE_TTL
    );
    logger.info('Booking cached', { bookingNo });
  } catch (error) {
    logger.error('Cache booking error', error);
  }
};

// Get cached booking data
const getCachedBookingData = async (bookingNo) => {
  try {
    return await getAsync(`${BOOKING_CACHE_PREFIX}${bookingNo}`);
  } catch (error) {
    logger.error('Get cached booking error', error);
    return null;
  }
};

// Clear cached booking data
const clearCachedBookingData = async (bookingNo) => {
  try {
    await delAsync(`${BOOKING_CACHE_PREFIX}${bookingNo}`);
    logger.info('Booking cache cleared', { bookingNo });
  } catch (error) {
    logger.error('Clear cache error', error);
  }
};

/**
 * Helper function to get color based on category
 */
function getCategoryColor(category) {
  const colorMap = {
    wedding: '#f59e0b',      // Orange
    portrait: '#f97316',     // Orange-red
    corporate: '#3b82f6',    // Blue
    event: '#8b5cf6',        // Purple
    commercial: '#10b981',   // Green
    maternity: '#ec4899',    // Pink
    family: '#06b6d4',       // Cyan
    engagement: '#f43f5e',   // Rose
  };

  const key = category?.toLowerCase() || '';
  for (const [pattern, color] of Object.entries(colorMap)) {
    if (key.includes(pattern)) return color;
  }

  return '#6b7280'; // Default gray
}

/**
 * Clear cache endpoint (useful for admin panel)
 */
function clearCache () {
  try {
    cachedResponse = null;
    cacheTimestamp = null;
    fetchInProgress = false;

    console.log('🗑️ Cache cleared successfully');

    res.status(200).json({
      success: true,
      message: 'Cache cleared successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to clear cache',
      message: error.message,
    });
  }
};

/**
 * Get cache status endpoint
 */
exports.getCacheStatus = async (req, res) => {
  try {
    const isCached = !!cachedResponse;
    const cacheAge = cacheTimestamp ? Date.now() - cacheTimestamp : null;
    const cacheValid = cacheAge !== null && cacheAge < CACHE_DURATION;

    res.status(200).json({
      success: true,
      cache: {
        enabled: true,
        active: isCached,
        valid: cacheValid,
        ageSeconds: cacheAge ? Math.floor(cacheAge / 1000) : null,
        expiresInSeconds: cacheValid ? Math.floor((CACHE_DURATION - cacheAge) / 1000) : 0,
        duration: CACHE_DURATION / 1000,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get cache status',
      message: error.message,
    });
  }
};

/**
 * Create a booking
 */
exports.createBooking = async (req, res) => {

  try {
    const userId = req.user.id || req.user.user_id;
    const { 
      clientName, 
      phone, 
      email, 
      location, 
      bookingNo, 
      userpackage, 
      date, 
      time, 
      amount
    } = req.body;
  
    // Validation
    const requiredFields = { clientName, phone, email, date, time, amount, bookingNo };
    const missing = Object.entries(requiredFields)
      .filter(([_, v]) => !v)
      .map(([k]) => k);
    if (missing.length > 0)
      return res.status(400).json({
        success: false,
        message: `Missing required fields: ${missing.join(", ")}`,
      });
  
    // 2️⃣ Check if booking already exists (prevent duplicates)
    const existingBooking = await bookModel.getByBookingNo(bookingNo);
    if (existingBooking) {
      console.warn("⚠️ Booking already exists:", bookingNo);
      return res.json({
        success: true,
        message: "booking already processed",
        booking: existingBooking,
        isDuplicate: true
      });
    }
  
    const bookingData = {
      user_id: userId,
      name: clientName.trim(),
      phone: phone.replace(/\s+/g, ''),
      email: email.toLowerCase().trim(),
      location: location?.trim() || 'N/A',
      package: userpackage?.trim() || 'Standard',
      date: new Date(date).toISOString().split("T")[0], // enforce format
      time: time.trim(),
      amount: parseFloat(amount),
      bookingNo,
      createdAt: new Date(),
    };

    const paymentData = {
      publicKey: process.env.INTASEND_PUBLISHABLE_KEY,
      isLive: process.env.NODE_ENV === "production",
      amount: bookingData.amount,
      currency: "KES",
      email: bookingData.email,
      first_name: bookingData.name,
      phone_number: bookingData.phone,
      api_ref: bookingData.bookingNo,
      metadata: {
        bookingNo,
        package: bookingData.package,
        date: bookingData.date,
      },
    };

    // Cache booking data (must be nested so handlePaymentCallback can read cached.bookingData)
    await cacheBookingData(bookingNo, { bookingData, paymentData });

    console.info(`[BookingInit] ${bookingNo} → ${bookingData.email}`);

    res.status(200).json({
      success: true,
      message: "Booking Session Created",
      bookingNo,
      booking: bookingData,
      paymentData: {
        publicKey: paymentData.publicKey,
        isLive: paymentData.isLive,
        amount: paymentData.amount,
        currency: paymentData.currency,
        email: paymentData.email,
        first_name: paymentData.first_name,
        last_name: paymentData.last_name,
        phone_number: paymentData.phone_number,
        api_ref: paymentData.api_ref
      }
    });

  } catch (error) {
    console.error("❌ Error during booking creation:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to initialize booking",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
      details: error.message 
    });
  }
};

/**
 * Create a Google Calendar event
 * @param {Object} event - Event data
 * @returns {Object} - Created calendar event or warning
 */
async function createCalendarEvent(event) {
  if (!refreshToken) {
    console.warn("⚠️ Skipping calendar event - no refresh token configured");
    return { warning: 'Calendar integration not configured.' };
  }

  try {
    const response = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
    });
    console.log("✅ Calendar event created:", response.data.htmlLink);
    return response.data;
  } catch (error) {
    console.error('🚨 Error creating calendar event:', error.message);
    
    // Check if it's an auth error
    if (error.code === 401 || error.message.includes('invalid_grant')) {
      console.error('💡 Your refresh token may have expired. Get a new one at /api/auth/google/url');
    }
    
    return { warning: 'Calendar event failed to create.' };
  }
};

/**
 * ✅ 2. PAYMENT CALLBACK (Save booking to DB AFTER successful payment)
 * Called by frontend after payment completion
 */
exports.handlePaymentCallback = async (req, res) => {
  let bookingNo, status, paymentResults;
  try {
    ({ bookingNo, status, paymentResults } = req.body);

    if (!bookingNo || !status) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: bookingNo, status",
      });
    }

    console.log("📥 Payment callback received:", { bookingNo, status, paymentResults });

    // 🔒 If a previous (still-processing) callback for this booking is
    // already saving to the DB, don't let this one race past the
    // "existing booking" check below and insert a duplicate row.
    if (status === "completed") {
      if (inFlightBookings.has(bookingNo)) {
        console.warn(`⏳ [PaymentCallback] ${bookingNo} already being processed - ignoring duplicate callback`);
        return res.json({
          success: true,
          message: "Booking is already being processed.",
          bookingNo,
        });
      }
      inFlightBookings.add(bookingNo);
    }

    // Find booking by bookingNo
    const cached = await getCachedBookingData(bookingNo);
    if (!cached?.bookingData) {
      console.error("❌ Booking not found:", bookingNo);
      return res.status(404).json({
        success: false,
        message: "Booking not found or already processed.",
      });
    }

    // ✅ Update booking as paid
    const { bookingData, paymentData } = cached;
    if (status === "completed") {
      // prevent double insert
      const existing = await bookModel.getByBookingNo(bookingNo);
      if (existing) {
        console.warn(`[PaymentCallback] Booking ${bookingNo} already exists`);
        await clearCachedBookingData(bookingNo);
        return res.json({
          success: true,
          message: "Booking already confirmed.",
          booking: existing,
        });
      }

      const package = bookingData.package
      const service = await serviceModel.getPack(package);
      console.log("✅ Services fetched", service);

      const updatedBooking = {
        user_id: bookingData.user_id,
        name: bookingData.name,
        phone: bookingData.phone,
        email: bookingData.email,
        location: bookingData.location,
        package: bookingData.package,
        date: bookingData.date,
        time: bookingData.time,
        amount: bookingData.amount,
        bookingNo: bookingData.bookingNo,
        currency: paymentResults?.currency || "KES",
        paymentRef: paymentResults?.invoice_id || `ref-${Date.now()}`,
        paymentStatus: "paid",
        status: "completed",
        paid: true,
        notes: "",
        confirmed: true,
        paymentMethod: paymentResults?.provider || "mpesa",
        createdAt: bookingData.createdAt || new Date(),
        updatedAt: new Date(),
      };

      // ✅ CREATE CALENDAR EVENT (non-blocking - don't fail if this errors)
      let calendarCreated = false;
      try {
        if (!updatedBooking.date || !updatedBooking.time) {
          throw new Error("Missing date or time in booking data");
        }
  
        // 1. Parse date and time
        const startDateTime = parseDateTime(updatedBooking.date, updatedBooking.time);
        const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000); // +1 hour
        
        console.log("📅 Booking scheduled for:", startDateTime.toISOString());
    
        // 2. Prepare Calendar Event payload
        const event = {
        summary: `Booked ${service.name} - ${updatedBooking.package}`,
        
        location: updatedBooking.location,
        description: 
        `
          Booking Details:
          Package: ${updatedBooking.package}
          Location: ${updatedBooking.location}
          <div style="padding: 15px; background-color: #f4f4f4; border-top: 2px solid #007bff; border-radius: 0 0 8px 8px; font-family: sans-serif;">
            <p style="margin: 5px 0; font-weight: bold; font-size: 16px; color: #007bff; text-align: right;">
              Total Amount: ${updatedBooking.currency || 'KES'} ${updatedBooking.amount.toFixed(2)}
            </p>
            <p style="text-align: center; margin-top: 15px; font-size: 11px; color: #888;">
              Hosted by Launit | This is an automated booking confirmation.
            </p>
          </div>
        `,

        start: {
          dateTime: startDateTime.toISOString(),
          timeZone: "Africa/Nairobi",
        },
        end: {
          dateTime: endDateTime.toISOString(),
          timeZone: "Africa/Nairobi",
        },
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'email', minutes: 24 * 60 }, // 1 day before
            { method: 'popup', minutes: 60 }, // 1 hour before
          ],
        },
        };
        
        // 3. Create calendar event (non-blocking)
        const calendarResponse = await createCalendarEvent(event);
        calendarCreated = !calendarResponse.warning;
        
        if (calendarCreated) {
          console.log("✅ Calendar event created successfully");
        } else {
          console.warn("⚠️ Calendar event creation had warnings");
        }
      } catch (calendarError) {
        console.error("⚠️ Calendar event creation failed (non-critical):", calendarError.message);
        // Continue anyway - calendar is optional
      }

      // ✅ GENERATE INVOICE (non-blocking)
      let invoiceGenerated = false;
      try {
        // 5. Prepare invoice details
        const invoiceDetails = {
          client: {
            name: updatedBooking.name,
            email: updatedBooking.email,
            phone: updatedBooking.phone,
            address: updatedBooking.location || "N/A",
            city: updatedBooking.location || "N/A",
            state: "KE",
            country: "Kenya",
            postal_code: "20100",
          },
          sessionDetails: {
            type: updatedBooking.package,
            date: updatedBooking.date,
            time: updatedBooking.time,
            duration: "2 hours",
            address: updatedBooking.location || "TBD",
            specialRequests: "None",
          },
          services: [
            {
              service: "Photography Session",
              description: `${updatedBooking.package} session on ${updatedBooking.date} at ${updatedBooking.time}`,
              quantity: 1,
              amount: updatedBooking.amount,
            },
          ],
          subtotal: updatedBooking.amount,
          paid: updatedBooking.amount,
          invoice_nr: updatedBooking.bookingNo,
          paymentTerms: "Full payment required before the session.",
          cancellationPolicy: "Cancellations must be made 48 hours in advance for a full refund.",
          createdAt: new Date().toISOString(),
          notes: "Thank you for choosing us!",
        };
    
        console.log("📄 Generating invoice...", invoiceDetails);
    
        // 6. Generate invoice
        const invoiceBuffer = await createInvoice(invoiceDetails, bookingNo);
        
        if (!invoiceBuffer) {
          console.error("❌ Failed to generate invoice");
          return res.status(500).json({ error: "Failed to generate invoice." });
        }
        invoiceGenerated = !!invoiceBuffer;
        
        if (invoiceGenerated) {
          console.log("✅ Invoice generated successfully");
        }
      } catch (invoiceError) {
        console.error("⚠️ Invoice generation failed (non-critical):", invoiceError.message);
        // Continue anyway - invoice can be regenerated later
      }
  
      const bookingToSave = {
        user_id: updatedBooking.user_id,
        name: updatedBooking.name,
        phone: updatedBooking.phone,
        email: updatedBooking.email,
        location: updatedBooking.location,
        bookingNo: updatedBooking.bookingNo,
        package: updatedBooking.package,
        date: updatedBooking.date,
        time: updatedBooking.time,
        status: updatedBooking.status,
        payment_ref: updatedBooking.paymentRef,
        paid: updatedBooking.paid,
        confirmed: updatedBooking.confirmed,
        amount: updatedBooking.amount,
        payment_method: updatedBooking.paymentMethod,
        currency: updatedBooking.currency
      };

      // ✅ SAVE TO DATABASE FIRST (most critical operation)
      let savedBooking;
      try {
        savedBooking = await bookModel.create(bookingToSave);
        console.log("✅ Booking saved to database:", savedBooking.id || savedBooking.bookingNo);
      } catch (dbError) {
        console.error("❌ Database insert failed:", dbError.message);
        
        // Don't clear cache if DB insert fails
        return res.status(500).json({
          success: false,
          message: "Failed to save booking to database",
          error: dbError.message,
          bookingNo
        });
      }

      // ✅ Optionally clear cache
      await clearCachedBookingData(bookingNo);

      // Optional: trigger email + calendar + invoice here
      // sendBookingConfirmationEmail(updatedBooking);
      // createCalendarEvent(...);

      return res.json({
        success: true,
        message: "Booking confirmed successfully.",
        booking: savedBooking,
        bookingNo,
        calendarCreated,
        invoiceGenerated,
        invoiceUrl: invoiceGenerated ? `/invoices/${bookingNo}.pdf` : null,
      });
    } 
    else if (status === "failed") {
      console.warn("❌ Payment failed for booking:", bookingNo);

      await bookModel.updateByBookingNo(bookingNo, {
        paymentStatus: "failed",
        status: "cancelled",
        paid: false,
        updatedAt: new Date(),
      });

      return res.json({
        success: false,
        message: "Payment failed. Booking cancelled.",
        bookingNo,
      });
    } 
    else {
      return res.status(400).json({
        success: false,
        message: "Invalid payment status",
        receivedStatus: status,
      });
    }

  } catch (error) {
    console.error("❌ Payment callback error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to process payment callback",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    if (status === "completed" && bookingNo) {
      inFlightBookings.delete(bookingNo);
    }
  }
};

/**
 * ✅ Controller function to fetch events (mock data and real Google Calendar events)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */

let fetchInProgress = false;
let cachedResponse = null;
let cacheTimestamp = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes (30 seconds is too short)

// Queue for waiting requests
const waitingRequests = [];

exports.getData = async (req, res) => {
  try {
    // ✅ Return cached response if still valid
    if (cachedResponse && cacheTimestamp && (Date.now() - cacheTimestamp < CACHE_DURATION)) {
      const cacheAge = Math.floor((Date.now() - cacheTimestamp) / 1000);
      console.log(`📦 [CONTROLLER] Returning cached response (${cacheAge}s old)`);

      return res.status(200).json({
        ...cachedResponse,
        fromCache: true,
        cacheAge: cacheAge
      });
    }

    // ✅ If fetch in progress, queue this request
    if (fetchInProgress) {
      console.log("⏳ [CONTROLLER] Fetch in progress, queuing request...");

      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          // Timeout after 30 seconds
          resolve(res.status(503).json({
            success: false,
            error: 'Request timeout - data fetch taking too long'
          }));
        }, 30000);

        waitingRequests.push((response) => {
          clearTimeout(timeout);
          resolve(res.status(200).json(response));
        });
      });
    }

    // Start fetching
    fetchInProgress = true;
    console.log("🚀 [CONTROLLER] Starting fresh data fetch...");

    // ✅ Normalize to midnight — comparing against the exact current timestamp
    // meant anything booked for later TODAY was excluded from every result
    // below the instant it turned past 00:00:00, which is effectively always.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const oneYearFromNow = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate());

    // ========================================================================
    // STEP 1: FETCH SERVICES WITH NESTED STRUCTURE
    // ========================================================================
    console.log("📊 [CONTROLLER] Fetching services...");
    let services = [];

    try {
      services = await serviceModel.getAllServicesJoinedFast();
      console.log(`✅ [CONTROLLER] Loaded ${services?.length || 0} services`);
    } catch (error) {
      console.error("❌ [CONTROLLER] Error fetching services:", error.message);
      services = [];
    }

    // ========================================================================
    // STEP 2: FLATTEN CATEGORIES AND PACKAGES FOR QUICK LOOKUPS
    // ========================================================================
    console.log("🔨 [CONTROLLER] Flattening data structure...");
    const categories = [];
    const packages = [];
    const packagesByCategory = {}; // Additional lookup map
    const categoriesByService = {}; // Additional lookup map

    services.forEach((service) => {
      if (!service?.categories) return;

      const serviceId = service.id;
      const serviceName = service.name;

      categoriesByService[serviceId] = [];

      service.categories.forEach((category) => {
        if (!category) return;

        const categoryId = category.id;
        const categoryPackages = category.packages || [];

        categoriesByService[serviceId].push(categoryId);

        categories.push({
          id: categoryId,
          name: category.name,
          description: category.description,
          image: category.image,
          sort_order: category.sort_order,
          serviceId: serviceId,
          serviceName: serviceName,
          packageCount: categoryPackages.length,
        });

        packagesByCategory[categoryId] = [];

        categoryPackages.forEach((pkg) => {
          if (!pkg) return;

          const packageId = pkg.id;
          const packageFeatures = pkg.features || [];

          packagesByCategory[categoryId].push(packageId);

          packages.push({
            id: packageId,
            name: pkg.name,
            description: pkg.description,
            price: pkg.price,
            duration: pkg.duration,
            image: pkg.image,
            sort_order: pkg.sort_order,
            features: packageFeatures,
            categoryId: categoryId,
            categoryName: category.name,
            serviceId: serviceId,
            serviceName: serviceName,
          });
        });
      });
    });

    console.log(`✅ [CONTROLLER] Flattening complete:`);
    console.log(`   - ${categories.length} categories`);
    console.log(`   - ${packages.length} packages`);

    // ========================================================================
    // STEP 3: FETCH BOOKINGS FROM DATABASE
    // ========================================================================
    console.log("📅 [CONTROLLER] Fetching bookings...");
    let dbBookings = [];

    try {
      const allBookings = await bookModel.getAll();
      // ✅ Exclude cancelled/failed bookings too — otherwise a cancelled date
      // stays permanently blocked on the public calendar forever, since it
      // still has a future date but the slot is actually free again.
      dbBookings = (allBookings || []).filter(b => {
        if (!b.date) return false;
        if (['cancelled', 'failed'].includes(String(b.status || '').toLowerCase())) return false;
        return new Date(b.date) >= today;
      });

      console.log(`✅ [CONTROLLER] Loaded ${dbBookings.length} future bookings`);
    } catch (error) {
      console.error("❌ [CONTROLLER] Error fetching bookings:", error.message);
      dbBookings = [];
    }

    const dbEvents = dbBookings.map(b => ({
      id: b.id?.toString() || b.bookingNo,
      title: b.package || 'Photography Session',
      client: b.name,
      email: b.email,
      phone: b.phone,
      location: b.location || 'N/A',
      amount: b.amount ? parseFloat(b.amount) : 0,
      date: b.date,
      time: b.time,
      // ✅ `payment_status` isn't a column this table ever saves (only
      // `status` and `paid` are) — reading it was always undefined and
      // silently fell through to the real column anyway; simplified.
      status: b.status || 'confirmed',
      paid: !!b.paid,
      confirmed: !!b.confirmed,
      bookingNo: b.bookingNo,
      paymentMethod: b.payment_method,
      source: 'database',
    }));

    // ========================================================================
    // STEP 4: FETCH FROM GOOGLE CALENDAR (optional)
    // ========================================================================
    let calendarEvents = [];
    let bookedDateTimes = [];

    if (refreshToken) {
      console.log("📆 [CONTROLLER] Fetching calendar events...");
      try {
        const calendarResponse = await calendar.events.list({
          calendarId: 'primary',
          timeMin: today.toISOString(),
          timeMax: oneYearFromNow.toISOString(),
          singleEvents: true,
          orderBy: 'startTime',
        });

        const allCalendarEvents = calendarResponse.data.items || [];
        calendarEvents = allCalendarEvents
          .filter(ev => ev.status === 'confirmed' && ev.summary)
          .map(ev => {
            const bookingNoMatch = ev.summary.match(/#([A-Z0-9-]+)/);
            return {
              id: ev.id,
              title: ev.summary,
              date: ev.start.dateTime
                ? new Date(ev.start.dateTime).toISOString().split('T')[0]
                : ev.start.date,
              time: ev.start.dateTime
                ? new Date(ev.start.dateTime).toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true,
                    timeZone: 'Africa/Nairobi',
                  })
                : 'All day',
              status: 'confirmed',
              bookingNo: bookingNoMatch ? bookingNoMatch[1] : null,
              source: 'calendar',
            };
          });

        bookedDateTimes = allCalendarEvents
          .filter(ev => ev.status === 'confirmed')
          .map(ev => ev.start.dateTime?.split('T')[0] || ev.start.date);

        console.log(`✅ [CONTROLLER] Found ${calendarEvents.length} calendar events`);
      } catch (err) {
        console.error('⚠️ [CONTROLLER] Calendar fetch error:', err.message);
      }
    }

    // ========================================================================
    // STEP 5: MERGE EVENTS (DB takes priority)
    // ========================================================================
    const allEventsMap = new Map();
    dbEvents.forEach(e => allEventsMap.set(e.bookingNo || e.id, e));
    calendarEvents.forEach(e => {
      if (e.bookingNo && !allEventsMap.has(e.bookingNo)) {
        allEventsMap.set(e.bookingNo, e);
      } else if (!e.bookingNo) {
        allEventsMap.set(e.id, e);
      }
    });

    const allEvents = Array.from(allEventsMap.values());
    const uniqueBookedDates = [...new Set([
      ...dbEvents.map(e => e.date),
      ...bookedDateTimes,
    ])].filter(Boolean).sort();

    // ========================================================================
    // STEP 6: BUILD AND CACHE RESPONSE
    // ========================================================================
    const timestamp = new Date().toISOString();

    cachedResponse = {
      success: true,
      message: 'Data fetched successfully',
      events: allEvents,
      bookings: dbBookings,
      services,
      categories,
      packages,
      lookups: {
        packagesByCategory,
        categoriesByService,
      },
      bookedDates: uniqueBookedDates,
      unavailableDates: [],
      metadata: {
        totalServices: services.length,
        totalCategories: categories.length,
        totalPackages: packages.length,
        totalBookings: dbBookings.length,
        totalEvents: allEvents.length,
        dataSources: {
          database: dbEvents.length,
          calendar: calendarEvents.length,
        },
        fetchedAt: timestamp,
        cacheDuration: CACHE_DURATION,
        expiresAt: new Date(Date.now() + CACHE_DURATION).toISOString(),
      },
    };

    cacheTimestamp = Date.now();
    fetchInProgress = false;

    console.log(`✅ [CONTROLLER] Successfully cached data:`);
    console.log(`   - Services: ${services.length}`);
    console.log(`   - Categories: ${categories.length}`);
    console.log(`   - Packages: ${packages.length}`);
    console.log(`   - Bookings: ${dbBookings.length}`);
    console.log(`   - Events: ${allEvents.length}`);
    console.log(`   - Cache expires in ${CACHE_DURATION / 1000}s`);

    waitingRequests.forEach(callback => callback(cachedResponse));
    waitingRequests.length = 0;

    res.status(200).json({
      ...cachedResponse,
      fromCache: false
    });

  } catch (error) {
    fetchInProgress = false;

    const errorResponse = {
      success: false,
      error: 'Failed to fetch data',
      details: error.message,
    };

    waitingRequests.forEach(callback => callback(errorResponse));
    waitingRequests.length = 0;

    console.error('❌ [CONTROLLER] Fatal error:', error.message);
    console.error('Stack trace:', error.stack);

    res.status(500).json(errorResponse);
  }
};

// Optional: Manual cache invalidation endpoint
exports.invalidateCache = (req, res) => {
  cachedResponse = null;
  cacheTimestamp = null;
  console.log('🗑️ [CONTROLLER] Cache manually invalidated');
  
  res.status(200).json({
    success: true,
    message: 'Cache invalidated successfully'
  });
};


/**
 * Controller function to fetch events (mock data and real Google Calendar events)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getEvents = async (req, res) => {
  try {
    const today = new Date();
    const oneYearFromNow = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate());

    // 1️⃣ FETCH ALL BOOKINGS FROM DATABASE (dynamic data)
    // Wrap the callback-based getAll in a Promise
    const dbBookings = await new Promise((resolve, reject) => {
      bookModel.getAll((error, results) => {
        if (error) {
          console.error("❌ Database query error:", error);
          return reject(error);
        }
        
        // Filter bookings from today onwards
        const filtered = (results || []).filter(b => {
          if (!b.date) return false;
          const bookingDate = new Date(b.date).toISOString().split('T')[0];
          return bookingDate >= today;
        });
        
        resolve(filtered);
      });
    });
    console.log('⚠️ fetched from booking Calendar:', dbBookings);

    const dbEvents = dbBookings.map(b => ({
      id: b.id.toString(),
      title: b.package || 'Photography Session',
      client: b.name,
      email: b.email,
      phone: b.phone,
      location: b.location || 'N/A',
      amount: b.amount || 0,
      date: b.date,
      time: b.time,
      duration: '2 hours',
      status: b.booking_status || 'completed',
      paid: b.payment_status === 'pending',
      confirmed: b.payment_status === 'completed',
      bookingNo: b.bookingNo,
      paymentMethod: b.payment_method,
      source: 'database',
    }));

    console.log(`📦 Loaded ${dbEvents.length} events from database`);

    // 2️⃣ FETCH EVENTS FROM GOOGLE CALENDAR (if refresh token exists)
    let calendarEvents = [];
    let bookedDateTimes = [];
    
    if (refreshToken) {
      try {
        const calendarResponse = await calendar.events.list({
          calendarId: 'primary',
          timeMin: new Date().toISOString(),
          timeMax: oneYearFromNow.toISOString(),
          singleEvents: true,
          orderBy: 'startTime',
        });

        const allCalendarEvents = calendarResponse.data.items || [];

        // Filter for booking events
        calendarEvents = allCalendarEvents
          .filter(ev => ev.status === 'confirmed' && ev.summary && ev.summary.includes('Booking'))
          .map(ev => {
            // Extract booking number from summary if it exists (format: "Booking for Name - #BOOK-123")
            const bookingNoMatch = ev.summary.match(/#([A-Z0-9-]+)/);
            const bookingNo = bookingNoMatch ? bookingNoMatch[1] : null;
            
            // Extract client name from summary
            const nameMatch = ev.summary.match(/Booking for (.+?) -/);
            const clientName = nameMatch ? nameMatch[1] : 'Unknown Client';
            
            return {
              id: ev.id,
              title: ev.summary,
              client: clientName,
              description: ev.description || '',
              location: ev.location || 'N/A',
              date: ev.start.dateTime 
                ? new Date(ev.start.dateTime).toISOString().split('T')[0] 
                : ev.start.date,
              time: ev.start.dateTime 
                ? new Date(ev.start.dateTime).toLocaleTimeString('en-US', { 
                    hour: '2-digit', 
                    minute: '2-digit',
                    hour12: true,
                    timeZone: 'Africa/Nairobi'
                  }) 
                : 'All day',
              status: 'confirmed',
              bookingNo: bookingNo,
              source: 'calendar',
              calendarLink: ev.htmlLink,
            };
          });

        // Extract all booked dates for calendar blocking
        bookedDateTimes = allCalendarEvents
          .filter(ev => ev.status === 'confirmed' && ev.start.dateTime)
          .map(ev => new Date(ev.start.dateTime).toISOString().split('T')[0]);

        console.log(`📅 Found ${calendarEvents.length} booking events in Google Calendar`);
      } catch (calendarError) {
        console.error('⚠️ Error fetching from Google Calendar:', calendarError.message);
        // Continue without calendar events if there's an error
      }
    } else {
      console.warn('⚠️ Skipping Google Calendar fetch - no refresh token configured');
    }

    // 3️⃣ MERGE DATABASE AND CALENDAR EVENTS (avoid duplicates)
    // Use bookingNo to identify duplicates - database bookings take priority
    const bookingNosInDb = new Set(
      dbEvents.map(e => e.bookingNo).filter(Boolean)
    );
    
    const uniqueCalendarEvents = calendarEvents.filter(
      ce => !ce.bookingNo || !bookingNosInDb.has(ce.bookingNo)
    );

    const allEvents = [...dbEvents, ...uniqueCalendarEvents];
    
    console.log(`✅ Total events: ${allEvents.length} (${dbEvents.length} from DB, ${uniqueCalendarEvents.length} from Calendar)`);

    // 4️⃣ GET UNIQUE BOOKED DATES for calendar UI
    const allBookedDates = [
      ...dbEvents.map(e => e.date),
      ...bookedDateTimes,
    ];
    const uniqueBookedDates = [...new Set(allBookedDates)].sort();

    // 5️⃣ MARK UNAVAILABLE DATES (holidays or manual block-outs)
    const unavailableDates = [
      // Add your unavailable dates here, e.g.:
      // '2025-12-25', // Christmas
      // '2025-01-01', // New Year
    ];

    // 7️⃣ SEND RESPONSE
    res.status(200).json({
      success: true,
      message: 'Events and booking data fetched successfully.',
      events: allEvents, // Combined events from DB and Calendar
      packages: packageTemplates,
      bookedDates: uniqueBookedDates,
      unavailableDates,
      totalBookings: allEvents.length,
      sources: {
        database: dbEvents.length,
        calendar: uniqueCalendarEvents.length,
      },
    });

  } catch (error) {
    console.error('❌ Error fetching events:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch events and bookings.',
      details: error.message,
    });
  }
};

exports.getAllBookings = async (req, res) => {
  try {
    const bookings = await bookModel.getAll();
    res.status(200).json({ success: true, bookings });
  } catch (err) {
    console.error("Error getting bookings:", err);
    res.status(500).json({ success: false, message: "Failed to get bookings", error: err.message });
  }
};

exports.getBookingById = async (req, res) => {
  const bookingId = req.params.id;

  try {
    const booking = await bookModel.getById(bookingId);
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found" });
    }
    if (booking.user_id !== req.user.id && !req.user.isAdmin) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    res.status(200).json(booking);
  } catch (err) {
    console.error("Error getting booking by id:", err);
    res.status(500).json({ success: false, message: "Failed to get booking", error: err.message });
  }
};

exports.downloadInvoice = async (bookingNo) => {
  try {
    const response = await axios.get(`${getBaseURL()}/api/invoice/download/${bookingNo}`, {
      responseType: 'blob', // Important for handling binary data
    });

    // Create a URL for the PDF blob
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `invoice_${bookingNo}.pdf`); // Set the file name

    // Append to the body and trigger the download
    document.body.appendChild(link);
    link.click();

    // Clean up
    link.remove();
    window.URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Error downloading invoice:", error);
    toast.error("Failed to download invoice.");
  }
};

exports.updateBooking = async (req, res) => {
  const bookingId = req.params.id;
  const updatedData = req.body;

  try {
    const result = await bookModel.updateById(bookingId, updatedData);
    res.status(200).json({ success: true, message: "Booking updated successfully", result });
  } catch (err) {
    console.error("Error updating booking:", err);
    res.status(500).json({ success: false, error: err.message || "Failed to update booking" });
  }
};

exports.getPastBookingsByCustomerID = async (req, res) => {
  const customerId = req.params.id;

  try {
    const bookings = await bookModel.getPastByUserId(customerId);
    res.status(200).json(bookings);
  } catch (err) {
    console.error("Error getting past bookings:", err);
    res.status(500).json({ error: "Failed to get past bookings" });
  }
};

exports.cancelBooking = async (req, res) => {
  const bookingId = req.params.id;

  try {
    const result = await bookModel.updateStatus(bookingId, "cancelled");
    res.status(200).json({ success: true, message: "Booking canceled successfully", result });
  } catch (err) {
    console.error("Error canceling booking:", err);
    res.status(500).json({ success: false, error: "Failed to cancel booking" });
  }
};
