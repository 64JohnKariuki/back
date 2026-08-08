// cartModel.js

const pool = require("../config/db");

exports.getShoppingCart = (userId) => {
  return new Promise((resolve, reject) => {
    pool.query(
      "SELECT S.qty, P.name, P.price, P.pro_id FROM cart S INNER JOIN products P ON S.pro_id = P.pro_id WHERE S.user_id = ?",
      [userId],
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

exports.addToCart = (customerId, productId, qty, isPresent) => {
  return new Promise((resolve, reject) => {
    if (isPresent) {
      pool.query(
        "UPDATE cart SET qty = qty + ? WHERE pro_id = ? AND user_id = ?",
        [qty, productId, customerId],
        (err, result) => {
          if (err) {
            reject(err);
          } else {
            resolve(result);
          }
        }
      );
    } else {
      pool.query(
        "INSERT INTO cart (user_id, pro_id, qty) VALUES (?, ?, ?)",
        [customerId, productId, qty],
        (err, result) => {
          if (err) {
            reject(err);
          } else {
            resolve(result);
          }
        }
      );
    }
  });
};

exports.removeFromCart = (productId, userId) => {
  return new Promise((resolve, reject) => {
    pool.query(
      "DELETE FROM cart WHERE pro_id = ? AND user_id = ?",
      [productId, userId],
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

exports.buy = (customerId, address) => {
  return new Promise((resolve, reject) => {
    // Create order
    pool.query(
      "INSERT INTO orders (user_id, address) VALUES (?, ?);",
      [customerId, address],
      (err, orderResult) => {
        if (err) {
          reject(err);
        } else {
          // Move items from shopping cart to products in order
          pool.query(
            "INSERT INTO productsInOrder (order_id, pro_id, qty, grand_total) " +
              "SELECT (SELECT max(order_id) FROM orders WHERE user_id = ?), S.pro_id, S.qty, P.price * S.qty " +
              "FROM cart S INNER JOIN products P ON S.pro_id = P.pro_id " +
              "WHERE S.user_id = ?;",
            [customerId, customerId],
            (err, productsResult) => {
              if (err) {
                reject(err);
              } else {
                // Update total price in order table
                pool.query(
                  "UPDATE orders O " +
                    "SET grand_total = (SELECT SUM(P.grand_total) " +
                    "FROM productsInOrder P " +
                    "WHERE O.order_id = P.order_id " +
                    "GROUP BY O.order_id) " +
                    "WHERE user_id = ? AND grand_total IS NULL;",
                  customerId,
                  (err, grand_totalResult) => {
                    if (err) {
                      reject(err);
                    } else {
                      // Clear shopping cart
                      pool.query(
                        "DELETE FROM cart WHERE user_id = ?;",
                        customerId,
                        (err, clearCartResult) => {
                          if (err) {
                            reject(err);
                          } else {
                            resolve({
                              orderResult,
                              productsResult,
                              grand_totalResult,
                              clearCartResult,
                            });
                          }
                        }
                      );
                    }
                  }
                );
              }
            }
          );
        }
      }
    );
  });
};
