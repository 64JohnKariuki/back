// userModel.js
const pool = require("../config/db");
const bcrypt = require("bcryptjs");

// Helper function to handle database queries with promises
const queryDatabase = (query, params = []) => {
  return new Promise((resolve, reject) => {
    pool.query(query, params, (err, results) => {
      if (err) {
        console.error('Database query error:', err);
        return reject(err);
      }
      resolve(results);
    });
  });
};

// Helper function to hash passwords
const hashPassword = (password) => {
  return new Promise((resolve, reject) => {
    bcrypt.hash(password, 10, (err, hashedPassword) => {
      if (err) {
        console.error('Password hashing error:', err);
        return reject(err);
      }
      resolve(hashedPassword);
    });
  });
};

// Helper function to compare passwords
const comparePassword = (password, hashedPassword) => {
  return new Promise((resolve, reject) => {
    bcrypt.compare(password, hashedPassword, (err, isMatch) => {
      if (err) {
        console.error('Password comparison error:', err);
        return reject(err);
      }
      resolve(isMatch);
    });
  });
};

// Register new user
exports.register = async (userData) => {
  const { email, phone, password, name, active = 1 } = userData;

  try {
    console.log('=== USER MODEL REGISTER DEBUG ===');
    console.log('Received userData:', userData);
    console.log('Email:', email);
    console.log('Phone:', phone);
    console.log('Password type:', typeof password);
    console.log('Password length:', password ? password.length : 'undefined');
    console.log('=== END DEBUG ===');

    // Validate input
    if (!email || !phone || !password || !name) {
      throw new Error("Email, phone, password, name are required");
    }

    // Check if user already exists
    const existingUsers = await queryDatabase(
      "SELECT user_id FROM users WHERE email = ?", 
      [email.toLowerCase().trim()]
    );

    if (existingUsers.length > 0) {
      return {
        success: false,
        message: "User with this email already exists"
      };
    }

    // Insert new user
    const insertResult = await queryDatabase(
      "INSERT INTO users (name, phone, email, password, active) VALUES (?, ?, ?, ?, ?)",
      [name.trim(), phone, email.toLowerCase().trim(), password, active]
    );

    const userId = insertResult.insertId;

    // Get the created user (without password)
    const newUser = await queryDatabase(
      "SELECT user_id, name, phone, email, active FROM users WHERE user_id = ?",
      [userId]
    );

    if (newUser.length === 0) {
      throw new Error("Failed to retrieve created user");
    }

    const user = newUser[0];

    return {
      success: true,
      message: "User registered successfully",
      user: {
        user_id: user.user_id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        active: user.active
      },
    };

  } catch (error) {
    console.error('Registration error in model:', error);
    
    // Handle specific database errors
    if (error.code === 'ER_DUP_ENTRY') {
      return {
        success: false,
        message: "User with this email already exists"
      };
    }

    return {
      success: false,
      message: error.message || "Registration failed"
    };
  }
};

// Login user
exports.findOne = async (email) => {
  try {
    console.log('Getting user details for userId:', email);

    if (!email) {
      throw new Error("User ID is required");
    }

    const users = await queryDatabase(
      "SELECT * FROM users WHERE email = ?",
      [email]
    );

    if (users.length === 0) {
      return {
        success: false,
        message: "User not found"
      };
    }

    return {
      success: true,
      user: users[0]
    };

  } catch (error) {
    console.error('Get user details error:', error);
    return {
      success: false,
      message: error.message || "Failed to get user details"
    };
  }
};

exports.findById = async (userId) => {
  try {
    console.log('Fetching user by ID:', userId);

    if (!userId) {
      throw new Error("User ID is required");
    }

    const users = await queryDatabase(
      "SELECT * FROM users WHERE user_id = ? LIMIT 1",
      [userId]
    );

    if (users.length === 0) {
      return {
        success: false,
        message: "User not found"
      };
    }

    return {
      success: true,
      user: users[0]
    };

  } catch (error) {
    console.error("findById error:", error);
    return {
      success: false,
      message: error.message || "Database error while fetching user"
    };
  }
};

