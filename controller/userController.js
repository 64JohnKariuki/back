// controller/userController.js
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User = require('../models/userModel');
const SessionService = require('../services/sessionService');
const { generateAccessAndRefreshToken, refreshToken } = require('../middleware/authMiddleware');
const logger = require('../services/logger');
const { sendVerificationEmail, sendEmail } = require('../config/email');
const { verifyFirebaseToken } = require('../config/firebaseAdmin');

require('dotenv').config({
  path: process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development'
});

const generateSecureOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

/**
 * Register a new user
 * @route POST /api/users/register
 * @access Public
 */
exports.register = async (req, res) => {
  const sendErrorResponse = (error, message) => {
    logger.error('Registration error', error);
    return res.status(400).json({
      success: false,
      message: message || error.message || 'Registration failed.',
    });
  };

  try {
    const { name, email, password, phone } = req.body;

    // Validate inputs
    if (!name || !email || !password) {
      return sendErrorResponse(null, 'Name, email, and password are required.');
    }

    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();

    // Check if user already exists
    const existingUser = await User.findOne(normalizedEmail);
    if (existingUser?.success) {
      logger.warn('Registration attempt with existing email', { email: normalizedEmail });
      return res.status(409).json({
        success: false,
        message: 'Email already registered.',
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user
    const result = await User.register({
      name: name.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      phone: phone ? phone.trim() : null,
      active: 1,
    });

    if (!result.success) {
      return sendErrorResponse(null, result.message || 'Registration failed.');
    }

    const newUser = result.user;

    logger.audit('USER_REGISTERED', newUser.id || newUser.user_id, { email: normalizedEmail });

    return res.status(201).json({
      success: true,
      message: 'Registration successful. Please log in.',
      user: {
        id: newUser.id || newUser.user_id,
        name: newUser.name,
        email: newUser.email,
      },
    });
  } catch (error) {
    return sendErrorResponse(error, 'An error occurred during registration.');
  }
};

/**
 * Login user
 * @route POST /api/users/login
 * @access Public
 */
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      logger.warn('Login attempt without credentials');
      return res.status(400).json({
        success: false,
        message: 'Email and password are required.',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Find user
    const result = await User.findOne(normalizedEmail);

    if (!result) {
      logger.warn('Login attempt with non-existent email', { email: normalizedEmail });
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials.',
      });
    }
    
    if (!result.success) {
      return res.status(404).json({
        success: false,
        message: result.message || "User not found"
      });
    }

    const user = result.user;

    // Compare passwords
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials"
      });
    }

    const numericId = user.user_id ?? user.id;

    if (!numericId) {
      console.error('[login] CRITICAL: user row has no id field. Check userModel.findOne SELECT query — make sure it selects the primary key as "user_id" or "id".');
      return res.status(500).json({
        success: false,
        message: 'Internal server error during login',
      });
    }
    
    const { sessionId } = await SessionService.createSession({
      userId: numericId,
      deviceId: req.get('user-agent')?.substring(0, 100),
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    // Generate tokens
    const { accessToken, refreshToken: refreshTok } = generateAccessAndRefreshToken({
      id: numericId,
      role: 'client',
      isAdmin: false,
      sessionId,
    });

    // Set secure cookies
    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: 15 * 60 * 1000, // 15 minutes
      path: '/',
    });

    res.cookie('refreshToken', refreshTok, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/',
    });

    logger.audit('USER_LOGIN_SUCCESS', numericId, { email: normalizedEmail });

    return res.json({
      success: true,
      message: 'Login successful',
      accessToken,
      user: {
        id: numericId,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: 'client',
        isVerified: Boolean(user.email_verified),
      },
    });
  } catch (error) {
    logger.error('Login error', error);
    return res.status(500).json({
      success: false,
      message: 'Login failed.',
    });
  }
};

/**
 * Social Login (OAuth)
 * @route POST /api/users/social-login
 * @access Public
 */
