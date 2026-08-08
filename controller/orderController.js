// orderController.js

const orderModel = require("../models/orderModel");

exports.createOrder = (req, res) => {
  const { userId, name, phone, email, address, orderNo, items, totalAmount, paymentMethod } = req.body;
  
  // Ensure all required fields are present
  if (!userId || !name || !phone || !email || !address || !orderNo || !items || !totalAmount || !paymentMethod) {
    return res.status(400).json({ message: "All fields are required." });
  }

  orderModel
    .createOrder(userId, name, phone, email, address, orderNo, items, totalAmount, paymentMethod)
    .then((result) => {
      res.status(201).json({
        message: "Order created successfully",
        checkOutRequestID: result.checkOutRequestID,
        orderId: result.orderId,
      });
    })
    .catch((err) => {
      console.error(err.message);
      res.status(500).send("Error creating order.");
    });
};

exports.getAllOrders = (req, res) => {
  orderModel
    .getAllOrders()
    .then((result) => {
      res.send(result);
    })
    .catch((err) => {
      console.error(err.message);
      res.status(500).send("Error fetching orders.");
    });
};

exports.getOrderById = (req, res) => {
  const orderId = req.params.id;
  orderModel
    .getOrderById(orderId)
    .then((result) => {
      res.send(result);
    })
    .catch((err) => {
      console.error(err.message);
      res.status(500).send("Error fetching order.");
    });
};

exports.getProductsByOrder = (req, res) => {
  const orderId = req.params.id;
  orderModel
    .getProductsByOrder(orderId)
    .then((result) => {
      res.send(result);
    })
    .catch((err) => {
      console.error(err.message);
      res.status(500).send("Error fetching products by order.");
    });
};

exports.updateOrder = (req, res) => {
  const orderId = req.params.id;
  const newData = req.body;
  orderModel
    .updateOrder(orderId, newData)
    .then((result) => {
      res.send(result);
    })
    .catch((err) => {
      console.error(err.message);
      res.status(500).send("Error updating order.");
    });
};

exports.getPastOrdersByCustomerID = (req, res) => {
  const customerId = req.params.id;
  orderModel
    .getPastOrdersByCustomerID(customerId)
    .then((result) => {
      res.send(result);
    })
    .catch((err) => {
      console.error(err.message);
      res.status(500).send("Error fetching past orders.");
    });
};