// Get single user details
exports.userDetails = async (userId) => {
  try {
    console.log('Getting user details for userId:', userId);

    if (!userId) {
      throw new Error("User ID is required");
    }

    const users = await queryDatabase(
      "SELECT user_id, name, email, date_registered FROM users WHERE user_id = ?",
      [userId]
    );

    if (users.length === 0) {
      return {
        success: false,
        message: "User not found"
      };
    }

    return {
      success: true,
      user: users[0]
    };

  } catch (error) {
    console.error('Get user details error:', error);
    return {
      success: false,
      message: error.message || "Failed to get user details"
    };
  }
};

// Get all users
exports.allUsers = async () => {
  try {
    const users = await queryDatabase(
      "SELECT * FROM users"
    );

    return {
      success: true,
      users: users,
      count: users.length
    };

  } catch (error) {
    console.error('Get all users error:', error);
    return {
      success: false,
      message: error.message || "Failed to get users"
    };
  }
};

// Update user details
exports.updateUser = async (userId, updateData) => {
  try {
    console.log('Updating user:', userId, 'with data:', updateData);

    if (!userId) {
      throw new Error("User ID is required");
    }

    // Check if user exists
    const existingUser = await queryDatabase(
      "SELECT user_id FROM users WHERE user_id = ?",
      [userId]
    );

    if (existingUser.length === 0) {
      return {
        success: false,
        message: "User not found"
      };
    }

    // Build dynamic update query
    const allowedFields = [
      'name',
      'email',
      'phone',
      'address',
      'city',
      'country',
      'postcode',
      'age',
      'gender',
      'latitude',
      'longitude'
    ];
    const updates = [];
    const values = [];

    for (const field of allowedFields) {
      if (updateData[field] !== undefined) {
        updates.push(`${field} = ?`);

        // Normalize email
        if (field === 'email') {
          values.push(updateData.email.toLowerCase().trim());
        } else {
          values.push(updateData[field]);
        }
      }
    }

    if (updates.length === 0) {
      return {
        success: false,
        message: 'No valid fields to update'
      };
    }

    values.push(userId); // Add userId for WHERE clause

    await queryDatabase(
      `UPDATE users
      SET ${updates.join(', ')}, updated_at = NOW()
      WHERE user_id = ?`,
      values
    );

    // Get updated user
    const updatedUser = await queryDatabase(
      "SELECT user_id, name, email, phone, address, city, country, postcode, age, gender, latitude, longitude, email_verified, active, updated_at FROM users WHERE user_id = ?",
      [userId]
    );

    return {
      success: true,
      message: "User updated successfully",
      user: updatedUser[0]
    };

  } catch (error) {
    console.error('Update user error:', error);
    
    if (error.code === 'ER_DUP_ENTRY') {
      return {
        success: false,
        message: "Email already exists"
      };
    }

    return {
      success: false,
      message: error.message || "Failed to update user"
    };
  }
};

// Delete user
exports.deleteUser = async (userId) => {
  try {
    if (!userId) {
      throw new Error("User ID is required");
    }

    // Check if user exists
    const existingUser = await queryDatabase(
      "SELECT user_id FROM users WHERE user_id = ?",
      [userId]
    );

    if (existingUser.length === 0) {
      return {
        success: false,
        message: "User not found"
      };
    }

    await queryDatabase(
      "DELETE FROM users WHERE user_id = ?",
      [userId]
    );

    return {
      success: true,
      message: "User deleted successfully"
    };

  } catch (error) {
    console.error('Delete user error:', error);
    return {
      success: false,
      message: error.message || "Failed to delete user"
    };
  }
};