exports.socialLogin = async (req, res) => {
  const { idToken } = req.body;

  if (!idToken) {
    return res.status(400).json({
      success: false,
      message: 'Firebase ID token is required.',
    });
  }

  try {
    // ── 1. Verify token with Firebase Admin SDK ────────────────────────────────
    let decoded;
    try {
      decoded = await verifyFirebaseToken(idToken);
    } catch (firebaseErr) {
      logger.error('Firebase token verification failed', firebaseErr);
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired social login token. Please try again.',
      });
    }

    const { email, name, picture, uid, firebase: { sign_in_provider } = {} } = decoded;

    if (!email) {
      return res.status(400).json({
        success: false,
        message:
          'Your social account does not have a verified email address. ' +
          'Please use email/password sign-in or link an email to your account.',
      });
    }

    const cleanEmail = email.toLowerCase().trim();
    const provider = sign_in_provider === 'google.com' ? 'google' : 'facebook';

    // ── 2. Upsert via userModel ────────────────────────────────────────────────
    let user;
    const found = await User.findBySocialEmail(cleanEmail);

    if (found.success) {
      // Existing user: update picture if needed
      await User.updateSocialProvider({
        userId: found.user.user_id,
        picture: picture || null,
      });
      user = found.user;
    } else {
      // Brand-new user: auto-register with unguessable password hash
      const created = await User.createSocialUser({
        name: name || cleanEmail.split('@')[0],
        email: cleanEmail,
        picture: picture || null,
      });

      if (!created.success) {
        return res.status(500).json({
          success: false,
          message: created.message || 'Failed to create user account.',
        });
      }
      user = created.user;
    }

    const numericId = user.user_id || user.id;

    // ── 3. Create Session ──────────────────────────────────────────────────────
    const { sessionId } = await SessionService.createSession({
      userId: numericId,
      deviceId: req.get('user-agent')?.substring(0, 100),
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    // ── 4. Issue JWT Tokens ────────────────────────────────────────────────────
    const { accessToken, refreshToken: refreshTok } = generateAccessAndRefreshToken({
      id: numericId,
      role: 'client',
      isAdmin: false,
      sessionId,
    });

    // ── 5. Set HTTP-Only Cookies ───────────────────────────────────────────────
    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: 15 * 60 * 1000, // 15 minutes
      path: '/',
    });

    res.cookie('refreshToken', refreshTok, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/',
    });

    logger.audit('USER_SOCIAL_LOGIN_SUCCESS', numericId, { provider, email: cleanEmail });

    // ── 6. Return Response ─────────────────────────────────────────────────────
    return res.status(200).json({
      success: true,
      message: 'Social login successful',
      accessToken,
      user: {
        id: numericId,
        name: user.name,
        email: user.email,
        phone: user.phone || null,
        image: user.image || picture || null,
        role: 'client',
        isVerified: Boolean(user.email_verified),
      },
    });

  } catch (error) {
    logger.error('Social login error', error);
    return res.status(500).json({
      success: false,
      message: 'An unexpected error occurred during social login. Please try again.',
    });
  }
};

/**
 * Logout user
 * @route POST /api/users/logout
 * @access Protected
 */
exports.logout = async (req, res) => {
  try {
    const userId = req.user.id || req.user.user_id;
    const refreshTokenCookie = req.cookies.refreshToken;
    const { sessionId } = req.user; // ✅ From requireAuth middleware

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID not found',
      });
    }

    // Blacklist refresh token
    if (refreshTokenCookie) {
      try {
        const decoded = jwt.decode(refreshTokenCookie);
        if (decoded && decoded.exp) {
          const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);
          await SessionService.blacklistRefreshToken(refreshTokenCookie, Math.max(expiresIn, 0));
        }
      } catch (decodeErr) {
        logger.warn('Failed to decode refresh token for blacklisting', decodeErr);
      }
    }

    // ✅ Revoke the session
    await SessionService.revokeSession(sessionId);

    logger.audit('USER_LOGOUT', userId, {});

    // Clear cookies
    res.clearCookie('accessToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      path: '/',
    });
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      path: '/',
    });

    res.status(200).json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    logger.error('Logout error', error);
    return res.status(500).json({
      success: false,
      message: 'Logout failed',
    });
  }
};

