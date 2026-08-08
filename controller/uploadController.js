const cloudinary = require("../config/cloudinary");
const pool = require("../config/db");
const fs = require("fs").promises;
const fsSync = require("fs");
const path = require('path');
const archiver = require('archiver');
const axios = require('axios');
const NodeCache = require("node-cache");
const { promisify } = require('util');

// Initialize cache with 5 minute TTL
const imageCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

// Promisify database queries for better async/await support
const queryAsync = promisify(pool.query).bind(pool);

// Cache management
const invalidateCache = (cacheKeys = null) => {
  if (cacheKeys && Array.isArray(cacheKeys)) {
    cacheKeys.forEach(key => imageCache.del(key));
    console.log(`Cache invalidated for keys: ${cacheKeys.join(', ')}`);
  } else {
    imageCache.flushAll();
    console.log("All cache invalidated");
  }
};

// Utility functions
const slugify = (str) => {
  if (!str || typeof str !== 'string') return `untitled_${Date.now()}`;
  return str
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
};

const parseJSONSafe = (jsonString, fallback = []) => {
  try {
    return Array.isArray(jsonString) ? jsonString : JSON.parse(jsonString || "[]");
  } catch {
    return fallback;
  }
};

const ensureDirectoryExists = async (dirPath) => {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
  }
};

// Database helper functions
const findCategoryByName = async (category) => {
  if (!category) return null;
  try {
    const results = await queryAsync('SELECT id FROM categories WHERE name = ? LIMIT 1', [category]);
    return results.length > 0 ? results[0].id : null;
  } catch (error) {
    console.error('Error finding category:', error);
    return null;
  }
};

const findGenreByName = async (genre) => {
  if (!genre) return null;
  try {
    const results = await queryAsync('SELECT genre_id FROM genres WHERE title = ? LIMIT 1', [genre]);
    return results.length > 0 ? results[0].genre_id : null;
  } catch (error) {
    console.error('Error finding genre:', error);
    return null;
  }
};

const createGallery = async (galleryData) => {
  const {
    title, description, client, category, genre, date, location, status, thumbnail, tags
  } = galleryData;

  try {
    const result = await queryAsync(
      `INSERT INTO galleries 
       (title, description, client, category, genre, date, location, status, thumbnail, tags, views, downloads, clientApproved, proofing, imageCount) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0)`,
      [title, description, client, category, genre, date, location, status, thumbnail, JSON.stringify(tags)]
    );
    return result.insertId;
  } catch (error) {
    console.error('Error creating gallery:', error);
    throw new Error('Failed to create gallery');
  }
};

