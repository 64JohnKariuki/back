// brandModel.js

const { resolve } = require("path");
const pool = require("../config/db");

// Fetch all brands
exports.getBrands = async () => {
  const [rows] = await pool.query("SELECT * FROM brands WHERE active = 1");
  return rows;
};

// Fetch a brand by ID
exports.getBrandById = async (id) => {
  const [rows] = await pool.query(`SELECT * FROM brands WHERE brand_id = ?`, [id]);
  return rows[0];
};

// Fetch a brand by ID
exports.findByName = async (name) => {
  const [rows] = await pool.query(
    "SELECT * FROM brands WHERE LOWER(name) = LOWER(?)",
    [name.trim()]
  );
  return rows[0] || null;
};

// Create a new brand
exports.createBrand = async (data) => {
  if (!data || typeof data !== "object") {
    throw new Error("Model Error: createBrand expected an object");
  }

  const slug =
    data.slug ||
    data.name
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");

  const [result] = await pool.query(
    `INSERT INTO brands (name, description, icon, slug, active)
     VALUES (?, ?, ?, ?, ?)`,
    [
      data.name,
      data.description || null,
      data.icon || null,
      slug,
      1,
    ]
  );

  return { id: result.insertId, ...data, slug };
};

// Update brand
exports.updateBrand = async (brand_id, data) => {
  const fields = [];
  const values = [];

  if (data.name) {
    fields.push("name = ?");
    values.push(data.name);
    
    // Update slug if name changes
    const newSlug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    fields.push("slug = ?");
    values.push(newSlug);
  }

  if (data.description !== undefined) {
    fields.push("description = ?");
    values.push(data.description);
  }

  if (data.icon !== undefined) {
    fields.push("icon = ?");
    values.push(data.icon);
  }

  if (fields.length === 0) return null;

  values.push(brand_id);
  const sql = `UPDATE brands SET ${fields.join(", ")} WHERE brand_id = ?`;
  
  const [result] = await pool.query(sql, values);
  return result;
};

// Delete a brand
exports.deleteBrand = async (brand_id) => {
  const [result] = await pool.query(
    "DELETE FROM brands WHERE brand_id = ?",
    [brand_id]
  );

  return result.affectedRows > 0;
};

