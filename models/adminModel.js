// adminModel.js

const pool = require("../config/db");
const bcrypt = require("bcrypt");

// Utility wrapper providing systematic Promise mappings for historical driver instances
const executeQuery = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    pool.query(sql, params, (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
};

exports.login = async (credentials) => {
    const { email, password } = credentials;
    
    try {
      const records = await executeQuery("SELECT * FROM admins WHERE email = ? LIMIT 1", [email]);
      const admin = records[0];
      
      if (!admin) {
        throw new Error("Not Admin");
      }
      
      const passwordMatch = await bcrypt.compare(password, admin.password);
      if (!passwordMatch) {
        throw new Error("Invalid credentials");
      }
      
      return { id: admin.id, email: admin.email, role: "admin" };
    } catch (error) {
      throw new Error(error.message);
    }
};

/**
 * Validates baseline admin profile references across target records
 */
exports.verifyCredentials = async (email, password) => {
  const queryStr = "SELECT * FROM admins WHERE email = ? LIMIT 1";
  const records = await executeQuery(queryStr, [email]);
  if (!records || records.length === 0) return null;

  const admin = records[0];
  const match = await bcrypt.compare(password, admin.password);
  return match ? admin : null;
};

/**
 * Pull single profile footprint explicitly by email address
 */
exports.getAdminByEmail = async (email) => {
  const records = await executeQuery("SELECT * FROM admins WHERE email = ? LIMIT 1", [email]);
  return records[0] || null;
};

exports.getAdminById = async (adminId) => {
  const records = await executeQuery("SELECT * FROM admins WHERE admin_id = ? LIMIT 1", [adminId]);
  return records[0] || null;
};

/**
 * Updates or persists active verification structural values inside the engine repository
 */
exports.saveAuthChallenge = async (email, code, createdAt, ttl, resendCount = 0) => {
  const statement = `
    INSERT INTO admin_challenges (email, code, created_at, ttl, resend_count)
    VALUES (?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE 
      code = VALUES(code),
      created_at = VALUES(created_at),
      ttl = VALUES(ttl),
      resend_count = VALUES(resend_count)
  `;
  return await executeQuery(statement, [email, code, createdAt, ttl, resendCount]);
};

/**
 * Resolves current tracking tokens configured against active identity records
 */
exports.getAuthChallenge = async (email) => {
  const records = await executeQuery("SELECT * FROM admin_challenges WHERE email = ? LIMIT 1", [email]);
  return records[0] || null;
};

/**
 * Flushes security tokens immediately post successful authorization validation checks
 */
exports.clearAuthChallenge = async (email) => {
  return await executeQuery("DELETE FROM admin_challenges WHERE email = ?", [email]);
};

// ==============================
// GALLERIES
// ==============================
exports.getGallery = async () => {
  const galleries = await executeQuery(`
    SELECT
      g.gallery_id, g.title, g.client, g.client_email, g.user_id, g.description,
      g.category, g.location, g.date, g.thumbnail, g.views, g.downloads,
      g.clientApproved, g.proofing, g.imageCount, g.created_at, g.updated_at
    FROM galleries g
    ORDER BY g.created_at DESC
  `);

  if (!galleries.length) return [];

  const ids = galleries.map(g => g.gallery_id);
  const allImages = await executeQuery(
    `SELECT id, gallery_id, url, r2_key, public_id, name, bytes, created_at
     FROM gallery_images WHERE gallery_id IN (?) ORDER BY created_at ASC`,
    [ids]
  );

  const imagesByGallery = {};
  allImages.forEach(img => {
    imagesByGallery[img.gallery_id] ||= [];
    imagesByGallery[img.gallery_id].push(img);
  });

  return galleries.map(g => ({ ...g, images: imagesByGallery[g.gallery_id] || [] }));
};

exports.getUserIdByEmail = async (email) => {
  if (!email) return null;
  const rows = await executeQuery(
    "SELECT user_id FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM(?)) LIMIT 1",
    [email]
  );
  return rows[0]?.user_id || null;
};

exports.getGalleryById = async (id) => {
  const rows = await executeQuery(`SELECT * FROM galleries WHERE gallery_id = ? LIMIT 1`, [id]);
  if (!rows.length) return null;
  
  const gallery = rows[0];
  gallery.images = await exports.getGalleryImages(id);
  return gallery;
};

// Referenced by dataController.getClientGalleries (GET /api/data/client/galleries) —
// was missing entirely, so that endpoint would throw
// "adminModel.getGalleriesByUserId is not a function" (500) the moment it
// was ever called. Metadata-only by design — the controller strips this
// further before it reaches the client, so no need to resolve images here.
exports.getGalleriesByUserId = async (userId) => {
  if (!userId) return [];
  return executeQuery(
    `SELECT gallery_id, title, thumbnail, status, category, location, date,
            imageCount, clientApproved, proofing,
            created_at, updated_at
     FROM galleries
     WHERE user_id = ? AND status != 'deleted'
     ORDER BY created_at DESC`,
    [userId]
  );
};

exports.createGallery = async (data) => {
  const {
    title, access_token, client, client_email, user_id, category,
    password, downloadable, notes, expires_at, status
  } = data;

  const hashedPassword = password ? await bcrypt.hash(password, 10) : null;

  const queryResult = await executeQuery(`
    INSERT INTO galleries
      (title, access_token, client, client_email, user_id, category, password,
       downloadable, notes, expires_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    title,
    access_token,
    client || null,
    client_email || null,
    user_id || null,
    category || null,
    hashedPassword || null,
    downloadable !== false ? 1 : 0,
    notes || null,
    expires_at || null,
    status || 'draft'
  ]);

  const insertId = queryResult.insertId;
  if (!insertId) {
    throw new Error("Failed to retrieve insertId from database transaction.");
  }

  return exports.getGalleryById(insertId);
};

exports.updateGallery = async (id, updates) => {
  const allowed = [
    'title', 'client', 'client_email', 'user_id', 'category', 'password',
    'downloadable', 'notes', 'expires_at', 'status', 'thumbnail', 'views'
  ];
  const fields = [];
  const values = [];

  allowed.forEach(key => {
    if (key in updates) {
      fields.push(`${key} = ?`);
      // Hash on the way in whenever the password is being changed, same reasoning
      // as createGallery. An empty string clears protection (open access).
      values.push(key === 'password' && updates.password
        ? bcrypt.hashSync(updates.password, 10)
        : updates[key]);
    }
  });
  if ('password' in updates) {
    fields.push('unlocked_at = NULL');
  }

  if (!fields.length) return exports.getGalleryById(id);

  values.push(id);
  await executeQuery(
    `UPDATE galleries SET ${fields.join(', ')} WHERE gallery_id = ?`,
    values
  );
  return exports.getGalleryById(id);
};

exports.verifyGalleryPassword = async (gallery, password) => {
  if (!gallery.password) return true; // not password-protected
  if (!password) return false;
  return bcrypt.compare(password, gallery.password);
};

exports.recordGalleryAccessAttempt = async (gallery_id, ip, success) => {
  await executeQuery(
    `INSERT INTO gallery_access_attempts (gallery_id, ip, success) VALUES (?, ?, ?)`,
    [gallery_id, ip, success ? 1 : 0]
  );
};

/**
 * Count recent failed attempts for this gallery+ip in the last `windowMinutes`.
 * Use this before verifyGalleryPassword to reject outright once over the limit.
 */
exports.countRecentFailedAttempts = async (gallery_id, ip, windowMinutes = 15) => {
  const rows = await executeQuery(
    `SELECT COUNT(*) AS c FROM gallery_access_attempts
     WHERE gallery_id = ? AND ip = ? AND success = 0
       AND created_at > (NOW() - INTERVAL ? MINUTE)`,
    [gallery_id, ip, windowMinutes]
  );
  return rows[0]?.c || 0;
};

exports.getGalleries = async () => {
  const galleries = await executeQuery(`
    SELECT
      g.*,
      COUNT(gi.id) AS imageCount,
      (SELECT gi2.url FROM gallery_images gi2
       WHERE gi2.gallery_id = g.gallery_id ORDER BY gi2.created_at ASC LIMIT 1
      ) AS thumbnail
    FROM galleries g
    LEFT JOIN gallery_images gi ON gi.gallery_id = g.gallery_id
    GROUP BY g.gallery_id
    ORDER BY g.created_at DESC
  `);

  if (!galleries.length) return [];

  // Fetch all images for these galleries in one round-trip and group them in JS
  // instead of relying on JSON_ARRAYAGG (not available on all MySQL/MariaDB builds).
  const ids = galleries.map(g => g.gallery_id);
  const allImages = await executeQuery(
    `SELECT * FROM gallery_images WHERE gallery_id IN (?) ORDER BY created_at ASC`,
    [ids]
  );

  const imagesByGallery = {};
  allImages.forEach(img => {
    imagesByGallery[img.gallery_id] ||= [];
    imagesByGallery[img.gallery_id].push(img);
  });

  return galleries.map(g => ({
    ...g,
    images: imagesByGallery[g.gallery_id] || [],
  }));
};

exports.getGalleryByToken = async (token) => {
  if (!token) return null;
  const rows = await executeQuery(`SELECT * FROM galleries WHERE access_token = ? LIMIT 1`, [token]);

  if (!rows.length) return null;
  
  const gallery = rows[0];
  gallery.images = await exports.getGalleryImages(gallery.gallery_id);
  return gallery;
};

exports.deleteGallery = async (id) => {
  await executeQuery(`DELETE FROM gallery_images WHERE gallery_id = ?`, [id]);
  await executeQuery(`DELETE FROM revision_requests WHERE gallery_id = ?`, [id]);
  await executeQuery(`DELETE FROM galleries WHERE gallery_id = ?`, [id]);
};

exports.unlockGallery = async (gallery_id) => {
  await executeQuery(`UPDATE galleries SET unlocked_at = NOW() WHERE gallery_id = ?`, [gallery_id]);
};

exports.relockGallery = async (gallery_id) => {
  await executeQuery(`UPDATE galleries SET unlocked_at = NULL WHERE gallery_id = ?`, [gallery_id]);
};

// ==============================
// GALLERY IMAGES
// ==============================
exports.getGalleryImages = async (gallery_id) => {
  const rows = await executeQuery(
    `SELECT * FROM gallery_images WHERE gallery_id = ? ORDER BY created_at ASC`,
    [gallery_id]
  );
  return rows;
};
 
exports.getImageById = async (id) => {
  const rows = await executeQuery(
    `SELECT * FROM gallery_images WHERE id = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
};
 
exports.addImagesToGallery = async (gallery_id, images) => {
  if (!images.length) return;

  const placeholders = images.map(() => `(?, ?, ?, ?, ?, ?, ?, NOW())`).join(', ');
  const values = images.flatMap(img => {
    const id = img.r2_key || img.public_id;
    if (!id) throw new Error('addImagesToGallery: image is missing both r2_key and public_id');
    return [id, gallery_id, img.url, img.r2_key || null, img.public_id || null, img.name || null, img.bytes || null];
  });

  await executeQuery(
    `INSERT INTO gallery_images
        (id, gallery_id, url, r2_key, public_id, name, bytes, created_at)
     VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE url = VALUES(url)`,
    values
  );

  await executeQuery(`
    UPDATE galleries
    SET thumbnail = (
      SELECT url FROM gallery_images WHERE gallery_id = ? ORDER BY created_at ASC LIMIT 1
    )
    WHERE gallery_id = ? AND (thumbnail IS NULL OR thumbnail = '')
  `, [gallery_id, gallery_id]);

  await exports.syncImageCount(gallery_id);
};
 
exports.deleteGalleryImage = async (id) => {
  const rows = await executeQuery(`SELECT gallery_id FROM gallery_images WHERE id = ? LIMIT 1`, [id]);
  const gallery_id = rows[0]?.gallery_id;

  await executeQuery(`DELETE FROM gallery_images WHERE id = ?`, [id]);

  if (gallery_id) await exports.syncImageCount(gallery_id);
};

exports.syncImageCount = async (gallery_id) => {
  await executeQuery(
    `UPDATE galleries g
     SET imageCount = (SELECT COUNT(*) FROM gallery_images gi WHERE gi.gallery_id = g.gallery_id)
     WHERE g.gallery_id = ?`,
    [gallery_id]
  );
};
 
// ==============================
// REVISION REQUESTS
// ==============================
exports.createRevisionRequest = async (data) => {
  const { gallery_id, note, client_name, client_email } = data;
  const result = await executeQuery(`
    INSERT INTO revision_requests
      (gallery_id, note, client_name, client_email, status, created_at)
    VALUES (?, ?, ?, ?, 'pending', NOW())
  `, [gallery_id, note, client_name || null, client_email || null]);
 
  const rows = await executeQuery(
    `SELECT * FROM revision_requests WHERE id = ? LIMIT 1`,
    [result.insertId]
  );
  return rows[0];
};
 
exports.getRevisionsByGallery = async (gallery_id) => {
  const rows = await executeQuery(
    `SELECT * FROM revision_requests WHERE gallery_id = ? ORDER BY created_at DESC`,
    [gallery_id]
  );
  return rows;
};
 
exports.resolveRevision = async (id, action) => {
  const status = action === 'approve' ? 'approved' : 'rejected';
  await executeQuery(
    `UPDATE revision_requests SET status = ? WHERE id = ?`,
    [status, id]
  );
};

// Used by the list-view alert bar / per-card badges in GalleryManagement.jsx —
// previously had no backing route or model function, so it always 404'd and
// silently fell back to an empty array.
exports.getPendingRevisions = async () => {
  const rows = await executeQuery(
    `SELECT * FROM revision_requests WHERE status = 'pending' ORDER BY created_at DESC`
  );
  return rows;
};
 
exports.incrementViews = async (id) => {
  await executeQuery(`UPDATE galleries SET views = views + 1 WHERE gallery_id = ?`, [id]);
};

// ==============================
// CATEGORIES
// ==============================
exports.getCategories = () => {
  return new Promise((resolve, reject) => {
    pool.query(
      `SELECT c.*, s.name AS service_name
       FROM categories c
       LEFT JOIN services s ON c.service_id = s.id
       ORDER BY c.id DESC`,
      (err, result) => {
        if (err) reject(err);
        else resolve(result);
      }
    );
  });
};
 
// Get category by ID
exports.getCategoryById = (id) => {
  return new Promise((resolve, reject) => {
    pool.query("SELECT * FROM categories WHERE id = ?", [id], (err, results) => {
      if (err) return reject(err);
      resolve(results[0]);
    });
  });
};
 
exports.createCategory = ({ name, service_id, description }) => {
  return new Promise((resolve, reject) => {
    pool.query(
      "INSERT INTO categories (name, service_id, description) VALUES (?, ?, ?)",
      [name, service_id, description || null],
      (err, result) => {
        if (err) return reject(err);
        resolve({ id: result.insertId, name, service_id, description: description || null });
      }
    );
  });
};
 
exports.updateCat = (id, { name, service_id, description }) => {
  return new Promise((resolve, reject) => {
    pool.query(
      "UPDATE categories SET name = ?, service_id = ?, description = ? WHERE id = ?",
      [name, service_id, description || null, id],
      (err, result) => {
        if (err) return reject(err);
        resolve({ id, name, service_id, description: description || null });
      }
    );
  });
};
 
// Delete category
exports.deleteCategory = (id) => {
  return new Promise((resolve, reject) => {
    pool.query("DELETE FROM categories WHERE id = ?", [id], (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });
};
 
// ==============================
// PACKAGES + FEATURES
// ==============================
 
exports.createPackage = ({ category_id, name, description, price, duration, features }) => {
  return new Promise((resolve, reject) => {
    // 1. Insert into packages
    pool.query(
      "INSERT INTO packages (category_id, name, description, price, duration) VALUES (?, ?, ?, ?, ?)",
      [category_id, name, description || null, price, duration || null],
      (err, result) => {
        if (err) return reject(err);
 
        const package_id = result.insertId;
 
        // 2. Insert features if any
        if (features && features.length > 0) {
          const featureValues = features
            .filter((f) => f.title && f.title.trim())
            .map((f) => [package_id, f.title, f.duration || null, f.extra_info || null]);
 
          if (featureValues.length === 0) {
            return resolve({ package_id, category_id, name, price, features: [] });
          }
 
          pool.query(
            "INSERT INTO package_features (package_id, title, duration, extra_info) VALUES ?",
            [featureValues],
            (err2) => {
              if (err2) return reject(err2);
              resolve({ package_id, category_id, name, price, features });
            }
          );
        } else {
          resolve({ package_id, category_id, name, price, features: [] });
        }
      }
    );
  });
};
 
exports.updatePackage = (id, { name, description, price, duration, features }) => {
  return new Promise((resolve, reject) => {
    // 1. Update base package
    pool.query(
      "UPDATE packages SET name = ?, description = ?, price = ?, duration = ? WHERE id = ?",
      [name, description || null, price, duration || null, id],
      (err) => {
        if (err) return reject(err);
 
        // 2. Remove old features
        pool.query("DELETE FROM package_features WHERE package_id = ?", [id], (err2) => {
          if (err2) return reject(err2);
 
          // 3. Insert new features if available
          const featureValues = (features || [])
            .filter((f) => f.title && f.title.trim())
            .map((f) => [id, f.title, f.duration || null, f.extra_info || null]);
 
          if (featureValues.length === 0) {
            return resolve({ id, name, price, features: [] });
          }
 
          pool.query(
            "INSERT INTO package_features (package_id, title, duration, extra_info) VALUES ?",
            [featureValues],
            (err3) => {
              if (err3) return reject(err3);
              resolve({ id, name, price, features });
            }
          );
        });
      }
    );
  });
};
 
// Delete package and its features
exports.deletePackage = (id) => {
  return new Promise((resolve, reject) => {
    // Delete features first
    pool.query("DELETE FROM package_features WHERE package_id = ?", [id], (err) => {
      if (err) return reject(err);
 
      // Delete package
      pool.query("DELETE FROM packages WHERE id = ?", [id], (err2) => {
        if (err2) return reject(err2);
        resolve({ message: "Package and its features deleted successfully.", id });
      });
    });
  });
};
 
// Fetch all packages with their features
exports.getPackages = () => {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT
        p.id AS package_id,
        p.category_id,
        p.name,
        p.description,
        p.price,
        p.duration,
        c.name AS category_name,
        f.id AS feature_id,
        f.title AS feature_title,
        f.duration AS feature_duration,
        f.extra_info
      FROM packages p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN package_features f ON p.id = f.package_id
      ORDER BY p.id DESC
    `;
 
    pool.query(query, (err, rows) => {
      if (err) return reject(err);
 
      const packages = {};
 
      rows.forEach((row) => {
        if (!packages[row.package_id]) {
          packages[row.package_id] = {
            id: row.package_id,
            category_id: row.category_id,
            category_name: row.category_name,
            name: row.name,
            description: row.description,
            price: row.price,
            duration: row.duration,
            features: [],
          };
        }
 
        if (row.feature_id) {
          packages[row.package_id].features.push({
            id: row.feature_id,
            title: row.feature_title,
            duration: row.feature_duration,
            extra_info: row.extra_info,
          });
        }
      });
 
      resolve(Object.values(packages));
    });
  });
};

// ==============================
// GENRES
// ==============================
exports.getGenres = () => {
  return new Promise((resolve, reject) => {
    pool.query("SELECT * FROM genres ORDER BY genre_id DESC", (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
};

// Get genre by ID
exports.getGenreById = (genre_id) => {
  return new Promise((resolve, reject) => {
    pool.query("SELECT * FROM genres WHERE genre_id = ?", [genre_id], (err, results) => {
      if (err) return reject(err);
      resolve(results[0]); // return single object
    });
  });
};

exports.createGenre = ({ title, description }) => {
  return new Promise((resolve, reject) => {
    pool.query(
      "INSERT INTO genres (title, description) VALUES (?, ?)",
      [title, description],
      (err, result) => {
        if (err) reject(err);
        else resolve({ genre_id: result.insertId, title, description });
      }
    );
  });
};

// Update genre
exports.updateGenre = (genre_id, { title, description }) => {
  return new Promise((resolve, reject) => {
    pool.query(
      "UPDATE genres SET title = ?, description = ? WHERE genre_id = ?",
      [title, description, genre_id],
      (err, result) => {
        if (err) reject(err);
        else resolve({ genre_id: genre_id, title, description });
      }
    );
  });
};

exports.deleteGenre = (genre_id) => {
  return new Promise((resolve, reject) => {
    pool.query("DELETE FROM genres WHERE genre_id = ?", [genre_id], (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
};