// productRoutes.js
const router = require("express").Router();
const productController = require("../controller/productController");
// const authToken = require("../middleware/authToken");

// Route to get all products
router.get("/", productController.getAllProduct);

// Route to get product details by ID
router.get("/:id", productController.getProductDetailsById);

// Route to create a new product
router.post("/create", productController.createProduct);

// Route to update an existing product
router.post("/update", productController.updateProduct);

// Route to delete a product
router.delete("/delete/:id", productController.deleteProduct);

module.exports = router;