// Change password
exports.changePassword = async (userId, oldPassword, newPassword) => {
  try {
    if (!userId || !oldPassword || !newPassword) {
      return {
        success: false,
        message: "User ID, old password, and new password are required"
      };
    }

    // Get user with current password
    const users = await queryDatabase(
      "SELECT password FROM users WHERE user_id = ?",
      [userId]
    );

    if (users.length === 0) {
      return {
        success: false,
        message: "User not found"
      };
    }

    // Verify old password
    const isMatch = await comparePassword(oldPassword, users[0].password);

    if (!isMatch) {
      return {
        success: false,
        message: "Current password is incorrect"
      };
    }

    // Hash new password
    const hashedNewPassword = await hashPassword(newPassword);

    // Update password
    await queryDatabase(
      "UPDATE users SET password = ?, updated_at = NOW() WHERE user_id = ?",
      [hashedNewPassword, userId]
    );

    return {
      success: true,
      message: "Password changed successfully"
    };

  } catch (error) {
    console.error('Change password error:', error);
    return {
      success: false,
      message: error.message || "Failed to change password"
    };
  }
};
// ─────────────────────────────────────────────────────────────────────────────
// SOCIAL AUTH  (Google / Facebook via Firebase)
// Rewritten for this schema — no auth_provider / firebase_uid / is_guest /
// role / last_login / profile_url columns.  password is NOT NULL so social
// users get a random unguessable bcrypt hash they will never type.
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require("crypto");

/**
 * @desc Look up a user by email for social login.
 *       Returns the full row so the controller can decide whether to log in
 *       or create a new account.
 * @param {string} email
 * @returns {{ success: boolean, user?: object, message?: string }}
 */
exports.findBySocialEmail = async (email) => {
  try {
    const rows = await queryDatabase(
      `SELECT user_id, name, email, phone, image,
              email_verified, active, date_registered
       FROM users WHERE email = ? LIMIT 1`,
      [email.toLowerCase().trim()]
    );

    return rows.length > 0
      ? { success: true, user: rows[0] }
      : { success: false, message: "User not found" };
  } catch (error) {
    console.error("findBySocialEmail error:", error);
    return { success: false, message: error.message || "Database error" };
  }
};

/**
 * @desc Update the profile image for an existing social user on subsequent
 *       logins (only backfills — won't overwrite a custom image they may have set).
 * @param {{ userId: number, picture: string|null }} params
 */
exports.updateSocialProvider = async ({ userId, picture }) => {
  try {
    if (picture) {
      // COALESCE keeps any existing custom image; only sets it if still empty/null
      await queryDatabase(
        `UPDATE users
         SET image      = COALESCE(NULLIF(image, ''), ?),
             updated_at = NOW()
         WHERE user_id = ?`,
        [picture, userId]
      );
    }
    return { success: true };
  } catch (error) {
    console.error("updateSocialProvider error:", error);
    return { success: false, message: error.message || "Database error" };
  }
};

/**
 * @desc Create a brand-new user from a social login.
 *       Because password is NOT NULL, we store a cryptographically random
 *       bcrypt hash — the user can never log in with it via email/password
 *       and can set a real password later via "forgot password" if they wish.
 *       email_verified is set to 1 because Firebase already verified the email.
 * @param {{ name: string, email: string, picture: string|null }} params
 * @returns {{ success: boolean, user?: object, message?: string }}
 */
exports.createSocialUser = async ({ name, email, picture }) => {
  try {
    const cleanEmail  = email.toLowerCase().trim();
    const displayName = (name || cleanEmail.split("@")[0]).trim();

    // Random unguessable password hash — blocks email/password login
    const randomPassword  = crypto.randomBytes(32).toString("hex");
    const hashedPassword  = await hashPassword(randomPassword);

    const result = await queryDatabase(
      `INSERT INTO users
         (name, email, password, image, active, email_verified, verified_at, date_registered)
       VALUES (?, ?, ?, ?, 1, 1, NOW(), NOW())`,
      [displayName, cleanEmail, hashedPassword, picture || ""]
    );

    const rows = await queryDatabase(
      `SELECT user_id, name, email, phone, image,
              email_verified, active, date_registered
       FROM users WHERE user_id = ?`,
      [result.insertId]
    );

    return { success: true, user: rows[0] };
  } catch (error) {
    console.error("createSocialUser error:", error);
    if (error.code === "ER_DUP_ENTRY") {
      return { success: false, message: "An account with this email already exists." };
    }
    return { success: false, message: error.message || "Failed to create user account" };
  }
};