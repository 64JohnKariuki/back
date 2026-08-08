// controllers/dataController.js
const productModel = require("../models/productModel");
const categoryModel = require("../models/catModel");
const vendorModel = require("../models/vendorModel");
const orderModel = require("../models/orderModel");
const userModel = require("../models/userModel");
const brandModel = require("../models/brandModel");
const { connectRedis } = require("../config/redis");

// ============================================================================
// CACHE CONFIGURATION
// ============================================================================
let fetchInProgress = false;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const CACHE_KEY = "portfolio:allData";

// Queue for waiting requests
const waitingRequests = [];

/**
 * ✅ MAIN DATA FETCH CONTROLLER
 * Fetches all e-commerce data with nested structures and caching
 */
exports.getAllData = async (req, res) => {
  const redis = await connectRedis();
  try {
    console.log("🔥 getAllData HIT");
    // ============================
    // STEP 1: CACHE CHECK
    // ============================
    const cachedData = await redis.get(CACHE_KEY);
    if (cachedData) {
      console.log("📦 Returning data from Redis");
      return res.status(200).json({
        ...JSON.parse(cachedData),
        fromCache: true
      });
    }

    // ============================
    // STEP 2: HANDLE CONCURRENT REQUESTS
    // ============================
    if (fetchInProgress) {
      console.log("⏳ [DATA] Fetch in progress, queuing request...");

      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          resolve(
            res.status(503).json({
              success: false,
              error: "Request timeout - data fetch taking too long",
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
    // STEP 4: FETCH DATA IN PARALLEL
    // ============================
    const [
      productsNested,
      categoriesData,
      vendorsWithProducts,
      ordersNested,
      usersWithStats,
      brandsNested
    ] = await Promise.allSettled([
      productModel.getAllProductsNested(),
      categoryModel.getAllCategoriesNested(),
      vendorModel.getAllVendorsWithProducts(),
      orderModel.getAllOrdersNested(100),
      userModel.getAllUsersWithStats(),
      brandModel.getBrands()
    ]);

    const brands = brandsNested.status === "fulfilled" ? brandsNested.value : []; // 3. Extract Brands
    
    const products =
      productsNested.status === "fulfilled" ? productsNested.value : [];

    const categories =
      categoriesData.status === "fulfilled"
        ? categoriesData.value
        : {
            nested: [],
            flat: {
              parents: [],
              categories: [],
              subcategories: [],
              all: []
            },
          };

    const vendors =
      vendorsWithProducts.status === "fulfilled"
        ? vendorsWithProducts.value
        : [];

    const orders =
      ordersNested.status === "fulfilled" ? ordersNested.value : [];

    const registeredUsers =
      usersWithStats.status === "fulfilled" ? usersWithStats.value : [];

    // ============================
    // STEP 4.5: INCLUDE GUEST (ORDER-ONLY) USERS
    // We create lightweight guest user records from orders where there is no user id.
    // This ensures UI can display guests (loyal vs guest) and aggregate orders/spend per guest.
    // ============================
    const guestMap = {}; // keyed by email (lowercased)
    orders.forEach((o) => {
      const cust = o.customer || {};
      // try multiple places for a canonical user id
      const custId =
        cust.id ||
        cust.userId ||
        o.userId ||
        o.user_id ||
        null;

      // If there is no linked user id, treat this as a guest/one-off customer
      if (!custId) {
        const email =
          (cust.email || o.customerEmail || o.customer_email || "").toString().trim().toLowerCase();
        if (!email) return; // cannot identify guest without email

        if (!guestMap[email]) {
          guestMap[email] = {
            id: `guest_${Buffer.from(email).toString('hex').slice(0, 12)}`,
            name: cust.name || o.customerName || "Guest",
            email,
            isGuest: true,
            active: false,
            stats: {
              totalOrders: 0,
              totalSpent: 0
            },
            createdAt: o.createdAt || o.created_at || o.date || new Date().toISOString(),
            _original: {}
          };
        }

        guestMap[email].stats.totalOrders += 1;
        guestMap[email].stats.totalSpent += Number(o.grandTotal || o.total || o.totalAmount || 0);
        // store latest order date as last seen
        const existingDate = new Date(guestMap[email].createdAt);
        const orderDate = new Date(o.createdAt || o.created_at || o.date || Date.now());
        if (orderDate > existingDate) guestMap[email].createdAt = orderDate.toISOString();
      }
    });

    const guestUsers = Object.values(guestMap);

    // ============================
    // STEP 5: MERGE REGISTERED AND GUEST USERS (dedupe by email when possible)
    // ============================
    const usersById = new Map();

    // Normalize registered users
    (registeredUsers || []).forEach((u) => {
      const id = String(u.id || u._id || u.userId || "");
      const email = (u.email || "").toString().toLowerCase();
      usersById.set(id || email || `reg_${usersById.size}`, {
        ...u,
        id: id || email || `reg_${usersById.size}`,
        isGuest: Boolean(u.isGuest) || false,
        stats: u.stats || u._stats || {}
      });
    });

    // Merge guest users: if email matches existing registered user, merge stats; otherwise add guest record
    guestUsers.forEach((g) => {
      const email = (g.email || "").toLowerCase();
      // find registered user by email
      const registeredEntry = Array.from(usersById.values()).find(
        (ru) => (ru.email || "").toString().toLowerCase() === email
      );

      if (registeredEntry) {
        // augment stats on registered user
        registeredEntry.stats = registeredEntry.stats || {};
        registeredEntry.stats.totalOrders = (registeredEntry.stats.totalOrders || 0) + (g.stats.totalOrders || 0);
        registeredEntry.stats.totalSpent = (registeredEntry.stats.totalSpent || 0) + (g.stats.totalSpent || 0);
      } else {
        // add as guest
        usersById.set(g.id, {
          id: g.id,
          name: g.name,
          email: g.email,
          isGuest: true,
          active: false,
          stats: g.stats,
          createdAt: g.createdAt,
          _original: g._original || {}
        });
      }
    });

    const users = Array.from(usersById.values());

    console.log(`✅ [DATA] Fetch complete:`)
    console.log(`   - Products: ${products.length}`);
    console.log(`   - Categories: ${categories.flat.all.length}`);
    console.log(`   - Vendors: ${vendors.length}`);
    console.log(`   - Orders: ${orders.length}`);
    console.log(`   - Users (registered + guests): ${users.length}`);

    // ============================
    // STEP 6: LOOKUP MAPS
    // ============================
    const productsByParentCategory = {};
    const productsByCategory = {};
    const productsBySubcategory = {};

    products.forEach((product) => {
      const parent = product.categoryHierarchy?.parent?.id;
      const cat = product.categoryHierarchy?.category?.id;
      const sub = product.categoryHierarchy?.subcategory?.id;

      if (parent) {
        productsByParentCategory[parent] ||= [];
        productsByParentCategory[parent].push(product.id);
      }

      if (cat) {
        productsByCategory[cat] ||= [];
        productsByCategory[cat].push(product.id);
      }

      if (sub) {
        productsBySubcategory[sub] ||= [];
        productsBySubcategory[sub].push(product.id);
      }
    });

    // Products by vendor
    const productsByVendor = {};
    products.forEach((p) => {
      const vendorId = p.vendor?.id;
      if (!vendorId) return;
      productsByVendor[vendorId] ||= [];
      productsByVendor[vendorId].push(p.id);
    });

    // Orders by status
    const ordersByStatus = {};
    orders.forEach((o) => {
      const status = o.status || "pending";
      ordersByStatus[status] ||= [];
      ordersByStatus[status].push(o.orderId);
    });

    // Orders by vendor
    const ordersByVendor = {};
    orders.forEach((order) => {
      order.items?.forEach((item) => {
        const vendorId = item.vendor?.id;
        if (!vendorId) return;

        ordersByVendor[vendorId] ||= [];
        if (!ordersByVendor[vendorId].includes(order.orderId)) {
          ordersByVendor[vendorId].push(order.orderId);
        }
      });
    });

    // Featured products
    const featuredProductIds = products.filter((p) => p.featured).map((p) => p.id);

    // Low stock
    const lowStockProducts = products
      .filter((p) => p.stock < p.lowStockThreshold && p.stock > 0)
      .map((p) => ({
        id: p.id,
        name: p.name,
        stock: p.stock,
      }));

    // Out of stock
    const outOfStockProducts = products
      .filter((p) => p.stock === 0)
      .map((p) => ({
        id: p.id,
        name: p.name,
      }));

    // ============================
    // STEP 7: STATISTICS
    // ============================

    const stats = {
      products: {
        total: products.length,
        active: products.filter((p) => p.status === "active").length,
        featured: featuredProductIds.length,
        lowStock: lowStockProducts.length,
        outOfStock: outOfStockProducts.length,
        avgPrice:
          products.length === 0
            ? 0
            : (
                products.reduce((sum, p) => sum + p.price, 0) /
                products.length
              ).toFixed(2),
        totalValue: products
          .reduce((sum, p) => sum + p.price * p.stock, 0)
          .toFixed(2),
      },

      categories: {
        total: categories.flat.all.length,
        root: categories.nested.length,
        withProducts: Object.keys(productsByCategory).length,
      },

      vendors: {
        total: vendors.length,
        verified: vendors.filter((v) => v.isVerified).length,
        active: vendors.filter((v) => v.status === "active").length,
        totalRevenue: vendors
          .reduce((sum, v) => sum + (v.stats?.totalRevenue || 0), 0)
          .toFixed(2),
      },

      orders: {
        total: orders.length,
        pending: ordersByStatus.pending?.length || 0,
        processing: ordersByStatus.processing?.length || 0,
        completed: ordersByStatus.completed?.length || 0,
        cancelled: ordersByStatus.cancelled?.length || 0,
        totalRevenue: orders
          .filter((o) => o.status === "completed")
          .reduce((sum, o) => sum + o.grandTotal, 0)
          .toFixed(2),
        avgOrderValue:
          orders.length === 0
            ? 0
            : (
                orders.reduce((sum, o) => sum + o.grandTotal, 0) /
                orders.length
              ).toFixed(2),
      },

      users: {
        total: users.length,
        active: users.filter((u) => u.active || u.status === "active").length,
        withOrders: users.filter((u) => (u.stats?.totalOrders || 0) > 0).length,
      },

      brands: {
        total: brands.length,           
        active: brands.filter(b => b.status === "active" || b.active === 1).length, 
      },
    };

    // ============================
    // STEP 8: CACHE + RESPONSE
    // ============================
    const fetchDuration = Date.now() - startTime;
    const timestamp = new Date().toISOString();

    const cachedResponse = {
      success: true,
      message: "E-commerce data fetched successfully",

      nested: {
        products,
        categories: categories.nested,
        vendors,
        orders,
        users,
        brands,
      },

      flat: {
        products,
        parentCategories: categories.flat.parents,
        categories: categories.flat.categories,
        subcategories: categories.flat.subcategories,
        allCategories: categories.flat.all,

        vendors: vendors.map((v) => ({
          id: v.id,
          businessName: v.businessName,
          email: v.email,
          logo: v.logo,
          rating: v.rating,
          isVerified: v.isVerified,
          status: v.status,
        })),

        orders: orders.map((o) => ({
          orderId: o.orderId,
          orderNo: o.orderNo,
          status: o.status,
          total: o.grandTotal,
          customer: o.customer,
          createdAt: o.createdAt,
        })),

        brands: brands.map((b) => ({
          id: b.id || b._id,
          name: b.name,
          slug: b.slug,
          logo: b.icon,
          status: b.status || (b.active === 1 ? "active" : "inactive"),
        })),
      },

      lookups: {
        productsByParentCategory,
        productsByCategory,
        productsBySubcategory,
        productsByVendor,
        ordersByStatus,
        ordersByVendor,
        featuredProducts: featuredProductIds,
      },

      alerts: {
        lowStock: lowStockProducts,
        outOfStock: outOfStockProducts,
        pendingOrders: ordersByStatus.pending?.length || 0,
        unverifiedVendors: vendors.filter((v) => !v.isVerified).length,
      },

      stats,

      metadata: {
        fetchDuration: `${fetchDuration}ms`,
        fetchedAt: timestamp,
        cacheDuration: CACHE_DURATION,
        expiresAt: new Date(Date.now() + CACHE_DURATION).toISOString(),
        dataVersion: "1.0",
      },
    };

    fetchInProgress = false;
    waitingRequests.forEach((fn) => fn(cachedResponse));
    waitingRequests.length = 0;

    // 5. Save to Redis with Expiry (e.g., 5 minutes)
    await redis.setEx(CACHE_KEY, 300, JSON.stringify(cachedResponse));
    
    fetchInProgress = false;

    return res.status(200).json({
      ...cachedResponse,
      fromCache: false,
    });

  } catch (error) {
    fetchInProgress = false;
    waitingRequests.length = 0; // Clear queue on error
    return res.status(500).json({ success: false, error: "Failed to fetch e-commerce data", details: error.message });
  }
};

/**
 * ✅ FORCE CACHE REFRESH
 * Allows manual cache invalidation
 */
exports.refreshCache = async (req, res) => {
  const redis = await connectRedis();
  
  // 1. Delete the key from Redis
  await redis.del(CACHE_KEY); 
  
  console.log("🔄 [DATA] Redis cache cleared");

  // 2. Trigger a fresh fetch
  return exports.getAllData(req, res);
};

/**
 * ✅ GET CACHE STATUS
 * Returns current cache information
 */
exports.getCacheStatus = async (req, res) => {
  try {
    const redis = await connectRedis();
    const CACHE_KEY = "portfolio:allData";

    // Ask Redis for the Time To Live (TTL) in seconds
    // Returns -2 if key doesn't exist, -1 if no expiry
    const ttl = await redis.ttl(CACHE_KEY);
    const isCached = ttl > 0;

    res.json({
      success: true,
      cache: {
        exists: isCached,
        // Since Redis counts down, we calculate age by subtracting 
        // remaining time from the original TTL (e.g., 300)
        expiresInSeconds: isCached ? ttl : 0,
        ageSeconds: isCached ? (300 - ttl) : null, 
        
        // These stay the same as they manage the local "Waiting Room"
        fetchInProgress,
        waitingRequests: waitingRequests.length,
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};