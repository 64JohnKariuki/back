// controllers/dataController.js
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const serviceModel = require("../models/serviceModel");
const bookModel = require("../models/bookModel");
const userModel = require("../models/userModel");
const adminModel = require("../models/adminModel");
const brandModel = require("../models/brandModel");
const galleryStorage = require("../Utility/galleryStorage");

// ============================================================================
// PUBLIC GALLERY ACCESS (token-based, unguessable link)
// ============================================================================
const MAX_FAILED_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MINUTES = 15;
const GRANT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — "stay unlocked" like Pixieset

// ── Signed unlock grants ────────────────────────────────────────────────────
const GRANT_SECRET = process.env.GALLERY_GRANT_SECRET || process.env.JWT_SECRET;
if (!GRANT_SECRET) {
  
  console.warn("⚠️  GALLERY_GRANT_SECRET is not set — gallery unlock grants are NOT secure. Set it in your environment.");
}

function signGalleryGrant(gallery_id) {
  const expiresAt = Date.now() + GRANT_TTL_MS;
  const payload = `${gallery_id}.${expiresAt}`;
  const signature = crypto
    .createHmac("sha256", GRANT_SECRET || "insecure-dev-secret-do-not-use-in-prod")
    .update(payload)
    .digest("hex");
  return `${payload}.${signature}`;
}

