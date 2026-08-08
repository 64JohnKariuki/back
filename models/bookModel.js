// bookingModel.js

const pool = require("../config/db");

/**
 * Create a new booking with payment
 */
exports.create = (data) => {
  return new Promise((resolve, reject) => {
    const {
      user_id,
      name,
      phone,
      email,
      location,
      bookingNo,
      package: pkg,
      date,
      time,
      notes,
      amount,
      status,
      payment_status,
      payment_method,
      payment_ref,
      currency,
      paid,
      confirmed
    } = data;

    // ✅ Validation
    if (!user_id || !bookingNo || !name || !phone || !email || !date || !time) {
      return reject(new Error("Missing required booking details."));
    }

    // ✅ Step 1: Insert Booking
    const bookingQuery = `
      INSERT INTO booking 
      (user_id, name, phone, email, location, bookingNo, package, date, time, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;

    const bookingValues = [
      user_id,
      name,
      phone,
      email,
      location || 'N/A',
      bookingNo,
      pkg || 'Standard',
      date,
      time,
      notes,
    ];

    console.log("💾 Inserting booking:", { bookingNo, name, amount, date });

    pool.query(bookingQuery, bookingValues, (bookingErr, bookingResult) => {
      if (bookingErr) {
        console.error("❌ Booking insert failed:", bookingErr.message);
        console.error("SQL Error:", bookingErr.sqlMessage || bookingErr);
        return reject(new Error(`Booking insert failed: ${bookingErr.sqlMessage || bookingErr.message}`));
      }

      const bookingId = bookingResult.insertId;
      console.log("✅ Booking inserted with ID:", bookingId);

      // ✅ Step 2: Insert Payment record
      const paymentQuery = `
        INSERT INTO payment 
        (user_id, booking_id, status,  payment_ref,
        paid, confirmed, amount, payment_method, currency, booking_status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', NOW())
      `;

      const paymentValues = [
        user_id,
        bookingId,
        payment_status || status || 'confirmed',
        payment_ref || null,
        paid !== undefined ? paid : true,
        confirmed !== undefined ? confirmed : true,
        amount || 0,
        payment_method || 'mpesa',
        currency || 'KES',
      ];

      pool.query(paymentQuery, paymentValues, (paymentErr) => {
        if (paymentErr) {
          console.error("❌ Payment insert failed:", paymentErr.message);
          // Note: Booking is already inserted, but payment failed
          // You may want to delete the booking or mark it as incomplete
          return reject(new Error(`Payment insert failed: ${paymentErr.message}`));
        }

        console.log("✅ Payment record inserted");
        
        resolve({
          success: true,
          message: "Booking and payment saved successfully.",
          bookingId,
          bookingNo,
          id: bookingId
        });
      });
    });
  });
};

// ==============================
// Booking Events
// ==============================
exports.getAll = () => {
  return new Promise((resolve, reject) => {
    pool.query("SELECT * FROM booking", (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
};

/**
 * Get booking by booking number (Promise version)
 */
exports.getByBookingNo = (bookingNo) => {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT * FROM booking WHERE bookingNo = ? LIMIT 1
    `;
    
    pool.query(sql, [bookingNo], (error, results) => {
      if (error) {
        return reject(error);
      }
      resolve(results[0] || null);
    });
  });
};

/**
 * Get all bookings with filters (Promise version)
 */
exports.getAllWithFilters = (filters = {}) => {
  return new Promise((resolve, reject) => {
    let sql = `
      SELECT b.*, p.amount, p.payment_method, p.currency, p.status as payment_status
      FROM booking b
      LEFT JOIN payment p ON b.id = p.booking_id
      WHERE 1=1
    `;
    
    const params = [];

    // Add date filter
    if (filters.dateFrom) {
      sql += ' AND b.date >= ?';
      params.push(filters.dateFrom);
    }

    if (filters.dateTo) {
      sql += ' AND b.date <= ?';
      params.push(filters.dateTo);
    }

    // Add user filter
    if (filters.userId) {
      sql += ' AND b.user_id = ?';
      params.push(filters.userId);
    }

    // Add status filter
    if (filters.status) {
      sql += ' AND p.status = ?';
      params.push(filters.status);
    }

    // Add ordering
    sql += ' ORDER BY b.date ASC, b.time ASC';

    pool.query(sql, params, (error, results) => {
      if (error) {
        return reject(error);
      }
      resolve(results || []);
    });
  });
};

/**
 * Get booking by ID (callback version)
 */
exports.getById = (id, callback) => {
  const sql = `
    SELECT b.*, p.amount, p.payment_method, p.currency, p.status as payment_status
    FROM booking b
    LEFT JOIN payment p ON b.id = p.booking_id
    WHERE b.id = ?
  `;
  
  pool.query(sql, [id], (error, results) => {
    if (error) {
      return callback(error);
    }
    return callback(null, results[0]);
  });
};

/**
 * ✅ Update booking core fields by numeric id (used by admin PUT /update/:id)
 */
exports.updateById = (id, updates) => {
  return new Promise((resolve, reject) => {
    const allowedFields = [
      'name', 'phone', 'email', 'location', 'package', 'date', 'time', 'notes'
    ];

    const fields = [];
    const values = [];

    Object.keys(updates).forEach(key => {
      if (allowedFields.includes(key) && updates[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(updates[key]);
      }
    });

    if (fields.length === 0) {
      return reject(new Error("No valid fields to update"));
    }

    fields.push('updated_at = NOW()');
    values.push(id);

    const sql = `UPDATE booking SET ${fields.join(', ')} WHERE id = ?`;

    pool.query(sql, values, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });
  });
};

/**
 * ✅ Get only past bookings for a user (date < today)
 */
exports.getPastByUserId = (userId) => {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT b.*, p.amount, p.payment_method, p.currency, p.status as payment_status
      FROM booking b
      LEFT JOIN payment p ON b.id = p.booking_id
      WHERE b.user_id = ? AND b.date < CURDATE()
      ORDER BY b.date DESC, b.time DESC
    `;

    pool.query(sql, [userId], (error, results) => {
      if (error) return reject(error);
      resolve(results || []);
    });
  });
};

/**
 * Get bookings by user ID
 */
exports.getByUserId = (userId) => {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT b.*, p.amount, p.payment_method, p.currency, p.status as payment_status
      FROM booking b
      LEFT JOIN payment p ON b.id = p.booking_id
      WHERE b.user_id = ?
      ORDER BY b.date DESC, b.time DESC
    `;
    
    pool.query(sql, [userId], (error, results) => {
      if (error) {
        return reject(error);
      }
      resolve(results || []);
    });
  });
};

