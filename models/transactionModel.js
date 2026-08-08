const pool = require("../config/db");

exports.transactionSchema = () => {
  return {
    customer_number: {
      type: 'VARCHAR(10)',
      required: true,
      match: /^[0-9]{10}$/
    },
    mpesa_ref: {
      type: 'VARCHAR(10)',
      required: true,
      match: /^[A-Z0-9]{10}$/
    },
    amount: {
      type: 'DECIMAL(10, 2)',
      required: true
    }
  };
};

exports.Transaction = {
  create: (data, callback) => {
    const sql = `INSERT INTO transaction (phone, MpesaReceiptNumber, amount) VALUES (?, ?, ?)`;
    pool.query(sql, [data.customer_number, data.mpesa_ref, data.amount], (error, results, fields) => {
      if (error) {
        return callback(error);
      }
      return callback(null, results);
    });
  },
  find: (callback) => {
    const sql = `SELECT * FROM transaction`;
    pool.query(sql, (error, results, fields) => {
      if (error) {
        return callback(error);
      }
      return callback(null, results);
    });
  }
};

module.exports = exports.Transaction;
