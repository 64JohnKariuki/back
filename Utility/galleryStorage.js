const {
    PutObjectCommand,
    DeleteObjectCommand,
    GetObjectCommand,
  } = require("@aws-sdk/client-s3");
  const { getSignedUrl }  = require("@aws-sdk/s3-request-presigner");
  const { s3, BUCKET, CDN_URL } = require("../config/r2");
  const path   = require("path");
  const crypto = require("crypto");
  const fs     = require("fs").promises;
   
  // ─── Key helpers ──────────────────────────────────────────────────────────────
   
  /**
   * Build a deterministic object key for a gallery image.
   * Format: galleries/<gallery_id>/<uuid>_<sanitised-filename>
   */
  const buildKey = (gallery_id, originalname) => {
    const ext  = path.extname(originalname).toLowerCase() || '.jpg';
    const base = path.basename(originalname, ext)
      .replace(/[^a-z0-9_-]/gi, '_')
      .slice(0, 60);
    const uid  = crypto.randomBytes(8).toString('hex');
    return `galleries/${gallery_id}/${uid}_${base}${ext}`;
  };
   
  /**
   * Returns the CDN URL for a key, if a CDN domain is configured.
   * Falls back to a placeholder so the DB always has a resolvable URL.
   */
  const cdnUrl = (key) => {
    if (CDN_URL) return `${CDN_URL}/${key}`;
    // Fallback: R2 public bucket URL (only works if bucket is set to public)
    return `https://${process.env.R2_BUCKET_NAME}.${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`;
  };
   
  // ─── Core operations ──────────────────────────────────────────────────────────
   
  /**
   * Upload a single file to R2.
   *
   * @param {object} params
   * @param {number|string} params.gallery_id
   * @param {Buffer}        params.buffer       - file contents (from multer memoryStorage or fs.readFile)
   * @param {string}        params.originalname - original filename for key generation
   * @param {string}        params.mimetype     - e.g. "image/jpeg"
   * @param {number}        [params.bytes]      - file size in bytes
   *
   * @returns {{ key: string, url: string, bytes: number }}
   */
  exports.uploadToR2 = async ({ gallery_id, buffer, originalname, mimetype, bytes }) => {
    const key = buildKey(gallery_id, originalname);
   
    await s3.send(new PutObjectCommand({
      Bucket:      BUCKET,
      Key:         key,
      Body:        buffer,
      ContentType: mimetype || 'image/jpeg',
      Metadata: {
        gallery_id: String(gallery_id),
        original:   originalname,
      },
    }));
   
    return {
      key,
      url:   cdnUrl(key),
      bytes: bytes || buffer.length,
    };
  };
   
  /**
   * Upload a file from disk (multer diskStorage path) to R2.
   * Reads the file, calls uploadToR2, then removes the temp file.
   *
   * @param {object} params
   * @param {number|string} params.gallery_id
   * @param {string}        params.filePath    - absolute path to temp file
   * @param {string}        params.originalname
   * @param {string}        params.mimetype
   *
   * @returns {{ key: string, url: string, bytes: number }}
   */
  exports.uploadFromDisk = async ({ gallery_id, filePath, originalname, mimetype }) => {
    const buffer = await fs.readFile(filePath);
    const result = await exports.uploadToR2({
      gallery_id,
      buffer,
      originalname,
      mimetype,
      bytes: buffer.length,
    });
    await fs.unlink(filePath).catch(() => {}); // clean up temp regardless
    return result;
  };
   
  /**
   * Generate a short-lived presigned GET URL for a private R2 object.
   * Use this when sending gallery links to clients.
   *
   * @param {string} key              - R2 object key
   * @param {number} [expiresIn=3600] - seconds until expiry (default 1 hour)
   * @returns {Promise<string>}
   */
  exports.getPresignedUrl = async (key, expiresIn = 3600) => {
    const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
    return getSignedUrl(s3, command, { expiresIn });
  };
   
  /**
   * Delete a single object from R2 by key.
   * Swallows NoSuchKey errors so callers don't need to handle already-deleted objects.
   *
   * @param {string} key
   */
  exports.deleteFromR2 = async (key) => {
    if (!key) return;
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    } catch (err) {
      if (err.name !== 'NoSuchKey') {
        console.warn(`⚠️  R2 delete failed for key "${key}":`, err.message);
      }
    }
  };
   
  /**
   * Delete multiple objects from R2.
   * Fires in parallel; individual failures are logged but don't throw.
   *
   * @param {string[]} keys
   */
  exports.bulkDeleteFromR2 = async (keys = []) => {
    if (!keys.length) return;
    await Promise.all(keys.map(exports.deleteFromR2));
  };
   
  /**
   * Resolve the correct URL to serve to a client.
   *
   * - If the image has an R2 key AND the bucket is private  → return a presigned URL
   * - If the image has an R2 key AND CDN_URL is configured  → return the CDN URL (already public)
   * - If the image only has a legacy Cloudinary url          → return that url as-is
   *
   * @param {{ r2_key?: string, url?: string }} image
   * @param {boolean} usePresigned - set true when sharing with a client (private bucket)
   * @param {number}  expiresIn    - presigned URL lifetime in seconds
   * @returns {Promise<string>}
   */
  exports.resolveImageUrl = async (image, usePresigned = false, expiresIn = 3600) => {
    if (image.r2_key) {
      if (CDN_URL) return cdnUrl(image.r2_key);         // CDN public URL
      if (usePresigned) return exports.getPresignedUrl(image.r2_key, expiresIn);
    }
    return image.url || '';                              // Cloudinary legacy fallback
  };
   
  /**
   * Given an array of gallery image rows, return the same array with each
   * image's `url` replaced by the correct serving URL (CDN or presigned).
   * Used by sendGallery before emailing.
   *
   * @param {object[]} images
   * @param {boolean}  usePresigned
   * @param {number}   expiresIn
   * @returns {Promise<object[]>}
   */
  exports.resolveGalleryUrls = async (images = [], usePresigned = false, expiresIn = 3600) => {
    return Promise.all(images.map(async (img) => ({
      ...img,
      url: await exports.resolveImageUrl(img, usePresigned, expiresIn),
    })));
  };