/**
 * Update booking status
 */
exports.updateStatus = (bookingId, status) => {
  return new Promise((resolve, reject) => {
    const sql = `
      UPDATE payment
      SET status = ?, updated_at = NOW()
      WHERE booking_id = ?
    `;
    
    pool.query(sql, [status, bookingId], (error, results) => {
      if (error) {
        return reject(error);
      }
      resolve(results);
    });
  });
};

/**
 * Delete booking (and associated payment via CASCADE)
 */
exports.delete = (id) => {
  return new Promise((resolve, reject) => {
    const sql = 'DELETE FROM booking WHERE id = ?';
    
    pool.query(sql, [id], (error, results) => {
      if (error) {
        return reject(error);
      }
      resolve(results);
    });
  });
};

/**
 * Get upcoming bookings (next 30 days)
 */
exports.getUpcoming = (days = 30) => {
  return new Promise((resolve, reject) => {
    const today = new Date().toISOString().split('T')[0];
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + days);
    const futureDateStr = futureDate.toISOString().split('T')[0];

    const sql = `
      SELECT b.*, p.amount, p.payment_method, p.currency, p.status as payment_status
      FROM booking b
      LEFT JOIN payment p ON b.id = p.booking_id
      WHERE b.date >= ? AND b.date <= ?
      ORDER BY b.date ASC, b.time ASC
    `;
    
    pool.query(sql, [today, futureDateStr], (error, results) => {
      if (error) {
        return reject(error);
      }
      resolve(results || []);
    });
  });
};

/**
 * ✅ Update booking by booking number
 */
exports.updateByBookingNo = (bookingNo, updates) => {
  return new Promise((resolve, reject) => {
    const allowedFields = [
      'status', 'payment_status', 'payment_method', 'payment_ref',
      'paid', 'confirmed', 'updated_at'
    ];

    const fields = [];
    const values = [];

    Object.keys(updates).forEach(key => {
      if (allowedFields.includes(key) && updates[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(updates[key]);
      }
    });

    if (fields.length === 0) {
      return reject(new Error("No valid fields to update"));
    }

    // Add updated_at automatically
    fields.push('updated_at = NOW()');
    values.push(bookingNo);

    const sql = `UPDATE booking SET ${fields.join(', ')} WHERE bookingNo = ?`;

    pool.query(sql, values, (error, result) => {
      if (error) {
        console.error("❌ Error updating booking:", error);
        return reject(error);
      }
      console.log(`✅ Updated booking ${bookingNo}`);
      resolve(result);
    });
  });
};

/**
 * ✅ Delete booking by booking number
 */
exports.deleteByBookingNo = (bookingNo) => {
  return new Promise((resolve, reject) => {
    pool.getConnection((err, connection) => {
      if (err) return reject(err);

      connection.beginTransaction(transErr => {
        if (transErr) {
          connection.release();
          return reject(transErr);
        }

        // First get booking ID
        connection.query(
          'SELECT id FROM booking WHERE bookingNo = ?',
          [bookingNo],
          (selectErr, results) => {
            if (selectErr) {
              return connection.rollback(() => {
                connection.release();
                reject(selectErr);
              });
            }

            if (results.length === 0) {
              return connection.rollback(() => {
                connection.release();
                resolve({ success: false, message: 'Booking not found' });
              });
            }

            const bookingId = results[0].id;

            // Delete payment records first (foreign key constraint)
            connection.query(
              'DELETE FROM payment WHERE booking_id = ?',
              [bookingId],
              (deletePaymentErr) => {
                if (deletePaymentErr) {
                  return connection.rollback(() => {
                    connection.release();
                    reject(deletePaymentErr);
                  });
                }

                // Then delete booking
                connection.query(
                  'DELETE FROM booking WHERE id = ?',
                  [bookingId],
                  (deleteBookingErr) => {
                    if (deleteBookingErr) {
                      return connection.rollback(() => {
                        connection.release();
                        reject(deleteBookingErr);
                      });
                    }

                    connection.commit(commitErr => {
                      if (commitErr) {
                        return connection.rollback(() => {
                          connection.release();
                          reject(commitErr);
                        });
                      }

                      connection.release();
                      console.log(`✅ Deleted booking ${bookingNo}`);
                      resolve({ success: true, message: 'Booking deleted' });
                    });
                  }
                );
              }
            );
          }
        );
      });
    });
  });
};