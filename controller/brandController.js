// brandController.js

const brandModel = require("../models/brandModel");
const { verifyToken } = require("../middleware/authToken");
const cloudinary = require("../config/cloudinary");
const fs = require("fs").promises;

exports.createBrand = async (req, res) => {
  let tempImagePath = null;
  try {
    const { name, description } = req.body;
    let iconUrl = null;

    // 1. Handle Cloudinary Upload
    if (req.files && req.files.brand_logo) {
      const file = req.files.brand_logo[0];
      tempImagePath = file.path;

      const result = await cloudinary.uploader.upload(tempImagePath, {
        folder: "brands", // 🔥 Saves in 'brands' folder online
        use_filename: true,
      });
      iconUrl = result.secure_url;
    }

    // 2. Save to DB
    const newBrand = await brandModel.createBrand({
      name,
      description,
      icon: iconUrl, // Save the Cloudinary URL
    });

    // 3. Cleanup local temp file
    if (tempImagePath) await fs.unlink(tempImagePath);

    res.status(201).json({
      message: "Brand created successfully",
      brand: newBrand,
    });
  } catch (err) {
    if (tempImagePath) await fs.unlink(tempImagePath).catch(() => {});
    console.error(err);
    res.status(500).json({ error: "Failed to create brand" });
  }
};

// Get all brands
exports.getBrands = async (req, res) => {
  try {
    const brands = await brandModel.getBrands(req, res); // Pass req and res
    res.status(200).json({ brands });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error fetching brands." });
  }
};

// Get a brand by ID
exports.getBrandById = async (req, res) => {
  try {
    const { brand_id } = req.params;
    const brand = await brandModel.getBrandById(brand_id);

    if (!brand) {
      return res.status(404).json({ error: "Brand not found" });
    }

    res.json(brand);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to get the brand" });
  }
};

// Update a brand
exports.updateBrand = async (req, res) => {
  let tempImagePath = null;
  try {
    const { brand_id } = req.params;
    const { name, description } = req.body;
    
    // 1. Fetch existing brand to check for old image
    const existingBrand = await brandModel.getBrandById(brand_id);
    if (!existingBrand) {
      return res.status(404).json({ error: "Brand not found" });
    }

    let iconUrl = existingBrand.icon; // Default to existing icon

    // 2. Handle New Image Upload
    if (req.files && req.files.brand_logo) {
      const file = req.files.brand_logo[0];
      tempImagePath = file.path;

      // Upload new image to Cloudinary
      const result = await cloudinary.uploader.upload(tempImagePath, {
        folder: "brands",
      });
      
      iconUrl = result.secure_url;

      // OPTIONAL: Delete old image from Cloudinary if it exists
      if (existingBrand.icon && existingBrand.icon.includes("cloudinary")) {
        const publicId = existingBrand.icon.split('/').pop().split('.')[0];
        await cloudinary.uploader.destroy(`brands/${publicId}`).catch(e => 
          console.log("Old image delete failed, skipping...")
        );
      }
    }

    // 3. Update Database
    const updatedData = {
      name: name || existingBrand.name,
      description: description !== undefined ? description : existingBrand.description,
      icon: iconUrl
    };

    const result = await brandModel.updateBrand(brand_id, updatedData);

    // 4. Cleanup local temp file
    if (tempImagePath) await fs.unlink(tempImagePath);

    res.json({ 
      message: "Brand updated successfully", 
      brand: { ...existingBrand, ...updatedData } 
    });

  } catch (err) {
    if (tempImagePath) await fs.unlink(tempImagePath).catch(() => {});
    console.error("Update Error:", err);
    res.status(500).json({ error: "Failed to update brand" });
  }
};

// Delete a brand
exports.deleteBrand = async (req, res) => {
  try {
    const { brand_id } = req.params;

    // 1. Fetch the brand to find the image URL
    const brand = await brandModel.getBrandById(brand_id);
    if (!brand) {
      return res.status(404).json({ error: "Brand not found" });
    }

    // 2. Delete from Cloudinary if an icon exists
    if (brand.icon && brand.icon.includes("cloudinary")) {
      try {
        // Extract public_id: https://res.cloudinary.com/.../brands/filename.png -> brands/filename
        const parts = brand.icon.split('/');
        const fileNameWithExtension = parts.pop(); // filename.png
        const fileName = fileNameWithExtension.split('.')[0]; // filename
        const publicId = `brands/${fileName}`;

        await cloudinary.uploader.destroy(publicId);
        console.log(`✅ Deleted Cloudinary image: ${publicId}`);
      } catch (cloudErr) {
        console.error("⚠️ Cloudinary delete failed (skipping):", cloudErr);
        // We continue deleting from DB even if cloud delete fails
      }
    }

    // 3. Delete from Database
    await brandModel.deleteBrand(brand_id);

    res.json({ message: "Brand and associated assets deleted successfully" });
  } catch (err) {
    console.error("Delete Error:", err);
    res.status(500).json({ error: "Failed to delete brand" });
  }
};
