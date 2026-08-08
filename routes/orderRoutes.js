// orderRoutes.js

const router = require("express").Router();
const orderController = require("../controller/orderController");
// const authToken = require("../middleware/authToken");

// Route to create an order
router.post("/create", orderController.createOrder);

// Route to get all orders
router.get("/all", orderController.getAllOrders);

// Route to get order details by ID
router.get("/:id", orderController.getOrderById);

// Route to get products by order ID
router.get("/products/:id", orderController.getProductsByOrder);

// Route to update an existing order
router.put("/update/:id", orderController.updateOrder);

// Route to get past orders by customerId
router.get(
  "/myPastOrders/:id",

  orderController.getPastOrdersByCustomerID
);

module.exports = router;