/**
 * Refresh Access Token
 * @route POST /api/users/refresh-token
 * @access Protected
 */
exports.refreshAccessToken = async (req, res) => {
  try {
    const refreshTokenValue = req.cookies.refreshToken;

    if (!refreshTokenValue) {
      logger.warn('Refresh token not found in cookies');
      return res.status(401).json({
        success: false,
        message: 'Refresh token not found',
      });
    }

    // ✅ Refresh with rotation
    const { accessToken, refreshToken: newRefreshToken } = await refreshToken(refreshTokenValue);

    // ✅ Set new tokens in httpOnly cookies
    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000, // 15 minutes
      path: '/',
    });

    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/',
    });

    logger.info('Token refreshed', { userId: req.user.id });

    return res.status(200).json({
      success: true,
      message: 'Token refreshed successfully',
      accessToken: accessToken,
    });
  } catch (error) {
    logger.error('Token refresh failed', error);
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');

    return res.status(401).json({
      success: false,
      message: 'Token refresh failed. Please log in again.',
    });
  }
};

/**
 * Nuclear option - revoke ALL sessions (account takeover recovery)
 * @route POST /api/auth/revoke-all-sessions
 * @access Protected
 */
exports.revokeAllSessions = async (req, res) => {
  try {
    const userId = req.user.id;
    const { password } = req.body; // ✅ Require password confirmation

    // ✅ Verify password
    const user = await User.findById(userId);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found',
      });
    }

    const bcrypt = require('bcryptjs');

    // Same class of bug as exports.login: a social-only account has no
    // password hash to compare against, so bcrypt.compare would throw
    // instead of returning false.
    if (!user.password) {
      return res.status(400).json({
        success: false,
        message: 'This account has no password set (social login only) — password confirmation isn\'t applicable.',
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      logger.warn('Invalid password for revoke-all-sessions', { userId });
      return res.status(401).json({
        success: false,
        message: 'Invalid password',
      });
    }

    // ✅ Revoke all sessions
    const revokedCount = await SessionService.revokeAllUserSessions(userId);

    logger.warn('All user sessions revoked (security action)', {
      userId,
      count: revokedCount,
    });

    // ✅ Clear current cookies
    res.clearCookie('accessToken', { httpOnly: true, path: '/' });
    res.clearCookie('refreshToken', { httpOnly: true, path: '/api/auth/refresh-token' });

    return res.status(200).json({
      success: true,
      message: `All ${revokedCount} sessions revoked. Please log in again.`,
    });
  } catch (error) {
    logger.error('Revoke all sessions failed', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to revoke sessions',
    });
  }
};

/**
 * List all active sessions
 * @route GET /api/auth/sessions
 * @access Protected
 */
exports.listSessions = async (req, res) => {
  try {
    const userId = req.user.id;
    const sessions = await SessionService.getUserSessions(userId);

    return res.status(200).json({
      success: true,
      data: sessions.map(s => ({
        sessionId: s.sessionId,
        device: s.deviceId,
        ip: s.ipAddress.replace(/:\d+$/, ''), // ✅ Mask port
        createdAt: s.createdAt,
        lastActivity: s.lastActivity,
      })),
    });
  } catch (error) {
    logger.error('List sessions failed', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve sessions',
    });
  }
};

/**
 * Get user audit log (security events)
 * @route GET /api/auth/audit-log
 * @access Protected
 */
exports.auditLog = (action) => {
  return (req, res, next) => {
    try {
      const originalJson = res.json;

      res.json = function (data) {
        // Use req.user?.id safely, or fall back to an ID from req.body (like email/id if available)
        const userId = req.user?.id || req.body?.email || 'anonymous';
        
        logger.audit(action, userId, {
          ip: req.ip,
          endpoint: req.originalUrl,
          success: data?.success !== false,
        });

        return originalJson.call(this, data);
      };

      next();
    } catch (error) {
      logger.error('Fetch audit log failed', error);
      next();
    }
  };
};

