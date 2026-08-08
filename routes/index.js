const router = require("express").Router();

const cartController = require("../controller/cartController");
const productController = require("../controller/productController");
const orderController = require("../controller/orderController");
const userController = require("../controller/userController");

// Route for user
router.post("/register", userController.register);
router.post("/login", userController.login);
router.get("/allUsers", userController.allUsers);
router.get("/userDetails", userController.userDetails);

// Shopping cart
router.get("/:userId", cartController.getShoppingCart);
router.post("/add", cartController.addToCart);
router.delete(
  "/remove/:productId/:userId",
 
  cartController.removeFromCart
);
router.post("/buy/:id", cartController.buy);
// router.get("/cartDetails/:id", authToken, cartController.cartDetails);

// Route to orders
router.get("/orders", orderController.getAllOrders);
router.get("/:id", orderController.getOrderById);
router.get(
  "/getProductsByOrder/:id",
 
  orderController.getProductsByOrder
);
router.put("/update/:id", orderController.updateOrder);
router.get(
  "/myPastOrders/:id",
 
  orderController.getPastOrdersByCustomerID
);

// Route to products
router.get("/products", productController.getAllProducts);
router.get("/:id", productController.getProductDetailsById);
router.post("/create", productController.createProduct);
router.post("/update", productController.updateProduct);
router.delete("/delete/:id", productController.deleteProduct);

module.exports = router;
