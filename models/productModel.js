// productModel.js

const pool = require("../config/db");

exports.getAllProducts = () => {
  return new Promise((resolve, reject) => {
    pool.query("SELECT * FROM products;", (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
};

exports.getProductDetailsById = (productId) => {
  return new Promise((resolve, reject) => {
    const query = "SELECT * FROM products WHERE pro_id = ?";
    pool.query(query, [productId], (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
};

exports.allOrderByProductId = (productId) => {
  return new Promise((resolve, reject) => {
    const query =
      "SELECT O.order_id, U.name, O.created_at, PIN.qty, PIN.totalPrice " +
      "FROM users U INNER JOIN orders O on U.user_id  = O.user_id " +
      "INNER JOIN productsInOrder PIN on O.order_id = PIN.order_id " +
      "INNER JOIN products P on PIN.pro_id = P.pro_id " +
      "WHERE PIN.pro_id = ?;";

    pool.query(query, [productId], (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
};

exports.createProduct = (name, price, description) => {
  return new Promise((resolve, reject) => {
    pool.query(
      "INSERT INTO products (name, price, description) VALUES (?,?,?);",
      [name, price, description],
      (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      }
    );
  });
};

exports.updateProduct = (productId, name, price, description) => {
  return new Promise((resolve, reject) => {
    pool.query(
      "UPDATE products SET name = ?, price = ?, description = ? WHERE product_id = ?",
      [name, price, description, productId],
      (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      }
    );
  });
};

exports.deleteProduct = (productId) => {
  return new Promise((resolve, reject) => {
    pool.query(
      "DELETE FROM products WHERE product_id = ?",
      [productId],
      (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      }
    );
  });
};
