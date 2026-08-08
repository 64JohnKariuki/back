// cartRoutes.js

const router = require("express").Router();
const cartController = require("../controller/cartController");
const authToken = require("../middleware/authMiddleware");

// Route to get shopping cart for a user
router.get("/:userId", cartController.getShoppingCart);

// Route to add a product to the shopping cart
router.post("/add", cartController.addToCart);

// Route to remove a product from the shopping cart
router.delete("/remove/:productId/:userId", cartController.removeFromCart);

// Route to buy products in the cart
router.post("/buy/:id", cartController.buy);

// Route to get cart details
// router.get("/details/:id", cartController.cartDetails);

module.exports = router;