const insertImage = async (imageData) => {
  const {
    title, description, genreId, categoryId, tags, subjects, location, galleryId, url, publicId, filePath
  } = imageData;

  try {
    // Ensure we have valid IDs (never null)
    const safeGenreId = genreId || 1;
    const safeCategoryId = categoryId || 1;
    
    console.log('Inserting image with values:', {
      title, description, genreId: safeGenreId, categoryId: safeCategoryId, 
      tags, subjects, location, galleryId, url, publicId, filePath
    });
    
    const result = await queryAsync(
      `INSERT INTO images 
       (title, description, genre_id, cat_id, tags, subjects, location, gallery_id, url, public_id, file_path) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, description, safeGenreId, safeCategoryId, tags, subjects, location, galleryId, url, publicId, filePath]
    );
    
    console.log('Image inserted successfully with ID:', result.insertId);
    return result.insertId;
  } catch (error) {
    console.error('Error inserting image:', error);
    console.error('Failed values:', {
      title, description, genreId, categoryId, tags, subjects, location, galleryId, url, publicId, filePath
    });
    throw new Error(`Failed to insert image record: ${error.message}`);
  }
};

const updateGalleryThumbnail = async (galleryId, thumbnailUrl) => {
  try {
    await queryAsync('UPDATE galleries SET thumbnail = ? WHERE gallery_id = ?', [thumbnailUrl, galleryId]);
  } catch (error) {
    console.error('Error updating gallery thumbnail:', error);
  }
};

// File cleanup utility
const cleanupFiles = async (filePaths) => {
  if (!filePaths || !Array.isArray(filePaths)) return;
  
  for (const filePath of filePaths) {
    try {
      if (fsSync.existsSync(filePath)) {
        await fs.unlink(filePath);
      }
    } catch (error) {
      console.error(`Failed to cleanup file ${filePath}:`, error);
    }
  }
};

// Main upload handler
exports.uploadCldImage = async (req, res) => {
  const tempFiles = [];
  
  try {
    console.log("=== Upload Request Started ===");
    console.log("Files:", req.files?.length || 0, "Single file:", !!req.file);
    console.log("Body:", req.body);

    const {
      title = "",
      description = "",
      genre,
      category,
      tags = "[]",
      subjects = "[]",
      location = "",
      galleryId,
      galleryName,
      uploadMode,
      client,
      date,
      status = "draft",
      thumbnail
    } = req.body;

    const isBulk = uploadMode === "bulk";
    const files = isBulk ? req.files : (req.file ? [req.file] : []);

    // Validation
    if (files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    // Parse tags and subjects
    const parsedTags = parseJSONSafe(tags);
    const parsedSubjects = parseJSONSafe(subjects);
    const tagsStr = parsedTags.join(",");
    const subjectsStr = parsedSubjects.join(",");

    // Track temp files for cleanup
    files.forEach(file => {
      if (file.path) tempFiles.push(file.path);
    });

    // Look up category and genre IDs
    const [categoryId, genreId] = await Promise.all([
      findCategoryByName(category),
      findGenreByName(genre)
    ]);

    // Handle gallery creation/selection
    let galleryIdToUse = galleryId || null;
    
    if (!galleryIdToUse && galleryName?.trim()) {
      const newGalleryData = {
        title: galleryName.trim(),
        description,
        client,
        category,
        genre,
        date,
        location,
        status,
        thumbnail,
        tags: parsedTags
      };
      
      galleryIdToUse = await createGallery(newGalleryData);
      console.log("Created new gallery with ID:", galleryIdToUse);
    }

    const results = [];
    let folderName = null;

    if (isBulk) {
      // Bulk upload to Cloudinary
      folderName = galleryName?.trim() 
        ? `gallery/${slugify(galleryName)}` 
        : `gallery/untitled_${Date.now()}`;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        console.log(`Uploading ${i + 1}/${files.length}: ${file.originalname}`);

        const cloudinaryResult = await cloudinary.uploader.upload(file.path, {
          folder: folderName,
          use_filename: true,
          unique_filename: true,
          resource_type: "auto"
        });

        const dbId = await insertImage({
          title: title || path.parse(file.originalname).name,
          description,
          genreId,
          categoryId,
          tags: tagsStr,
          subjects: subjectsStr,
          location,
          galleryId: galleryIdToUse,
          url: cloudinaryResult.secure_url,
          publicId: cloudinaryResult.public_id,
          filePath: file.originalname
        });

        results.push({
          id: dbId,
          url: cloudinaryResult.secure_url,
          public_id: cloudinaryResult.public_id,
          gallery: folderName
        });

        // Set first image as gallery thumbnail if none exists
        if (i === 0 && galleryIdToUse && !thumbnail) {
          await updateGalleryThumbnail(galleryIdToUse, cloudinaryResult.secure_url);
        }
      }

      // Cleanup temp files
      await cleanupFiles(tempFiles);
      invalidateCache(['cloudImages', `gallery_${galleryIdToUse}`]);

      return res.json({ 
        success: true, 
        gallery: folderName, 
        galleryId: galleryIdToUse,
        count: results.length, 
        files: results 
      });

    } else {
      // Single upload to local storage
      const file = files[0];
      const uploadsDir = path.join(__dirname, "../images/");
      await ensureDirectoryExists(uploadsDir);

      // Generate unique filename to avoid collisions
      const fileExt = path.extname(file.originalname);
      const baseName = path.parse(file.originalname).name;
      let finalFileName = file.originalname;
      let counter = 1;

      while (fsSync.existsSync(path.join(uploadsDir, finalFileName))) {
        finalFileName = `${baseName}_${counter}${fileExt}`;
        counter++;
      }

      const finalPath = path.join(uploadsDir, finalFileName);
      
      // Move file to final location
      await fs.rename(file.path, finalPath);
      
      const publicPath = `/images/${finalFileName}`;
      const fullUrl = `${req.protocol}://${req.get("host")}${publicPath}`;

      const dbId = await insertImage({
        title: title || baseName,
        description,
        genreId,
        categoryId,
        tags: tagsStr,
        subjects: subjectsStr,
        location,
        galleryId: galleryIdToUse,
        url: fullUrl,
        publicId: null,
        filePath: finalFileName
      });

      invalidateCache(['localImages']);

      return res.json({ 
        success: true, 
        id: dbId, 
        url: fullUrl,
        galleryId: galleryIdToUse
      });
    }

  } catch (error) {
    console.error("Upload error:", error);
    
    // Cleanup temp files on error
    await cleanupFiles(tempFiles);
    
    return res.status(500).json({ 
      error: error.message || "Upload failed",
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// Get images from specific gallery (Cloudinary)
exports.getCloudImages = async (req, res) => {
  try {
    const { galleryId } = req.params;

    if (!galleryId || isNaN(parseInt(galleryId))) {
      return res.status(400).json({ error: "Valid gallery ID is required" });
    }

    const cacheKey = `gallery_${galleryId}`;
    const cachedData = imageCache.get(cacheKey);

    if (cachedData) {
      console.log("Serving gallery data from cache");
      return res.json(cachedData);
    }

    const dbResults = await queryAsync(
      `SELECT
        i.img_id,
        i.title,
        i.description,
        i.tags,
        i.subjects,
        i.location,
        i.url,
        i.public_id,
        i.created_at,
        g.gallery_id,
        g.title AS gallery_title,
        g.description AS gallery_description,
        g.client,
        g.category,
        g.genre,
        g.date AS gallery_date,
        g.location AS gallery_location,
        g.status,
        g.thumbnail
      FROM images i
      LEFT JOIN galleries g ON i.gallery_id = g.gallery_id
      WHERE i.gallery_id = ? AND i.public_id IS NOT NULL
      ORDER BY i.img_id ASC`,
      [galleryId]
    );

    if (dbResults.length === 0) {
      return res.status(404).json({ error: "Gallery not found or contains no images" });
    }

    const galleryData = dbResults.map((img) => ({
      id: img.img_id,
      src: img.url,
      thumb: img.url,
      title: img.title || "Untitled",
      description: img.description || "",
      tags: img.tags ? img.tags.split(",").map(t => t.trim()).filter(Boolean) : [],
      subjects: img.subjects ? img.subjects.split(",").map(s => s.trim()).filter(Boolean) : [],
      location: img.location || "Unknown",
      createdAt: img.created_at
    }));

    const downloadLink = `${req.protocol}://${req.get("host")}/api/images/download-gallery/${galleryId}`;

    const result = {
      gallery: {
        id: dbResults[0].gallery_id,
        title: dbResults[0].gallery_title,
        description: dbResults[0].gallery_description,
        client: dbResults[0].client,
        category: dbResults[0].category,
        genre: dbResults[0].genre,
        date: dbResults[0].gallery_date,
        location: dbResults[0].gallery_location,
        status: dbResults[0].status,
        thumbnail: dbResults[0].thumbnail,
        downloadLink: downloadLink
      },
      images: galleryData
    };

    imageCache.set(cacheKey, result);
    return res.json(result);

  } catch (error) {
    console.error("Error in getCloudImages:", error);
    return res.status(500).json({ 
      error: "Failed to fetch gallery",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Download entire gallery as ZIP
exports.downloadGallery = async (req, res) => {
  try {
    const { galleryId } = req.params;

    if (!galleryId || isNaN(parseInt(galleryId))) {
      return res.status(400).json({ error: "Valid gallery ID is required" });
    }

    const dbResults = await queryAsync(
      `SELECT i.public_id, i.url, i.title, g.title as gallery_title 
       FROM images i 
       LEFT JOIN galleries g ON i.gallery_id = g.gallery_id 
       WHERE i.gallery_id = ? AND i.public_id IS NOT NULL`,
      [galleryId]
    );

    if (dbResults.length === 0) {
      return res.status(404).json({ error: "Gallery not found or contains no images" });
    }

    const galleryName = slugify(dbResults[0].gallery_title) || `gallery-${galleryId}`;
    const archive = archiver('zip', {
      zlib: { level: 9 }
    });

    res.attachment(`${galleryName}.zip`);
    archive.pipe(res);

    // Handle archive errors
    archive.on('error', (err) => {
      console.error('Archive error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to create archive' });
      }
    });

    // Download and add each image to archive
    for (let i = 0; i < dbResults.length; i++) {
      const image = dbResults[i];
      try {
        console.log(`Adding image ${i + 1}/${dbResults.length} to archive: ${image.title}`);
        
        const response = await axios({
          method: 'get',
          url: image.url,
          responseType: 'stream',
          timeout: 30000
        });

        const filename = image.title ? 
          `${slugify(image.title)}.jpg` : 
          `${image.public_id.split('/').pop()}.jpg`;
        
        archive.append(response.data, { name: filename });
      } catch (error) {
        console.error(`Failed to download image ${image.url}:`, error.message);
        // Continue with other images instead of failing entire archive
      }
    }

    await archive.finalize();

  } catch (error) {
    console.error("Error generating gallery download:", error);
    if (!res.headersSent) {
      res.status(500).json({ 
        error: "Failed to create downloadable gallery",
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
};

// Get all local images
exports.getAllImages = async (req, res) => {
  try {
    console.log("Fetching all local images");
    const cacheKey = "localImages";
    const cachedData = imageCache.get(cacheKey);

    if (cachedData) {
      console.log("Serving local images from cache");
      return res.json(cachedData);
    }

    // Fetch all local images from database (where public_id IS NULL)
    const dbResults = await queryAsync(
      `SELECT 
        i.img_id, 
        i.genre_id, 
        i.cat_id, 
        i.title, 
        i.description, 
        i.tags, 
        i.subjects, 
        i.location, 
        i.url,
        i.file_path,
        i.created_at,
        g.title AS gallery_title,
        c.name AS category_name,
        gn.title AS genre_name
      FROM images i
      LEFT JOIN galleries g ON i.gallery_id = g.gallery_id
      LEFT JOIN categories c ON i.cat_id = c.id
      LEFT JOIN genres gn ON i.genre_id = gn.genre_id
      WHERE i.public_id IS NULL AND i.url IS NOT NULL
      ORDER BY i.img_id DESC`
    );

    if (dbResults.length === 0) {
      console.log("No local images found in database");
      return res.json([]);
    }

    console.log(`Fetched ${dbResults.length} local images from database`);

    // Verify files still exist on disk
    const validImages = [];
    const directoryPath = path.join(__dirname, "../images/");
    const BASE_URL = process.env.BASE_URL || "http://localhost:8000";

    for (const image of dbResults) {
      let fileExists = false;

      if (image.file_path) {
        const filePath = path.join(directoryPath, image.file_path);
        try {
          await fs.access(filePath); // ensure file exists
          fileExists = true;
        } catch (error) {
          console.warn(`File not found on disk: ${image.file_path}, skipping`);
        }
      }

      if (fileExists || image.url) {
        validImages.push(image);
      }
    }

    // Format the data for frontend
    const formattedImages = validImages.map((image) => {
      // Use DB url if available (cloud images), else build local URL
      const publicUrl =
        image.url && image.url.startsWith("http")
          ? image.url
          : `${BASE_URL}/images/${image.file_path}`;

      return {
        id: image.img_id,
        src: publicUrl,
        thumb: publicUrl,
        category: image.gallery_title || image.category_name || "uncategorized",
        title: image.title || "Untitled",
        description: image.description || "",
        location: image.location || "Unknown",
        date: image.created_at
          ? new Date(image.created_at).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
            })
          : "",
        tags: image.tags
          ? image.tags.split(",").map((t) => t.trim()).filter(Boolean)
          : [],
        subjects: image.subjects
          ? image.subjects.split(",").map((s) => s.trim()).filter(Boolean)
          : [],
        genre: image.genre_name || "General",
        filePath: image.file_path, // keep for reference
      };
    });

    console.log(
      `Successfully formatted ${formattedImages.length} local image records`
    );

    // Cache and return
    imageCache.set(cacheKey, formattedImages);
    return res.json(formattedImages);
  } catch (error) {
    console.error("Error in getAllImages:", error);
    return res.status(500).json({
      error: "Failed to fetch images",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Delete image
exports.deleteImage = async (req, res) => {
  try {
    const { imageId } = req.params;

    if (!imageId || isNaN(parseInt(imageId))) {
      return res.status(400).json({ error: "Valid image ID is required" });
    }

    // Get image details first
    const imageResults = await queryAsync(
      'SELECT public_id, file_path, gallery_id FROM images WHERE img_id = ?',
      [imageId]
    );

    if (imageResults.length === 0) {
      return res.status(404).json({ error: "Image not found" });
    }

    const image = imageResults[0];

    // Delete from Cloudinary if it's a cloud image
    if (image.public_id) {
      try {
        await cloudinary.uploader.destroy(image.public_id);
        console.log(`Deleted from Cloudinary: ${image.public_id}`);
      } catch (error) {
        console.error('Error deleting from Cloudinary:', error);
      }
    }

    // Delete local file if it exists
    if (image.file_path) {
      const localPath = path.join(__dirname, "../images/", image.file_path);
      try {
        if (fsSync.existsSync(localPath)) {
          await fs.unlink(localPath);
          console.log(`Deleted local file: ${image.file_path}`);
        }
      } catch (error) {
        console.error('Error deleting local file:', error);
      }
    }

    // Delete from database
    await queryAsync('DELETE FROM images WHERE img_id = ?', [imageId]);

    // Invalidate cache
    invalidateCache(['localImages', 'cloudImages', `gallery_${image.gallery_id}`]);

    return res.json({ success: true, message: "Image deleted successfully" });

  } catch (error) {
    console.error("Error deleting image:", error);
    return res.status(500).json({ 
      error: "Failed to delete image",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

// ✅ Update Gallery Metadata
exports.updateGallery = async (req, res) => {
  try {
    // Accept either `gallery_id` from params OR `galleryId` from body
    const gallery_id = req.params.gallery_id || req.body.galleryId;

    if (!gallery_id) {
      return res.status(400).json({ error: "Missing gallery_id" });
    }

    const {
      title,
      description,
      genre,      // keep naming consistent!
      category,
      client,
      date,
      location,
      status,
      thumbnail,
      tags,
    } = req.body;

    // Normalize tags
    const parsedTags = (() => {
      try {
        return Array.isArray(tags) ? tags : JSON.parse(tags || "[]");
      } catch {
        return [];
      }
    })();

    const result = await new Promise((resolve, reject) => {
      pool.query(
        `UPDATE galleries 
         SET title = ?, description = ?, genre_id = ?, category = ?, client = ?, 
             date = ?, location = ?, status = ?, thumbnail = ?, tags = ?
         WHERE gallery_id = ?`,
        [
          title || null,
          description || null,
          genre || null,   // use `genre` to match your insert
          category || null,
          client || null,
          date || null,
          location || null,
          status || "draft",
          thumbnail || null,
          JSON.stringify(parsedTags),
          gallery_id,
        ],
        (err, result) => (err ? reject(err) : resolve(result))
      );
    });

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Gallery not found or no changes applied" });
    }

    res.json({ success: true, message: "Gallery updated successfully" });
  } catch (err) {
    console.error("❌ Update error:", err);
    res.status(500).json({ error: "Failed to update gallery" });
  }
};

// ✅ Delete Gallery and its images
exports.deleteGallery = async (req, res) => {
  try {
    const { gallery_id, mode } = req.body; 
    // mode = "soft" | "hard" (default: soft)

    if (!gallery_id) {
      return res.status(400).json({ error: "Gallery ID is required" });
    }

    if (mode === "hard") {
      // Hard delete → remove from DB permanently
      // 1️⃣ Get all images for this gallery
      const images = await new Promise((resolve, reject) => {
        pool.query(`SELECT * FROM images WHERE gallery_id = ?`, [gallery_id], (err, results) => {
          if (err) return reject(err);
          resolve(results);
        });
      });

      // 2️⃣ ❌ Delete each image from Cloudinary if public_id exists
      for (const image of images) {
        if (image.public_id) {
          await cloudinary.uploader.destroy(image.public_id);
        }
      }

      // 3️⃣ Remove image records from DB
      await new Promise((resolve, reject) => {
        pool.query(`DELETE FROM images WHERE gallery_id = ?`, [gallery_id], (err, result) => {
          if (err) return reject(err);
          resolve(result);
        });
      });

      // 4️⃣ Remove gallery record from DB
      await new Promise((resolve, reject) => {
        pool.query(`DELETE FROM galleries WHERE gallery_id = ?`, [gallery_id], (err, result) => {
          if (err) return reject(err);
          resolve(result);
        });
      });

      invalidateCache();
      return res.json({ success: true, message: "Gallery and all images permanently deleted" });

    } else {
      // 🟡 Soft delete → mark as deleted, keep data
      await new Promise((resolve, reject) => {
        pool.query(
          `UPDATE galleries SET status = 'deleted' WHERE gallery_id = ?`,
          [gallery_id],
          (err, result) => {
            if (err) return reject(err);
            resolve(result);
          }
        );
      });

      invalidateCache();
      return res.json({ success: true, message: "Gallery and images soft deleted" });
    }
  } catch (err) {
    console.error("❌ Delete error:", err);
    res.status(500).json({ error: "Delete failed" });
  }
};

// ✅ Restore Gallery
exports.restoreGallery = async (req, res) => {
  try {
    const { gallery_id } = req.body;

    if (!gallery_id) {
      return res.status(400).json({ error: "Gallery ID is required" });
    }

    // 🔄 Restore the gallery
    await new Promise((resolve, reject) => {
      pool.query(
        `UPDATE galleries SET status = 'active' WHERE gallery_id = ? AND status = 'deleted'`,
        [gallery_id],
        (err, result) => {
          if (err) return reject(err);
          resolve(result);
        }
      );
    });

    // 🔄 Restore all images under that gallery
    await new Promise((resolve, reject) => {
      pool.query(
        `UPDATE images SET status = 'active' WHERE gallery_id = ? AND status = 'deleted'`,
        [gallery_id],
        (err, result) => {
          if (err) return reject(err);
          resolve(result);
        }
      );
    });

    invalidateCache();
    return res.json({ success: true, message: "Gallery and images restored successfully" });
  } catch (err) {
    console.error("❌ Restore error:", err);
    res.status(500).json({ error: "Restore failed" });
  }
};

// ✅ Get Deleted Galleries (Recycle Bin)
exports.getDeletedGalleries = async (req, res) => {
  try {
    // 🔍 Fetch deleted galleries
    const galleries = await new Promise((resolve, reject) => {
      pool.query(
        `SELECT * FROM galleries WHERE status = 'deleted' ORDER BY date DESC`,
        (err, rows) => (err ? reject(err) : resolve(rows))
      );
    });

    // 🔍 For each gallery, attach its deleted images
    const galleryWithImages = await Promise.all(
      galleries.map(async (gallery) => {
        const images = await new Promise((resolve, reject) => {
          pool.query(
            `SELECT * FROM images WHERE gallery_id = ? AND status = 'deleted'`,
            [gallery.gallery_id],
            (err, rows) => (err ? reject(err) : resolve(rows))
          );
        });
        return { ...gallery, images };
      })
    );

    res.json({ success: true, deletedGalleries: galleryWithImages });
  } catch (err) {
    console.error("❌ Recycle bin fetch error:", err);
    res.status(500).json({ error: "Failed to fetch deleted galleries" });
  }
};

// === GET GALLERIES ===
exports.fetchGalleries = async (req, res) => {
  try {
    // Check cache first
    const cached = imageCache.get("galleries");
    if (cached) {
      console.log("✅ Serving galleries from cache");
      return res.json(cached);
    }

    // If not cached → fetch from DB
    pool.query(
      `SELECT DISTINCT gallery_id AS id, gallery_id AS name
       FROM images
       WHERE status !="deleted" AND gallery_id IS NOT NULL`,
      (err, results) => {
        if (err) return res.status(500).json({ error: "Failed to fetch galleries" });
        imageCache.set("galleries", results);
        res.json(results);
      }
    );
  } catch (err) {
    console.error("Error fetching galleries:", err);
    res.status(500).json({ error: "Failed to fetch galleries" });
  }
};

exports.fetchAllImages = async (req, res) => {
  try {
    const now = Date.now();

    // check if cache is valid
    if (imageCache.data && (now - imageCache.lastFetched < imageCache.ttl)) {
      console.log("📦 Serving images from cache");
      return res.json(imageCache.data);
    }

    // otherwise fetch from Cloudinary
    const result = await cloudinary.search
      .expression("resource_type:image")
      .sort_by("created_at", "desc")
      .max_results(100)
      .execute();

    const images = result.resources.map(img => ({
      id: img.asset_id,
      url: img.secure_url,
      folder: img.folder || "root",
      created_at: img.created_at,
    }));

    // update cache
    imageCache = {
      data: images,
      lastFetched: now,
      ttl: imageCache.stdTTL
    };

    console.log("☁️ Fetched images from Cloudinary");
    res.json(images);

  } catch (err) {
    console.error("❌ Error fetching images:", err);
    res.status(500).json({ error: "Failed to fetch images" });
  }
};

// === GET GALLERIES ===
exports.getGalleries = async (req, res) => {
  try {
    const { folders } = await cloudinary.api.root_folders(); // top-level folders
    // const { folders: subFolders } = await cloudinary.api.sub_folders(); // optional: deeper folders

    // const galleries = [...folders, ...subFolders].map(f => ({
    //   name: f.name,
    //   path: f.path,
    // }));

    res.status(200).json(folders);
  } catch (err) {
    console.error("Error fetching galleries:", err);
    res.status(500).json({ error: "Failed to fetch galleries" });
  }
};

// === GET GALLERIES ===
exports.fetchGallries = async (req, res) => {
  try {
    const cached = imageCache.get("galleries");
    if (cached) {
      console.log("✅ Serving galleries from cache");
      return res.json(cached);
    }

    pool.query(
      `SELECT DISTINCT gallery_id AS id, gallery_id AS name FROM images WHERE gallery_id IS NOT NULL`,
      (err, results) => {
        if (err) return res.status(500).json({ error: "Failed to fetch galleries" });

        imageCache.set("galleries", results);
        res.json(results);
      }
    );
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch galleries" });
  }
};

// === GET IMAGES FROM A GALLERY ===
exports.getGalleryImages = async (req, res) => {
  try {
    const { galleryName } = req.params;
    const cached = imageCache.get(galleryName);

    if (cached) {
      console.log(`✅ Serving images from cache: ${galleryName}`);
      return res.json(cached);
    }

    pool.query(
      `SELECT * FROM images WHERE gallery_id = ? ORDER BY id DESC`,
      [galleryName],
      (err, results) => {
        if (err) return res.status(500).json({ error: "Failed to fetch gallery images" });
        imageCache.set(galleryName, results);
        res.json(results);
      }
    );
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch gallery images" });
  }
};

// === GET ALL IMAGES ===
exports.getAImages = async (req, res) => {
  try {
    const cached = imageCache.get("allImages");
    if (cached) {
      console.log("✅ Serving all images from cache");
      return res.json(cached);
    }

    pool.query(`SELECT * FROM images ORDER BY id DESC`, (err, results) => {
      if (err) return res.status(500).json({ error: "Failed to fetch all images" });
      imageCache.set("allImages", results);
      res.json(results);
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch all images" });
  }
};

// ========== LOCAL IMAGE UPLOAD ==========
exports.uploadImg = async (req, res) => {
  try {
    console.log("=== Incoming Upload Request ===");
    console.log("REQ.FILE:", req.file ? req.file : "❌ No file received");
    console.log("REQ.BODY:", req.body);

    if (!req.file) {
      return res.status(400).json({ message: "No image uploaded or wrong file type." });
    }

    const directoryPath = path.join(__dirname, "../images/");
    if (!fs.existsSync(directoryPath)) {
      fs.mkdirSync(directoryPath, { recursive: true });
    }

    const originalFileName = req.file.originalname;
    let filePath = path.join(directoryPath, originalFileName);

    const newFileData = req.file.buffer;
    if (!newFileData) {
      return res.status(400).json({ message: "Could not access file buffer." });
    }

    // Duplicate handling
    if (fs.existsSync(filePath)) {
      const existingFileData = fs.readFileSync(filePath);
      const existingFileHash = crypto.createHash("md5").update(existingFileData).digest("hex");
      const newFileHash = crypto.createHash("md5").update(newFileData).digest("hex");

      if (existingFileHash === newFileHash) {
        return res.status(400).json({ message: `File ${originalFileName} already exists and is identical.` });
      } else {
        const timestamp = Date.now();
        const newFileName = `${timestamp}-${originalFileName}`;
        filePath = path.join(directoryPath, newFileName);
      }
    }

    // Save file locally
    fs.writeFileSync(filePath, newFileData);

    const publicPath = `../images/${path.basename(filePath)}`;
    const fullUrl = `${req.protocol}://${req.get("host")}${publicPath}`;

    // Extract metadata
    const { title, description, genre_id, tags, subjects, location, gallery_id } = req.body;

    console.log("Metadata extracted:", { title, description, genre_id, tags, subjects, location, galleryId });

    // Insert into DB
    pool.query(
      `INSERT INTO images 
       (title, description, genre_id, tags, subjects, location, gallery_id, url, file_path) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title || "",
        description || "",
        genre_id || null,
        tags || "",
        subjects || "",
        location || "",
        galleryId || null,
        fullUrl, // <-- local full URL
        null,    // <-- no public_id for local files
        path.basename(filePath),
      ],
      (err, dbResult) => {
        if (err) {
          console.error("DB Insert Error:", err);
          return res.status(500).json({ error: "DB insert failed" });
        }

        console.log("✅ Local image saved to DB with ID:", dbResult.insertId);

        res.json({
          success: true,
          id: dbResult.insertId,
          filePath: publicPath,
          fullUrl: fullUrl,
        });
      }
    );
  } catch (err) {
    console.error("❌ Local upload error:", err);
    res.status(500).json({ error: "Upload failed" });
  }
};