/**
 * Revoke a specific session by ID
 * @route DELETE /api/auth/sessions/:sessionId
 * @access Protected
 */
exports.revokeSpecificSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user.id;

    // ✅ Verify session belongs to user
    const session = await SessionService.validateSession(sessionId);
    if (!session || String(session.userId) !== String(userId)) {
      return res.status(403).json({
        success: false,
        message: 'Session not found or unauthorized',
      });
    }

    // ✅ Revoke it
    await SessionService.revokeSession(sessionId);

    logger.info('Session revoked', { userId, sessionId });

    return res.status(200).json({
      success: true,
      message: 'Session revoked',
    });
  } catch (error) {
    logger.error('Revoke specific session failed', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to revoke session',
    });
  }
};

/**
 * Validate current session (keep-alive)
 * @route GET /api/auth/validate-session
 * @access Protected
 */
exports.validateSession = async (req, res) => {
  try {
    const { sessionId } = req.user;

    const session = await SessionService.validateSession(sessionId);
    if (!session) {
      return res.status(401).json({
        success: false,
        message: 'Session invalid or expired',
      });
    }

    return res.status(200).json({
      success: true,
      session: {
        isValid: true,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
  } catch (error) {
    logger.error('Session validation failed', error);
    return res.status(500).json({
      success: false,
      message: 'Session validation failed',
    });
  }
};

/**
 * Verify user session
 * @route GET /api/users/verify
 * @access Protected
 */
exports.verify = async (req, res) => {
  try {
    const userId = req.user.id || req.user.user_id;

    // Verify user still exists and is active
    const result = await User.findById(userId);
    
    if (!result.success || !result.user || Number(result.user.active) === 0) {
      return res.status(401).json({ success: false, message: 'User not found or inactive.' });
    }
    
    const user = result.user;
    
    return res.json({
      success: true,
      message: 'Session valid',
      user: {
        id: user.user_id || user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: 'client',
        isVerified: Boolean(user.email_verified),
      },
    });
  } catch (error) {
    logger.error('Verify error', error);
    return res.status(500).json({
      success: false,
      message: 'Verification failed.',
    });
  }
};

/**
 * Get user data
 * @route GET /api/users/:userId/data
 * @access Protected
 */
exports.userData = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required.',
      });
    }

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found.',
      });
    }

    return res.json({
      success: true,
      user: {
        id: user.id || user.user_id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        createdAt: user.createdAt || user.created_at,
      },
    });
  } catch (error) {
    logger.error('Get user data error', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch user data.',
    });
  }
};

/**
 * Get all users (admin only)
 * @route GET /api/users/all
 * @access Protected (admin)
 */
exports.allUsers = async (req, res) => {
  try {
    const users = await User.allUsers();

    return res.json({
      success: true,
      users: users || [],
    });
  } catch (error) {
    logger.error('Get all users error', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch users.',
    });
  }
};

/**
 * Get user details
 * @route GET /api/users/details
 * @access Protected
 */
exports.userDetails = async (req, res) => {
  try {
    const userId = req.user.id || req.user.user_id;

    const user = await User.userDetails(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found.',
      });
    }

    return res.json({
      success: true,
      user,
    });
  } catch (error) {
    logger.error('Get user details error', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch user details.',
    });
  }
};

/**
 * Update user profile
 * @route PUT /api/users/update
 * @access Protected
 */
exports.update = async (req, res) => {
  try {
    const userId = req.user.id || req.user.user_id;
    const { name, phone, email } = req.body;

    if (!name && !phone && !email) {
      return res.status(400).json({
        success: false,
        message: 'At least one field is required to update.',
      });
    }

    const updateData = {};
    if (name) updateData.name = name.trim();
    if (phone) updateData.phone = phone.trim();
    if (email) updateData.email = email.toLowerCase().trim();

    const updatedUser = await User.updateUser(userId, updateData);

    logger.audit('USER_PROFILE_UPDATED', userId, { fields: Object.keys(updateData) });

    return res.json({
      success: true,
      message: 'Profile updated successfully',
      user: updatedUser,
    });
  } catch (error) {
    logger.error('Update user error', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update profile.',
    });
  }
};