function verifyGalleryGrant(gallery_id, grant) {
  if (!grant || typeof grant !== "string") return false;
  const parts = grant.split(".");
  if (parts.length !== 3) return false;
  const [grantGalleryId, expiresAtStr, signature] = parts;

  if (String(grantGalleryId) !== String(gallery_id)) return false;

  const expiresAt = Number(expiresAtStr);
  if (!expiresAt || Date.now() > expiresAt) return false;

  const expected = crypto
    .createHmac("sha256", GRANT_SECRET || "insecure-dev-secret-do-not-use-in-prod")
    .update(`${grantGalleryId}.${expiresAtStr}`)
    .digest("hex");

  // Timing-safe comparison — signatures must be equal length for timingSafeEqual.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const grantCookieName = (gallery_id) => `gallery_grant_${gallery_id}`;

exports.getPublicGalleryByToken = async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body || {};
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';

    if (!token) return res.status(404).json({ success: false, error: "Gallery not found" });

    const gallery = await adminModel.getGalleryByToken(token);
    if (!gallery) return res.status(404).json({ success: false, error: "Gallery not found" });

    const isProtected = !!gallery.password;

    // Already unlocked for everyone with this link — this is the whole point:
    // one correct password entry unlocks the gallery itself, not just one browser.
    if (!isProtected || gallery.unlocked_at) {
      const resolvedImages = await galleryStorage.resolveGalleryUrls(gallery.images || [], true);
      return res.status(200).json({
        success: true,
        gallery: { locked: false, name: gallery.title, images: resolvedImages }
      });
    }

    // Still locked — brute-force guard first.
    const recentFailures = await adminModel.countRecentFailedAttempts(gallery.gallery_id, ip, ATTEMPT_WINDOW_MINUTES);
    if (recentFailures >= MAX_FAILED_ATTEMPTS) {
      return res.status(429).json({ success: false, error: "Too many attempts. Try again later." });
    }

    if (!password) {
      return res.status(200).json({
        success: true,
        gallery: { locked: true, name: gallery.title, coverUrl: gallery.thumbnail || '' }
      });
    }

    const isValid = await bcrypt.compare(password, gallery.password);
    await adminModel.recordGalleryAccessAttempt(gallery.gallery_id, ip, isValid);

    if (!isValid) {
      return res.status(200).json({
        success: true,
        gallery: { locked: true, name: gallery.title },
        error: "Incorrect password."
      });
    }

    // Correct password → unlock the gallery itself, globally. From now on
    // anyone opening this link — any device, no cookie/localStorage — skips
    // the password prompt, until an admin re-locks it or the password is rotated.
    await adminModel.unlockGallery(gallery.gallery_id);

    const resolvedImages = await galleryStorage.resolveGalleryUrls(gallery.images || [], true);
    return res.status(200).json({
      success: true,
      gallery: { locked: false, name: gallery.title, images: resolvedImages }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};

// ============================================================================
// AUTHENTICATED CLIENT-DASHBOARD GALLERY ACCESS
// ============================================================================
// ClientGallery.jsx lives behind the logged-in client dashboard (a protected
// route), so a client viewing their OWN gallery there is already authenticated
// by their session — that login *is* the authorization. It should never need
// to also pass the public token/password gate above, and it must never reuse
// a client-side flag (like the old `localStorage` "unlocked" trick) to prove
// that. Ownership is checked server-side against gallery.user_id every time.
exports.getClientGalleries = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.user_id || req.user?._id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const galleries = await adminModel.getGalleriesByUserId(userId);
    // Metadata only — no images, no password/hash. Full images are fetched
    // per-gallery via getClientGalleryById once the user opens one.
    const safeGalleries = galleries.map((g) => ({
      id: String(g.gallery_id),
      title: g.title,
      thumbnail: g.thumbnail || null,
      status: g.status,
      category: g.category || null,
      location: g.location || null,
      date: g.date || null,
      imageCount: Number(g.imageCount || 0),
      clientApproved: !!g.clientApproved,
      proofing: !!g.proofing,
      createdAt: g.created_at,
      updatedAt: g.updated_at,
    }));

    return res.status(200).json({ success: true, galleries: safeGalleries });
  } catch (err) {
    console.error("getClientGalleries error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};

exports.getClientGalleryById = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.user_id || req.user?._id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const { id } = req.params;
    const gallery = await adminModel.getGalleryById(id);
    if (!gallery) {
      return res.status(404).json({ success: false, error: "Gallery not found" });
    }

    // The check that actually matters: this gallery must belong to the
    // logged-in user. Without this, any authenticated client could load any
    // other client's gallery just by changing the :id in the URL.
    if (String(gallery.user_id) !== String(userId)) {
      return res.status(403).json({ success: false, error: "You don't have access to this gallery" });
    }

    const resolvedImages = await galleryStorage.resolveGalleryUrls(gallery.images || [], true);
    await adminModel.incrementViews(gallery.gallery_id).catch(() => {});

    return res.status(200).json({
      success: true,
      gallery: {
        id: String(gallery.gallery_id),
        title: gallery.title,
        thumbnail: gallery.thumbnail || null,
        client: gallery.client || null,
        client_email: gallery.client_email || null,
        status: gallery.status,
        downloadable: !!gallery.downloadable,
        images: resolvedImages,
      },
    });
  } catch (err) {
    console.error("getClientGalleryById error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};
 
// ============================================================================
// CACHE CONFIGURATION
// ============================================================================
let fetchInProgress = false;
let cachedResponse  = null;
let cacheTimestamp  = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Queue for concurrent requests that arrive while a fetch is in flight
const waitingRequests = [];

// Separate, much smaller cache for the public homepage endpoint (see
// getHomepageData below). It intentionally does NOT share cachedResponse/
// cacheTimestamp with getAllData: that response includes bookings and user
// records for the admin dashboard and must never be reachable from a public,
// unauthenticated route. Homepage data is public-safe (brands + portfolio
// images only), so it gets its own cache with its own, longer TTL.
let homepageCache = null;
let homepageCacheTimestamp = null;
const HOMEPAGE_CACHE_DURATION = 10 * 60 * 1000; // 10 minutes — this content changes rarely

// Real cache invalidation, callable from other controllers (adminController's
// mutation endpoints — create/update/delete gallery, brand, category, etc.).
// `keys` is currently accepted for future granularity but this cache is a
// single flat blob, so any key just drops the whole thing — cheap, and the
// next request rebuilds it from a live DB read. This is what closes the gap
// that let a "published" status change sit invisible to clients for up to
// CACHE_DURATION: previously nothing outside this file could reach
// cachedResponse/cacheTimestamp at all, so admin mutations had no way to
// clear it.
exports.invalidateDataCache = (keys = []) => {
  cachedResponse = null;
  cacheTimestamp = null;
  // Also drop the homepage cache — a brand being created/toggled active or a
  // new portfolio image being uploaded should show up on the public site
  // without waiting out the full TTL.
  homepageCache = null;
  homepageCacheTimestamp = null;
  console.log("📦 [DATA] Cache invalidated" + (keys.length ? ` for: ${keys.join(', ')}` : ''));
};

// ============================================================================
// PUBLIC HOMEPAGE DATA — single source of truth for the marketing homepage
// ----------------------------------------------------------------------------
// Consolidates everything the homepage needs (currently: active brand/client
// logos, plus a portfolio image preview) into one public, cached, GET
// endpoint, instead of the frontend hardcoding a client-logo list and
// separately hitting a different image endpoint.
//
// IMPORTANT: this is deliberately a NARROW, public-safe response. Unlike
// getAllData (below), it must never include bookings, users, or anything
// gated behind requireAdmin — this route is meant to be called by anonymous
// visitors on page load.
//
// NOTE ON IMAGES: this file doesn't have access to whatever model backs
// `/api/image/allImages` (that controller/model wasn't part of this pass).
// The `imageModel.getFeaturedImages` call below is a placeholder — replace
// it with whatever your actual image model exports so this becomes the
// single real fetch point instead of the frontend calling `/api/image/*`
// directly. Until that's wired in, `portfolioImages` will just come back
// as an empty array (never throws, thanks to Promise.allSettled).
// ============================================================================
exports.getHomepageData = async (req, res) => {
  try {
    if (
      homepageCache &&
      homepageCacheTimestamp &&
      Date.now() - homepageCacheTimestamp < HOMEPAGE_CACHE_DURATION
    ) {
      const cacheAge = Math.floor((Date.now() - homepageCacheTimestamp) / 1000);
      return res.status(200).json({ ...homepageCache, fromCache: true, cacheAge });
    }

    let imageModel;
    try {
      // eslint-disable-next-line global-require
      imageModel = require("../models/imageModel");
    } catch {
      imageModel = null; // model not present in this pass — see note above
    }

    const [brandsResult, imagesResult] = await Promise.allSettled([
      brandModel.getBrands(), // active-only — public marquee shouldn't show disabled clients
      imageModel?.getFeaturedImages?.() || Promise.resolve([]),
    ]);

    const brands = brandsResult.status === "fulfilled" ? brandsResult.value : [];
    const portfolioImages = imagesResult.status === "fulfilled" ? imagesResult.value : [];

    if (brandsResult.status === "rejected") {
      console.error("❌ [HOMEPAGE DATA] brands fetch failed:", brandsResult.reason);
    }
    if (imagesResult.status === "rejected") {
      console.error("❌ [HOMEPAGE DATA] images fetch failed:", imagesResult.reason);
    }

    homepageCache = {
      success: true,
      brands: brands.map((b) => ({
        id: b.brand_id,
        name: b.name,
        logo: b.icon,
      })),
      portfolioImages,
      meta: {
        cacheDuration: HOMEPAGE_CACHE_DURATION,
        expiresAt: new Date(Date.now() + HOMEPAGE_CACHE_DURATION).toISOString(),
      },
    };
    homepageCacheTimestamp = Date.now();

    return res.status(200).json({ ...homepageCache, fromCache: false });
  } catch (err) {
    console.error("❌ [HOMEPAGE DATA] Unexpected error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch homepage data",
    });
  }
};

// ============================================================================
// MAIN DATA FETCH CONTROLLER
// Fetches all portfolio data (services, bookings, users, categories, packages, 
// genres, galleries, brands) in one parallel call, builds a guest-user layer 
// from unlinked bookings, merges registered + guest users, constructs lookup 
// maps, stats, and returns a unified response.
// ============================================================================
exports.getAllData = async (req, res) => {
  try {
    console.log("🔥 getAllData HIT");

    // ============================
    // STEP 1: CACHE CHECK
    // ============================
    if (
      cachedResponse &&
      cacheTimestamp &&
      Date.now() - cacheTimestamp < CACHE_DURATION
    ) {
      const cacheAge = Math.floor((Date.now() - cacheTimestamp) / 1000);
      console.log(`📦 [DATA] Returning cached response (${cacheAge}s old)`);
      return res.status(200).json({ ...cachedResponse, fromCache: true, cacheAge });
    }

    // ============================
    // STEP 2: HANDLE CONCURRENT REQUESTS
    // If a fetch is already running, queue this request instead of firing a second DB round-trip.
    // ============================
    if (fetchInProgress) {
      console.log("⏳ [DATA] Fetch in progress, queuing request...");
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          resolve(
            res.status(503).json({
              success: false,
              error: "Request timeout — data fetch taking too long",
            })
          );
        }, 30000);

        waitingRequests.push((response) => {
          clearTimeout(timeout);
          resolve(res.status(200).json(response));
        });
      });
    }

    // ============================
    // STEP 3: START FRESH FETCH
    // ============================
    fetchInProgress = true;
    console.log("🚀 [DATA] Starting fresh data fetch...");
    const startTime = Date.now();

    // ============================
    // STEP 4: FETCH ALL DATA IN PARALLEL
    // Promise.allSettled means one failing model never blocks the others.
    // ============================
    const [
      servicesResult,
      bookingsResult,
      usersResult,
      genresResult,
      galleriesResult,
      brandsResult
    ] = await Promise.allSettled([
      serviceModel.getAllServicesJoinedFast(),
      bookModel.getAllWithFilters?.() || Promise.resolve([]),
      userModel.allUsers(),
      adminModel.getGenres?.() || Promise.resolve([]),
      adminModel.getGalleries?.() || Promise.resolve([]),
      brandModel.getBrands?.() || Promise.resolve([]),
    ]);

    const services = servicesResult.status === "fulfilled" ? servicesResult.value : [];
    let bookings = bookingsResult.status === "fulfilled" ? bookingsResult.value : [];
    
    // ✅ FIXED: Handle userModel.allUsers() returning { users: [...] }
    let usersRes = usersResult.status === "fulfilled" ? usersResult.value : { users: [] };
    const registeredUsers = Array.isArray(usersRes) 
      ? usersRes 
      : (usersRes?.users || usersRes?.user || []);

    const genres = genresResult.status === "fulfilled" ? genresResult.value : [];
    const galleries = galleriesResult.status === "fulfilled" ? galleriesResult.value : [];
    const brands = brandsResult.status === "fulfilled" ? brandsResult.value : [];

    // ============================
    // STEP 4.5: EXTRACT CATEGORIES & PACKAGES FROM SERVICES
    // ============================
    let categories = [];
    let packages = [];

    services.forEach(service => {
      if (service.categories && Array.isArray(service.categories)) {
        service.categories.forEach(cat => {
          // Add service_id for normalization
          categories.push({ 
            ...cat, 
            service_id: service.id,
            id: cat.id || cat.category_id 
          }); 
          
          if (cat.packages && Array.isArray(cat.packages)) {
            cat.packages.forEach(pkg => {
              // Add metadata for normalization
              packages.push({ 
                ...pkg, 
                cat_id: cat.id || cat.category_id, 
                category_name: cat.name,
                service_id: service.id,
                id: pkg.id || pkg.package_id
              });
            });
          }
        });
      }
    });

    console.log('✅ [DATA] Extracted categories and packages:', {
      categories: categories.length,
      packages: packages.length
    });

    // ============================
    // STEP 5: BUILD GUEST USERS FROM UNLINKED BOOKINGS
    // Any booking that has no linked user id is treated as a guest/one-off client.
    // We key the guest map by email so multiple bookings from the same guest collapse
    // into a single record with aggregated booking count and spend.
    // ============================
    const guestMap = {}; // keyed by lowercased email

    if (Array.isArray(bookings)) {
      bookings.forEach((booking) => {
        const cust = booking.customer || {};

        // Try all common patterns for a canonical user id
        const custId =
          cust.id ||
          cust.userId ||
          booking.userId ||
          booking.user_id ||
          null;

        // Only process bookings that have no linked registered user
        if (!custId) {
          const email = (
            cust.email ||
            booking.customerEmail ||
            booking.customer_email ||
            booking.email ||
            ""
          ).toString().trim().toLowerCase();

          if (!email) return; // cannot identify a guest without an email

          if (!guestMap[email]) {
            guestMap[email] = {
              id: `guest_${Buffer.from(email).toString("hex").slice(0, 12)}`,
              name: cust.name || booking.customerName || booking.name || "Guest",
              email,
              isGuest: true,
              active: false,
              stats: {
                totalBookings: 0,
                totalSpent: 0,
              },
              // Use the earliest booking date as the "created at" for the guest record
              createdAt:
                booking.createdAt ||
                booking.created_at ||
                booking.date ||
                new Date().toISOString(),
              _original: {},
            };
          }

          // ✅ FIXED: Use totalBookings (not totalOrders)
          guestMap[email].stats.totalBookings += 1;
          guestMap[email].stats.totalSpent += Number(
            booking.amount || booking.total || booking.totalAmount || 0
          );

          // Track the most-recent interaction date
          const existingDate = new Date(guestMap[email].createdAt);
          // ✅ FIXED: Use booking object directly (not undefined 'o')
          const bookingDate = new Date(
            booking.createdAt || booking.created_at || booking.date || Date.now()
          );
          if (bookingDate > existingDate) {
            guestMap[email].createdAt = bookingDate.toISOString();
          }
        }
      });
    }

    const guestUsers = Object.values(guestMap);

    console.log('✅ [DATA] Built guest users:', {
      total: guestUsers.length,
      sample: guestUsers.length > 0 ? {
        email: guestUsers[0].email,
        bookings: guestUsers[0].stats.totalBookings,
        spent: guestUsers[0].stats.totalSpent
      } : 'none'
    });

    // ============================
    // STEP 6: MERGE REGISTERED + GUEST USERS
    // Registered users take precedence. If a guest email matches a registered
    // user we fold the guest booking stats into that registered record instead
    // of creating a duplicate entry.
    // ============================
    const usersById = new Map();

    // Seed the map with all registered users
    (registeredUsers || []).forEach((u) => {
      const id = String(u.id || u._id || u.user_id || u.userId || "");
      const email = (u.email || "").toString().toLowerCase();
      const key = id || email || `reg_${usersById.size}`;
      
      usersById.set(key, {
        ...u,
        id: key,
        isGuest: Boolean(u.isGuest) || false,
        stats: u.stats || u._stats || { totalBookings: 0, totalSpent: 0 },
      });
    });

    // Merge guest records — fold into registered where emails match
    guestUsers.forEach((g) => {
      const email = (g.email || "").toLowerCase();
      const registeredEntry = Array.from(usersById.values()).find(
        (ru) => (ru.email || "").toString().toLowerCase() === email
      );

      if (registeredEntry) {
        // Augment the registered user's stats with the guest booking data
        registeredEntry.stats = registeredEntry.stats || {};
        registeredEntry.stats.totalBookings = (registeredEntry.stats.totalBookings || 0) + (g.stats.totalBookings || 0);
        registeredEntry.stats.totalSpent = (registeredEntry.stats.totalSpent || 0) + (g.stats.totalSpent || 0);
      } else {
        // No registered match — add as a standalone guest record
        usersById.set(g.id, {
          id: g.id,
          name: g.name,
          email: g.email,
          isGuest: true,
          active: false,
          stats: g.stats,
          createdAt: g.createdAt,
          _original: g._original || {},
        });
      }
    });

    const users = Array.from(usersById.values());

    console.log('✅ [DATA] Merged user data:', {
      registered: registeredUsers.length,
      guests: guestUsers.length,
      total: users.length,
      withBookings: users.filter(u => (u.stats?.totalBookings || 0) > 0).length
    });

    // ============================
    // STEP 7: NORMALIZE DATA STRUCTURES
    // ============================

    // Normalize categories (add service info)
    const normalizedCategories = categories.map(cat => ({
      id: String(cat.id || cat.category_id),
      name: cat.name,
      description: cat.description || '',
      image: cat.image || null,
      genre_id: cat.genre_id || null,
      service_id: cat.service_id || null,
      _original: cat
    }));

    // Normalize packages (add category/service info)
    const normalizedPackages = packages.map(pkg => ({
      id: String(pkg.id || pkg.package_id),
      name: pkg.name,
      description: pkg.description || '',
      price: Number(pkg.price || 0),
      duration: pkg.duration || null,
      image: pkg.image || null,
      cat_id: String(pkg.cat_id || ''),
      category_name: pkg.category_name || '',
      features: Array.isArray(pkg.features) ? pkg.features : (pkg.features ? JSON.parse(pkg.features) : []),
      _original: pkg
    }));

    // Normalize genres
    const normalizedGenres = genres.map(g => ({
      id: String(g.genre_id || g.id),
      title: g.title || g.name,
      description: g.description || '',
      _original: g
    }));

    // Normalize galleries
    // SECURITY: this payload is served by GET /api/data with no auth middleware
    // (see dataRoutes.js). It previously included the raw bcrypt `password`
    // hash and the full `images` array for every gallery, protected or not —
    // meaning anyone could read every client's photos and crack their gallery
    // password offline, making the password gate in getPublicGalleryByToken
    // pointless. Only non-sensitive metadata goes out here; full images are
    // fetched per-gallery through the admin-authenticated routes or the
    // password/grant-gated public token route.
    const normalizedGalleries = galleries.map(gal => ({
      id: String(gal.gallery_id || gal.id),
      title: gal.title || 'Untitled',
      user_id: gal.user_id || null,
      client: gal.client || null,
      client_email: (gal.client_email || '').toLowerCase().trim() || null,
      description: gal.description || '',
      category: gal.category || null,
      location: gal.location || null,
      date: gal.date || null,
      genre_id: gal.genre_id || null,
      thumbnail: gal.thumbnail || null,
      status: gal.status || 'draft',
      isProtected: !!gal.password,
      downloadable: Boolean(gal.downloadable),
      views: Number(gal.views || 0),
      downloads: Number(gal.downloads || 0),
      imageCount: Number(gal.imageCount || (Array.isArray(gal.images) ? gal.images.length : 0)),
      approved: gal.approved !== false,
    }));

    // Normalize brands
    const normalizedBrands = brands.map(b => ({
      id: String(b.brand_id || b.id),
      name: b.name || 'Unknown Brand',
      description: b.description || null,
      icon: b.icon || b.logo || null,
      slug: b.slug || '',
      active: b.active === 1 || b.active === true,
      _original: b
    }));

    console.log("✅ [DATA] Fetch complete:");
    console.log(`   - Services:   ${services.length}`);
    console.log(`   - Categories: ${normalizedCategories.length}`);
    console.log(`   - Packages:   ${normalizedPackages.length}`);
    console.log(`   - Genres:     ${normalizedGenres.length}`);
    console.log(`   - Galleries:  ${normalizedGalleries.length}`);
    console.log(`   - Brands:     ${normalizedBrands.length}`);
    console.log(`   - Bookings:   ${bookings.length}`);
    console.log(`   - Users (registered + guests): ${users.length}`);

    // ============================
    // STEP 8: BUILD LOOKUP MAPS
    // ============================

    // packages keyed by their parent category id
    const packagesByCategory = {};
    // category ids keyed by their parent service id
    const categoriesByService = {};
    // galleries keyed by category
    const galleriesByCategory = {};

    normalizedPackages.forEach((pkg) => {
      const catId = pkg.cat_id;
      packagesByCategory[catId] ||= [];
      packagesByCategory[catId].push(pkg.id);
    });

    services.forEach((service) => {
      categoriesByService[String(service.id)] = (service.categories || []).map((c) => String(c.id || c.category_id));
    });

    normalizedGalleries.forEach((gal) => {
      const catId = gal.category || 'uncategorized';
      galleriesByCategory[catId] ||= [];
      galleriesByCategory[catId].push(gal.id);
    });

    // Events grouped by status, plus a sorted list of booked dates for calendar use
    const eventsByStatus = {};
    const bookedDates = [];

    const events = normalizeBookingsToEvents(bookings);
    events.forEach((event) => {
      const status = event.status || "pending";
      eventsByStatus[status] ||= [];
      eventsByStatus[status].push(event.id);

      if (event.date && !bookedDates.includes(event.date)) {
        bookedDates.push(event.date);
      }
    });

    // Users with at least one booking (used in stats)
    const usersWithBookings = users.filter((u) => (u.stats?.totalBookings || 0) > 0);

    // ============================
    // STEP 9: STATISTICS
    // ============================
    const totalRevenue = bookings
      .filter((b) => b.payment_status === "completed" || b.status === "completed")
      .reduce((sum, b) => sum + (Number(b.amount) || 0), 0);

    const avgBookingValue = bookings.length
      ? (bookings.reduce((sum, b) => sum + (Number(b.amount) || 0), 0) / bookings.length)
      : 0;

    const stats = {
      services: {
        total: services.length,
        active: services.filter((s) => s.active === 1 || s.active === true).length,
      },

      categories: {
        total: normalizedCategories.length,
      },

      packages: {
        total: normalizedPackages.length,
        avgPrice: normalizedPackages.length
          ? (normalizedPackages.reduce((sum, p) => sum + (p.price || 0), 0) / normalizedPackages.length).toFixed(2)
          : 0,
      },

      bookings: {
        total: bookings.length,
        pending: eventsByStatus.pending?.length || 0,
        confirmed: eventsByStatus.confirmed?.length || 0,
        completed: eventsByStatus.completed?.length || 0,
        cancelled: eventsByStatus.cancelled?.length || 0,
        totalRevenue: totalRevenue.toFixed(2),
        avgBookingValue: avgBookingValue.toFixed(2),
      },

      events: {
        total: events.length,
        upcoming: events.filter((e) => new Date(e.date) >= new Date()).length,
      },

      galleries: {
        total: normalizedGalleries.length,
        withImages: normalizedGalleries.filter(g => g.imageCount > 0).length,
      },

      genres: {
        total: normalizedGenres.length,
      },

      brands: {
        total: normalizedBrands.length,
        active: normalizedBrands.filter(b => b.active === 1).length,
      },

      users: {
        total: users.length,
        registered: registeredUsers.length,
        guests: guestUsers.length,
        active: users.filter((u) => u.active || u.status === "active").length,
        withBookings: usersWithBookings.length,
      },
    };

    // ============================
    // STEP 10: BUILD + CACHE RESPONSE
    // ============================
    const fetchDuration = Date.now() - startTime;
    const timestamp = new Date().toISOString();

    cachedResponse = {
      success: true,
      message: "Portfolio data fetched successfully",

      // Full nested structures — used where deep traversal is needed (e.g. service detail pages)
      nested: {
        services,
        users,
        galleries: normalizedGalleries,
        brands: normalizedBrands,
      },

      // Flat arrays — used for lists, tables, and selects in the admin dashboard
      flat: {
        services: services.map((s) => ({
          id: String(s.id),
          name: s.name,
          description: s.description || '',
          icon: s.icon || null,
          image: s.image || null,
          active: s.active,
          categoryCount: (s.categories || []).length,
        })),

        categories: normalizedCategories,

        packages: normalizedPackages,

        bookings: bookings.map((b) => ({
          id: String(b.id || b._id),
          user_id: b.user_id || b.userId || null,
          bookingNo: b.bookingNo,
          status: b.status || b.payment_status,
          amount: b.amount || b.total,
          clientName: b.name || b.customerName || b.customer,
          email: b.email || b.customerEmail || b.customer_email,
          phone: b.phone || b.customerPhone || b.customer_phone,
          service: b.service || b.sessionType || b.category,
          package: b.package || b.packageName,
          date: b.date,
          time: b.time,
          location: b.location,
          createdAt: b.createdAt || b.created_at,
        })),

        events,

        galleries: normalizedGalleries,

        genres: normalizedGenres,

        brands: normalizedBrands,

        // Registered + merged guest users
        users: users.map((u) => ({
          id: String(u.id),
          name: u.name || 'Unknown',
          email: u.email || '',
          phone: u.phone || '',
          role: u.role || 'client',
          status: u.status || 'active',
          isGuest: u.isGuest || false,
          totalBookings: u.stats?.totalBookings || 0,
          totalSpent: u.stats?.totalSpent || 0,
          createdAt: u.createdAt,
        })),

        // Convenience split for the UserManagement page view toggle
        registeredUsers: registeredUsers.map((u) => ({
          id: String(u.id || u._id || u.user_id),
          name: u.name || 'Unknown',
          email: u.email || '',
          phone: u.phone || '',
          role: u.role || 'client',
          status: u.status || 'active',
          isGuest: false,
          totalBookings: u.stats?.totalBookings || 0,
          totalSpent: u.stats?.totalSpent || 0,
          createdAt: u.createdAt,
        })),

        guestUsers: guestUsers.map((g) => ({
          id: g.id,
          name: g.name,
          email: g.email,
          role: "client",
          status: "inactive",
          isGuest: true,
          totalBookings: g.stats?.totalBookings || 0,
          totalSpent: g.stats?.totalSpent || 0,
          createdAt: g.createdAt,
        })),
      },

      // Pre-built lookup maps — avoids repeated O(n) scans on the frontend
      lookups: {
        packagesByCategory,
        categoriesByService,
        galleriesByCategory,
        eventsByStatus,
      },

      // Actionable counts surfaced directly in the admin dashboard alerts widget
      alerts: {
        pendingBookings: eventsByStatus.pending?.length || 0,
        overdueBookings: eventsByStatus.overdue?.length || 0,
        pendingGalleries: normalizedGalleries.filter(g => !g.approved).length || 0,
        upcomingEvents: events.filter((e) => new Date(e.date) >= new Date()).length,
      },

      stats,

      metadata: {
        fetchDuration: `${fetchDuration}ms`,
        fetchedAt: timestamp,
        cacheDuration: CACHE_DURATION,
        expiresAt: new Date(Date.now() + CACHE_DURATION).toISOString(),
        dataVersion: "4.0",
        bookedDates: bookedDates.sort(),
      },
    };

    cacheTimestamp = Date.now();
    fetchInProgress = false;

    // Resolve all queued requests with the freshly built response
    waitingRequests.forEach((fn) => fn(cachedResponse));
    waitingRequests.length = 0;

    return res.status(200).json({ ...cachedResponse, fromCache: false });

  } catch (error) {
    fetchInProgress = false;

    const errorResponse = {
      success: false,
      error: "Failed to fetch portfolio data",
      details: error.message,
    };

    waitingRequests.forEach((fn) => fn(errorResponse));
    waitingRequests.length = 0;

    console.error("❌ [DATA] Fatal error:", error);
    return res.status(500).json(errorResponse);
  }
};

