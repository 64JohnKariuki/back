const pool = require("../config/db");

// Fetch all services with their packages
exports.getServices = (req, res) => {
  return new Promise((resolve, reject) => {
    const query = "SELECT * FROM services";
    pool.query(query, (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
};

// Fetch all services with their packages
exports.getPack = (package) => {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT 
        s.*
      FROM packages p
      INNER JOIN categories c ON c.id = p.category_id
      INNER JOIN services s ON s.id = c.service_id
      WHERE p.name = ?
      LIMIT 1
    `;

    pool.query(query, [package], (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result[0]);  // return single service
      }
    });
  });
};

/**
 * ✅ Single JOIN query (fastest, but complex result parsing)
 * Use this to fetch nested data from services -> categories -> packages -> features.
 */
exports.getAllServicesJoined = async () => {
  try {
    console.log('📦 [MODEL] Starting getAllServicesJoined...');

    // Step 1: Fetch all active services
    const servicesResult = await pool.query(`
      SELECT id, name, description, icon, image, active
      FROM services
      WHERE active = 1
      ORDER BY id ASC
    `);

    // Extract services (handle both mysql and mysql2 result formats)
    let services = Array.isArray(servicesResult) 
      ? (Array.isArray(servicesResult[0]) ? servicesResult[0] : servicesResult)
      : [];

    console.log(`📊 [MODEL] Found ${services.length} active services`);

    if (services.length === 0) {
      console.log('⚠️ [MODEL] No active services found in database');
      return [];
    }

    // Step 2: Fetch all categories for these services
    const serviceIds = services.map(s => s.id);
    const categoriesResult = await pool.query(`
      SELECT id, service_id, name, description, image, sort_order
      FROM categories
      WHERE service_id IN (?) AND active = 1
      ORDER BY service_id ASC, sort_order ASC
    `, [serviceIds]);

    let categories = Array.isArray(categoriesResult)
      ? (Array.isArray(categoriesResult[0]) ? categoriesResult[0] : categoriesResult)
      : [];

    console.log(`📊 [MODEL] Found ${categories.length} categories`);

    // Step 3: Fetch all packages for these categories
    let packages = [];
    if (categories.length > 0) {
      const categoryIds = categories.map(c => c.id);
      const packagesResult = await pool.query(`
        SELECT id, category_id, name, description, price, duration, image, sort_order
        FROM packages
        WHERE category_id IN (?) AND active = 1
        ORDER BY category_id ASC, sort_order ASC
      `, [categoryIds]);

      packages = Array.isArray(packagesResult)
        ? (Array.isArray(packagesResult[0]) ? packagesResult[0] : packagesResult)
        : [];

      console.log(`📊 [MODEL] Found ${packages.length} packages`);
    }

    // Step 4: Fetch all features for these packages
    let features = [];
    if (packages.length > 0) {
      const packageIds = packages.map(p => p.id);
      const featuresResult = await pool.query(`
        SELECT id, package_id, title, duration, extra_info
        FROM package_features
        WHERE package_id IN (?)
        ORDER BY package_id ASC, id ASC
      `, [packageIds]);

      features = Array.isArray(featuresResult)
        ? (Array.isArray(featuresResult[0]) ? featuresResult[0] : featuresResult)
        : [];

      console.log(`📊 [MODEL] Found ${features.length} features`);
    }

    // Step 5: Build nested structure
    console.log('🔨 [MODEL] Building nested structure...');

    // Group features by package_id
    const featuresByPackage = features.reduce((acc, feature) => {
      if (!acc[feature.package_id]) {
        acc[feature.package_id] = [];
      }
      acc[feature.package_id].push({
        id: feature.id,
        title: feature.title,
        duration: feature.duration,
        extra_info: feature.extra_info
      });
      return acc;
    }, {});

    // Attach features to packages and group by category_id
    const packagesByCategory = packages.reduce((acc, pkg) => {
      if (!acc[pkg.category_id]) {
        acc[pkg.category_id] = [];
      }
      acc[pkg.category_id].push({
        id: pkg.id,
        name: pkg.name,
        description: pkg.description,
        price: pkg.price,
        duration: pkg.duration,
        image: pkg.image,
        sort_order: pkg.sort_order,
        features: featuresByPackage[pkg.id] || []
      });
      return acc;
    }, {});

    // Attach packages to categories and group by service_id
    const categoriesByService = categories.reduce((acc, cat) => {
      if (!acc[cat.service_id]) {
        acc[cat.service_id] = [];
      }
      acc[cat.service_id].push({
        id: cat.id,
        name: cat.name,
        description: cat.description,
        image: cat.image,
        sort_order: cat.sort_order,
        packages: packagesByCategory[cat.id] || []
      });
      return acc;
    }, {});

    // Attach categories to services
    const servicesWithRelations = services.map(service => ({
      id: service.id,
      name: service.name,
      description: service.description,
      icon: service.icon,
      image: service.image,
      active: service.active,
      categories: categoriesByService[service.id] || []
    }));

    console.log('✅ [MODEL] Successfully built nested structure:');
    console.log(`   └─ ${servicesWithRelations.length} services`);
    servicesWithRelations.forEach(s => {
      console.log(`      └─ ${s.name}: ${s.categories.length} categories`);
      s.categories.forEach(c => {
        console.log(`         └─ ${c.name}: ${c.packages.length} packages`);
        c.packages.forEach(p => {
          console.log(`            └─ ${p.name}: ${p.features.length} features`);
        });
      });
    });

    return servicesWithRelations;

  } catch (error) {
    console.error('❌ [MODEL] Error in getAllServicesJoined:', error);
    console.error('Stack trace:', error.stack);
    throw error;
  }
};

exports.getAllServicesJoinedFast = () => {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT 
        s.id AS service_id,
        s.name AS service_name,
        
        c.id AS category_id,
        c.name AS category_name,
        c.description AS category_description,
        c.image AS category_image,
        c.sort_order AS category_sort_order,
        
        p.id AS package_id,
        p.name AS package_name,
        p.description AS package_description,
        p.price AS package_price,
        p.duration AS package_duration,
        p.image AS package_image,
        p.sort_order AS package_sort_order
      FROM services s
      LEFT JOIN categories c ON c.service_id = s.id
      LEFT JOIN packages p ON p.category_id = c.id
      ORDER BY s.id, c.id, p.sort_order;
    `;

    pool.query(query, [], (err, rows) => {
      if (err) return reject(err);

      const servicesMap = {};

      rows.forEach(row => {
        const sId = row.service_id;
        const cId = row.category_id;
        const pId = row.package_id;

        // Service
        if (!servicesMap[sId]) {
          servicesMap[sId] = {
            id: sId,
            name: row.service_name,
            categories: []
          };
        }

        const service = servicesMap[sId];

        // Category
        if (cId && !service.categories.find(c => c.id === cId)) {
          service.categories.push({
            id: cId,
            name: row.category_name,
            description: row.category_description,
            image: row.category_image,
            sort_order: row.category_sort_order,
            packages: []
          });
        }

        const category = service.categories.find(c => c.id === cId);

        // Package
        if (category && pId) {
          category.packages.push({
            id: pId,
            name: row.package_name,
            description: row.package_description,
            price: row.package_price,
            duration: row.package_duration,
            image: row.package_image,
            sort_order: row.package_sort_order
          });
        }
      });

      resolve(Object.values(servicesMap));
    });
  });
};

// ============================================================================
// QUICK FIX: Modified getAllServicesJoinedFast to include inactive services
// ============================================================================

exports.getAllServicesJoinedFastDebug = async () => {
  try {
    console.log('📦 [MODEL] Fetching services (including inactive for debug)...');

    // Step 1: Fetch ALL services (remove active filter temporarily)
    const servicesResult = await pool.query(`
      SELECT * FROM services
    `);

    let services = Array.isArray(servicesResult) 
      ? (Array.isArray(servicesResult[0]) ? servicesResult[0] : servicesResult)
      : [];

    console.log(`📊 [MODEL] Found ${services.length} total services`);
    
    if (services.length === 0) {
      console.log('⚠️ [MODEL] NO SERVICES EXIST IN DATABASE!');
      console.log('💡 [MODEL] Please check if:');
      console.log('   1. Services table exists');
      console.log('   2. Table has been seeded with data');
      console.log('   3. Database connection is correct');
      return [];
    }

    // Log each service's active status
    services.forEach(s => {
      console.log(`   ${s.active ? '✅' : '❌'} Service: ${s.name} (ID: ${s.id}, Active: ${s.active})`);
    });

    // Continue with only active services
    const activeServices = services.filter(s => s.active === 1);
    
    if (activeServices.length === 0) {
      console.log('⚠️ [MODEL] All services are INACTIVE!');
      console.log('💡 [MODEL] Run this SQL to activate all services:');
      console.log('   UPDATE services SET active = 1;');
      return [];
    }

    console.log(`📊 [MODEL] Proceeding with ${activeServices.length} active services`);

    // Step 2: Fetch categories for active services only
    const serviceIds = activeServices.map(s => s.id);
    const categoriesResult = await pool.query(`
      SELECT * FROM categories WHERE service_id = ?
    `, [serviceIds]);

    let categories = Array.isArray(categoriesResult)
      ? (Array.isArray(categoriesResult[0]) ? categoriesResult[0] : categoriesResult)
      : [];

    console.log(`📊 [MODEL] Found ${categories.length} total categories`);
    const activeCategories = categories.filter(c => c.active === 1);
    console.log(`📊 [MODEL] Found ${activeCategories.length} active categories`);

    // Step 3: Fetch packages
    let packages = [];
    if (activeCategories.length > 0) {
      const categoryIds = activeCategories.map(c => c.id);
      const packagesResult = await pool.query(`
        SELECT * FROM packages WHERE category_id = ? 
      `, [categoryIds]);

      packages = Array.isArray(packagesResult)
        ? (Array.isArray(packagesResult[0]) ? packagesResult[0] : packagesResult)
        : [];

      console.log(`📊 [MODEL] Found ${packages.length} total packages`);
      const activePackages = packages.filter(p => p.active === 1);
      console.log(`📊 [MODEL] Found ${activePackages.length} active packages`);
      packages = activePackages;
    }

    // Step 4: Fetch features
    let features = [];
    if (packages.length > 0) {
      const packageIds = packages.map(p => p.id);
      const featuresResult = await pool.query(`
        SELECT * FROM package_features WHERE package_id = ?
      `, [packageIds]);

      features = Array.isArray(featuresResult)
        ? (Array.isArray(featuresResult[0]) ? featuresResult[0] : featuresResult)
        : [];

      console.log(`📊 [MODEL] Found ${features.length} features`);
    }

    // Step 5: Build nested structure (same as before)
    console.log('🔨 [MODEL] Building nested structure...');

    const featuresByPackage = features.reduce((acc, feature) => {
      if (!acc[feature.package_id]) {
        acc[feature.package_id] = [];
      }
      acc[feature.package_id].push({
        id: feature.id,
        title: feature.title,
        duration: feature.duration,
        extra_info: feature.extra_info
      });
      return acc;
    }, {});

    const packagesByCategory = packages.reduce((acc, pkg) => {
      if (!acc[pkg.category_id]) {
        acc[pkg.category_id] = [];
      }
      acc[pkg.category_id].push({
        id: pkg.id,
        name: pkg.name,
        description: pkg.description,
        price: pkg.price,
        duration: pkg.duration,
        image: pkg.image,
        sort_order: pkg.sort_order,
        features: featuresByPackage[pkg.id] || []
      });
      return acc;
    }, {});

    const categoriesByService = activeCategories.reduce((acc, cat) => {
      if (!acc[cat.service_id]) {
        acc[cat.service_id] = [];
      }
      acc[cat.service_id].push({
        id: cat.id,
        name: cat.name,
        description: cat.description,
        image: cat.image,
        sort_order: cat.sort_order,
        packages: packagesByCategory[cat.id] || []
      });
      return acc;
    }, {});

    const servicesWithRelations = activeServices.map(service => ({
      id: service.id,
      name: service.name,
      description: service.description,
      icon: service.icon,
      image: service.image,
      active: service.active,
      categories: categoriesByService[service.id] || []
    }));

    console.log('✅ [MODEL] Successfully built nested structure');
    
    return servicesWithRelations;

  } catch (error) {
    console.error('❌ [MODEL] Error fetching services:', error);
    throw error;
  }
};

/**
 * ✅ OPTIMIZED: Fetch all services with nested categories and packages
 * Uses efficient queries with proper async/await
 */
exports.getAllService = async () => {
  try {
    console.log('📦 Fetching services with relations...');

    // Step 1: Fetch all active services
    const [services] = await db.query(`
      SELECT * FROM services WHERE active = 1
    `);

    if (!services || services.length === 0) {
      console.log('⚠️ No services found');
      return [];
    }

    console.log(`✅ Found ${services.length} services`);

    // Step 2: Fetch all categories for these services in ONE query
    const serviceIds = services.map(s => s.id);
    const [categories] = await db.query(`
      SELECT * FROM categories
      WHERE service_id IN (?)
      ORDER BY service_id ASC, sort_order ASC
    `, [serviceIds]);

    console.log(`✅ Found ${categories.length} categories`);

    // Step 3: Fetch all packages for these categories in ONE query
    let packages = [];
    if (categories.length > 0) {
      const categoryIds = categories.map(c => c.id);
      [packages] = await db.query(`
        SELECT * FROM packages
        WHERE category_id IN (?)
        ORDER BY category_id ASC, sort_order ASC
      `, [categoryIds]);

      console.log(`✅ Found ${packages.length} packages`);
    }

    // Step 4: Fetch all features for these packages in ONE query
    let features = [];
    if (packages.length > 0) {
      const packageIds = packages.map(p => p.id);
      [features] = await db.query(`
        SELECT * FROM package_features
        WHERE package_id IN (?)
        ORDER BY package_id ASC, id ASC
      `, [packageIds]);

      console.log(`✅ Found ${features.length} features`);
    }

    // Step 5: Group features by package
    const featuresByPackage = features.reduce((acc, feature) => {
      if (!acc[feature.package_id]) {
        acc[feature.package_id] = [];
      }
      acc[feature.package_id].push({
        id: feature.id,
        title: feature.title,
        duration: feature.duration,
        extra_info: feature.extra_info
      });
      return acc;
    }, {});

    // Step 6: Attach features to packages and group by category
    const packagesByCategory = packages.reduce((acc, pkg) => {
      if (!acc[pkg.category_id]) {
        acc[pkg.category_id] = [];
      }
      
      acc[pkg.category_id].push({
        id: pkg.id,
        category_id: pkg.category_id,
        name: pkg.name,
        description: pkg.description,
        price: pkg.price,
        duration: pkg.duration,
        image: pkg.image,
        sort_order: pkg.sort_order,
        features: featuresByPackage[pkg.id] || []
      });
      return acc;
    }, {});

    // Step 7: Attach packages to categories and group by service
    const categoriesByService = categories.reduce((acc, cat) => {
      if (!acc[cat.service_id]) {
        acc[cat.service_id] = [];
      }
      acc[cat.service_id].push({
        id: cat.id,
        service_id: cat.service_id,
        name: cat.name,
        description: cat.description,
        image: cat.image,
        sort_order: cat.sort_order,
        packages: packagesByCategory[cat.id] || []
      });
      return acc;
    }, {});

    // Step 8: Attach categories to services
    const servicesWithRelations = services.map(service => ({
      ...service,
      categories: categoriesByService[service.id] || []
    }));

    console.log('✅ Services with relations built successfully');
    return servicesWithRelations;

  } catch (error) {
    console.error('❌ Error fetching services with relations:', error);
    throw error;
  }
};

/**
 * ✅ Original function with proper await keywords
 */
exports.getAllServicesWithRelations = async () => {
  try {
    const [services] = await pool.query("SELECT * FROM services WHERE active = 1");

    if (!services || services.length === 0) {
      console.log('⚠️ No services found');
      return [];
    }

    console.log(`✅ Found ${services.length} services`);

    for (let service of services) {
      const [categories] = await pool.query(
        "SELECT * FROM categories WHERE service_id = ? AND active = 1",
        [service.id]
      );

      if (categories && categories.length > 0) {
        for (let category of categories) {
          const [packages] = await pool.query(
            "SELECT * FROM packages WHERE category_id = ? AND active = 1",
            [category.id]
          );
          
          // Fetch features for each package
          if (packages && packages.length > 0) {
            for (let pkg of packages) {
              const [features] = await pool.query(
                "SELECT id, title, duration, extra_info FROM package_features WHERE package_id = ?",
                [pkg.id]
              );
              pkg.features = features || [];
            }
          }
          
          category.packages = packages || [];
        }
      }

      service.categories = categories || [];
    }

    return services;
  } catch (error) {
    console.error("❌ Error fetching services with relations:", error);
    return [];
  }
};

// Add this to your service model for diagnostics

exports.diagnosticCheck = async () => {
  try {
    console.log('🔍 [DIAGNOSTIC] Starting database check...');
    
    // Check 1: Count ALL services (including inactive)
    const allServicesResult = await pool.query(`
      SELECT COUNT(*) as total, 
             SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) as active_count,
             SUM(CASE WHEN active = 0 THEN 1 ELSE 0 END) as inactive_count
      FROM services
    `);
    
    const serviceCounts = Array.isArray(allServicesResult)
      ? (Array.isArray(allServicesResult[0]) ? allServicesResult[0][0] : allServicesResult[0])
      : allServicesResult;
    
    console.log('📊 [DIAGNOSTIC] Services count:', serviceCounts);
    
    // Check 2: List all services with their active status
    const servicesListResult = await pool.query(`
      SELECT id, name, active
      FROM services
      ORDER BY id ASC
    `);
    
    const servicesList = Array.isArray(servicesListResult)
      ? (Array.isArray(servicesListResult[0]) ? servicesListResult[0] : servicesListResult)
      : [];
    
    console.log('📋 [DIAGNOSTIC] All services:');
    servicesList.forEach(s => {
      console.log(`   ${s.active ? '✅' : '❌'} ID: ${s.id}, Name: ${s.name}, Active: ${s.active}`);
    });
    
    // Check 3: Count categories
    const categoriesResult = await pool.query(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) as active_count
      FROM categories
    `);
    
    const categoryCounts = Array.isArray(categoriesResult)
      ? (Array.isArray(categoriesResult[0]) ? categoriesResult[0][0] : categoriesResult[0])
      : categoriesResult;
    
    console.log('📊 [DIAGNOSTIC] Categories count:', categoryCounts);
    
    // Check 4: Count packages
    const packagesResult = await pool.query(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) as active_count
      FROM packages
    `);
    
    const packageCounts = Array.isArray(packagesResult)
      ? (Array.isArray(packagesResult[0]) ? packagesResult[0][0] : packagesResult[0])
      : packagesResult;
    
    console.log('📊 [DIAGNOSTIC] Packages count:', packageCounts);
    
    // Check 5: Sample query with LEFT JOIN to see structure
    const sampleResult = await pool.query(`
      SELECT 
        s.id as service_id,
        s.name as service_name,
        s.active as service_active,
        c.id as category_id,
        c.name as category_name,
        c.active as category_active,
        p.id as package_id,
        p.name as package_name,
        p.active as package_active
      FROM services s
      LEFT JOIN categories c ON s.id = c.service_id
      LEFT JOIN packages p ON c.id = p.category_id
      LIMIT 5
    `);
    
    const sampleData = Array.isArray(sampleResult)
      ? (Array.isArray(sampleResult[0]) ? sampleResult[0] : sampleResult)
      : [];
    
    console.log('📋 [DIAGNOSTIC] Sample data structure:');
    console.log(JSON.stringify(sampleData, null, 2));
    
    return {
      services: serviceCounts,
      categories: categoryCounts,
      packages: packageCounts,
      servicesList,
      sampleData
    };
    
  } catch (error) {
    console.error('❌ [DIAGNOSTIC] Error:', error);
    throw error;
  }
};

/**
 * ✅ Simple version with all await keywords added
 */
exports.getAllServices = async () => {
  try {
    const [services] = await pool.query(`
      SELECT id, name, description, icon, image, active
      FROM services
      WHERE active = 1
      ORDER BY id ASC
    `);

    for (let service of services) {
      const [categories] = await pool.query(`
        SELECT id, service_id, name, description, image, sort_order
        FROM categories
        WHERE service_id = ? AND active = 1
        ORDER BY sort_order ASC
      `, [service.id]);

      for (let category of categories) {
        const [packages] = await pool.query(`
          SELECT 
            id, 
            category_id, 
            name, 
            description, 
            price, 
            duration,
            image,
            sort_order
          FROM packages
          WHERE category_id = ? AND active = 1
          ORDER BY sort_order ASC
        `, [category.id]);

        // Fetch features for each package
        for (let pkg of packages) {
          const [features] = await pool.query(`
            SELECT id, title, duration, extra_info
            FROM package_features
            WHERE package_id = ?
            ORDER BY id ASC
          `, [pkg.id]);
          
          pkg.features = features || [];
        }

        category.packages = packages || [];
      }

      service.categories = categories || [];
    }

    return services;
  } catch (error) {
    console.error('❌ Error fetching services:', error);
    throw error;
  }
};

// Update Service
exports.updateService = (id, data) => {
  return new Promise((resolve, reject) => {
    pool.query(
      'UPDATE services SET name = ?, description = ? WHERE id = ?',
      [data.name, data.description, id],
      (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve(result); // You might want to return the updated service details
        }
      }
    );
  });
};

