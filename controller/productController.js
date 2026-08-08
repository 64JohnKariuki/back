// productController.js

const productModel = require("../models/productModel");

exports.getAllProduct = (req, res) => {
  productModel.getAllProducts()
    .then((result) => {
      res.send(result);
    })
    .catch((err) => {
      console.error(err.message);
      res.status(500).send("Error fetching products.");
    });
};

exports.getProductDetailsById = (req, res) => {
  const productId = req.params.id;
  productModel.getProductDetailsById(productId)
    .then((result) => {
      res.send(result);
    })
    .catch((err) => {
      console.error(err.message);
      res.status(500).send("Error fetching product details.");
    });
};

exports.createProduct = (req, res) => {
  const newProduct = req.body;
  productModel.createProduct(newProduct)
    .then((result) => {
      res.send(result);
    })
    .catch((err) => {
      console.error(err.message);
      res.status(500).send("Error creating product.");
    });
};

exports.updateProduct = (req, res) => {
  const updatedProduct = req.body;
  productModel.updateProduct(updatedProduct)
    .then((result) => {
      res.send(result);
    })
    .catch((err) => {
      console.error(err.message);
      res.status(500).send("Error updating product.");
    });
};

exports.deleteProduct = (req, res) => {
  const productId = req.params.id;
  productModel.deleteProduct(productId)
    .then((result) => {
      res.send(result);
    })
    .catch((err) => {
      console.error(err.message);
      res.status(500).send("Error deleting product.");
    });
};