// ============================================================================
// FORCE CACHE REFRESH
// Clears the in-memory cache and triggers a fresh fetch immediately.
// ============================================================================
exports.refreshCache = async (req, res) => {
  console.log("🔄 [DATA] Force cache refresh requested");
  cachedResponse = null;
  cacheTimestamp = null;
  return exports.getAllData(req, res);
};

// ============================================================================
// CACHE STATUS
// Returns current cache metadata — useful for debugging and health checks.
// ============================================================================
exports.getCacheStatus = (req, res) => {
  const now = Date.now();
  const isCached = cachedResponse && cacheTimestamp;
  const cacheAge = isCached ? Math.floor((now - cacheTimestamp) / 1000) : null;
  const timeToExpiry = isCached ? Math.max(0, Math.floor((CACHE_DURATION - (now - cacheTimestamp)) / 1000)) : null;

  return res.json({
    success: true,
    cache: {
      exists: !!isCached,
      ageSeconds: cacheAge,
      expiresInSeconds: timeToExpiry,
      fetchInProgress,
      waitingRequests: waitingRequests.length,
      lastFetch: cacheTimestamp ? new Date(cacheTimestamp).toISOString() : null,
    },
  });
};

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Normalize raw booking rows into the event shape the calendar and booking
 * management page expect. Keeps field names consistent regardless of DB column
 * naming conventions (snake_case vs camelCase).
 */
function normalizeBookingsToEvents(bookings) {
  return (bookings || []).map((b) => ({
    id: b.id?.toString() || b.bookingNo,
    title: b.package || b.service || "Photography Session",
    clientName: b.name || b.clientName || b.customer || b.customerName,
    email: b.email || b.customerEmail || b.customer_email,
    phone: b.phone || b.customerPhone || b.customer_phone,
    location: b.location || "N/A",
    amount: b.amount ? parseFloat(b.amount) : 0,
    date: b.date,
    time: b.time,
    status: b.payment_status || b.status || "pending",
    paymentStatus: b.payment_status || "pending",
    paid: b.payment_status === "completed" || Boolean(b.paid),
    confirmed: b.payment_status === "completed" || Boolean(b.confirmed),
    bookingNo: b.bookingNo,
    paymentMethod: b.payment_method,
    createdAt: b.createdAt || b.created_at,
    source: "database",
  }));
}