exports.getAllPackages = (req, res) => {
  return new Promise((resolve, reject) => {
    const query = "SELECT * FROM packages";
    pool.query(query, (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}

// Create Package
exports.createService = (data) => { // Change arguments to accept an object
  return new Promise((resolve, reject) => {
    pool.query(
      'INSERT INTO services (name, description) VALUES (?, ?)',
      [data.name, data.description], // Access properties from the object
      (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      }
    );
  });
};

// Create Package
exports.createPackage = (data) => { // Change arguments to accept an object
  return new Promise((resolve, reject) => {
    pool.query(
      'INSERT INTO packages (name, description, service_id) VALUES (?, ?, ?)',
      [data.name, data.description, data.service_id], // Access properties from the object
      (err, result) => {
        if (err) {
          reject(err);
        } else {
          // Optionally, you can fetch the newly created package to return it
          const newPackageId = result.insertId; // Get the ID of the newly created package
          pool.query(
            'SELECT * FROM packages WHERE id = ?',
            [newPackageId],
            (err, rows) => {
              if (err) {
                reject(err);
              } else {
                resolve(rows[0]); // Return the created package object
              }
            }
          );
        }
      }
    );
  });
};

// Update Package
exports.updatePackage = (id, data) => {
  return new Promise((resolve, reject) => {
    pool.query(
      'UPDATE packages SET name = ?, service = ?, description = ? WHERE id = ?',
      [data.name, data.service_id, data.description, id],
      (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve(result); // You might want to return the updated package details
        }
      }
    );
  });
};

// Fetch service by ID
exports.getServiceById = (id) => {
  return new Promise((resolve, reject) => {
    pool.query('SELECT * FROM services WHERE id = ?', [id], (err, rows) => {
      if (err) return reject(err);
      resolve(rows[0]);
    });
  });
};

exports.getServiceIdByName = (service) => {
  return new Promise((resolve, reject) => {
    pool.query(
      'SELECT id FROM services WHERE name = ?',
      [service],
      (err, results) => {
        if (err) {
          return reject(err);
        }
        resolve(results[0]); // Returns the service object or undefined if not found
      }
    );
  });
};

// Fetch package by ID
exports.getPackageById = (id) => {
  return new Promise((resolve, reject) => {
    pool.query('SELECT * FROM services WHERE id = ?', [id], (err, rows) => {
      if (err) return reject(err);
      resolve(rows[0]);
    });
  });
};

exports.getAllServices = (req, res) => {
  return new Promise((resolve, reject) => {
    const query = "SELECT * FROM services";
    pool.query(query, (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}

// Delete a service
exports.deleteService = (id) => {
  return new Promise((resolve, reject) => {
    pool.query(
      'DELETE FROM services WHERE id = ?',
      [id],
      (err, result) => {
        if (err) {
          reject(err);
        } else {
          // Check if any rows were affected
          if (result.affectedRows === 0) {
            resolve(null); // No service found to delete
          } else {
            resolve(true); // Service deleted successfully
          }
        }
      }
    );
  });
};

// Delete a package
exports.deletePackage = (id) => {
  return new Promise((resolve, reject) => {
    pool.query(
      'DELETE FROM packages WHERE id = ?',
      [id],
      (err, result) => {
        if (err) {
          reject(err);
        } else {
          // Check if any rows were affected
          if (result.affectedRows === 0) {
            resolve(null); // No package found to delete
          } else {
            resolve(true); // Package deleted successfully
          }
        }
      }
    );
  });
};