/**
 * Delete user account
 * @route DELETE /api/users/delete
 * @access Protected
 */
exports.delete = async (req, res) => {
  try {
    const userId = req.user.id || req.user.user_id;

    await User.deleteUser(userId);

    logger.audit('USER_DELETED', userId, {});

    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');

    return res.json({
      success: true,
      message: 'Account deleted successfully',
    });
  } catch (error) {
    logger.error('Delete user error', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete account.',
    });
  }
};

/**
 * Toggle newsletter subscription
 * @route POST /api/users/subscribe
 * @access Protected
 */
exports.toggleSubscription = async (req, res) => {
  try {
    const userId = req.user.id || req.user.user_id;
    const { subscribed } = req.body;

    const updatedUser = await User.updateUser(userId, { subscribed });

    logger.audit('SUBSCRIPTION_TOGGLED', userId, { subscribed });

    return res.json({
      success: true,
      message: `Subscription ${subscribed ? 'enabled' : 'disabled'}`,
      user: updatedUser,
    });
  } catch (error) {
    logger.error('Toggle subscription error', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to toggle subscription.',
    });
  }
};

/**
 * Submit contact form
 * @route POST /api/users/contact
 * @access Public
 */
exports.submitContact = async (req, res) => {
  try {
    const { name, email, phone, subject, message } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({
        success: false,
        error: 'Name, email, and message are required.',
      });
    }

    // Send email to user
    await sendEmail({
      to: email,
      subject: subject || 'We received your message',
      html: `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
          <h2 style="color: #333;">Thank you for contacting us!</h2>
          <p>Hi ${name},</p>
          <p>We received your message and will get back to you shortly.</p>
          <hr />
          <p><strong>Your message:</strong></p>
          <p style="white-space: pre-wrap; color: #555;">${message}</p>
        </div>
      `,
    });

    // Send notification to admin
    await sendEmail({
      to: process.env.SMTP_USER,
      subject: `New Contact Form Submission: ${subject || 'No subject'}`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
          <h2 style="color: #333;">New Contact Form Submission</h2>
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> ${email}</p>
          ${phone ? `<p><strong>Phone:</strong> ${phone}</p>` : ''}
          <p><strong>Subject:</strong> ${subject || 'N/A'}</p>
          <hr />
          <p><strong>Message:</strong></p>
          <p style="white-space: pre-wrap; color: #555;">${message}</p>
        </div>
      `,
    });

    logger.audit('CONTACT_FORM_SUBMITTED', email, { name, subject });

    return res.status(200).json({
      success: true,
      message: 'Message sent successfully! We will get back to you soon.',
    });
  } catch (error) {
    logger.error('Submit contact error', error);
    return res.status(500).json({
      success: false,
      error: 'An error occurred while sending your message. Please try again later.',
    });
  }
};

/**
 * Send ad campaign email
 * @route POST /api/users/campaign
 * @access Protected (admin)
 */
exports.sendAdCampaign = async (req, res) => {
  try {
    const { subject, htmlContent, recipientEmails } = req.body;

    if (!subject || !htmlContent || !recipientEmails || recipientEmails.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Subject, content, and recipient emails are required.',
      });
    }

    const { sendCampaignEmail } = require('../config/email');

    // Send to all recipients
    const results = await Promise.allSettled(
      recipientEmails.map(email =>
        sendCampaignEmail(email, subject, htmlContent)
      )
    );

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    logger.audit('CAMPAIGN_SENT', req.user.id, { 
      successful, 
      failed, 
      total: recipientEmails.length 
    });

    return res.json({
      success: true,
      message: `Campaign sent to ${successful} recipients${failed > 0 ? `, ${failed} failed` : ''}`,
      stats: { successful, failed, total: recipientEmails.length },
    });
  } catch (error) {
    logger.error('Send campaign error', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to send campaign.',
    });
  }
};
