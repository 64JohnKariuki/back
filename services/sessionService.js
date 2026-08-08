// services/sessionService.js - UPDATED for node-redis v4 (promise-based API)
const crypto = require('crypto');
const logger = require('./logger');
const { redisClient } = require('../config/redis');
require('dotenv').config();

/**
 * ✅ COMPREHENSIVE SESSION SERVICE
 * Handles secure session creation, validation, and revocation
 *
 * Uses the shared Redis client from config/redis.js rather than creating
 * its own — previously this file spun up a second, independent client with
 * its own connection/retry loop, which duplicated reconnect storms and
 * risked drifting out of sync with the primary client's config (password,
 * socket options, etc). config/redis.js owns connecting; this file just
 * consumes the already-connected client.
 */

class SessionService {
  /**
   * Create a new secure session
   * @param {object} params - { userId, deviceId, ipAddress, userAgent, expiresIn }
   * @returns {Promise<{ sessionId }>}
   */
  static async createSession({
    userId,
    deviceId,
    ipAddress,
    userAgent,
    expiresIn = 7 * 24 * 60 * 60, // 7 days
  }) {
    try {
      const sessionId = crypto.randomUUID();
      const sessionKey = `session:${sessionId}`;

      const sessionData = {
        userId: String(userId),
        deviceId: deviceId || 'unknown',
        ipAddress,
        userAgent,
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        active: true,
      };

      // ✅ v4: setEx (camelCase), promise-based, no callback
      await redisClient.setEx(sessionKey, expiresIn, JSON.stringify(sessionData));

      logger.info('Session created', { userId, sessionId, expiresIn });
      return { sessionId };
    } catch (error) {
      logger.error('Session creation failed', error);
      throw error;
    }
  }

  /**
   * Validate an active session
   */
  static async validateSession(sessionId) {
    try {
      const data = await redisClient.get(`session:${sessionId}`);
      if (!data) return null;

      const session = JSON.parse(data);
      if (!session.active) return null;

      return session;
    } catch (error) {
      logger.warn('Session validation error', error);
      return null;
    }
  }

  /**
   * Revoke a single session (logout)
   */
  static async revokeSession(sessionId) {
    try {
      const sessionKey = `session:${sessionId}`;
      await redisClient.del(sessionKey);
      logger.info('Session revoked', { sessionId });
      return true;
    } catch (error) {
      logger.error('Session revocation failed', error);
      throw error;
    }
  }

  /**
   * Revoke ALL sessions for a user (nuclear option)
   */
  static async revokeAllUserSessions(userId) {
    try {
      const keys = await redisClient.keys('session:*');
      if (!keys.length) return 0;

      const sessionsToRevoke = [];

      // Fetch all sessions in parallel rather than the old manual counter pattern
      await Promise.all(
        keys.map(async (key) => {
          const data = await redisClient.get(key);
          if (data) {
            const session = JSON.parse(data);
            if (String(session.userId) === String(userId)) {
              sessionsToRevoke.push(key);
            }
          }
        })
      );

      if (sessionsToRevoke.length === 0) return 0;

      // ✅ v4: del accepts an array of keys directly
      await redisClient.del(sessionsToRevoke);

      logger.warn('All user sessions revoked', {
        userId,
        count: sessionsToRevoke.length,
      });
      return sessionsToRevoke.length;
    } catch (error) {
      logger.error('Revoke all sessions failed', error);
      throw error;
    }
  }

  /**
   * Blacklist a refresh token (revocation tracking)
   */
  static async blacklistRefreshToken(token, ttl) {
    try {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await redisClient.setEx(
        `token:blacklist:${tokenHash}`,
        ttl || 7 * 24 * 60 * 60,
        'revoked'
      );
    } catch (error) {
      logger.error('Token blacklist failed', error);
      throw error;
    }
  }

  /**
   * Check if token is blacklisted
   */
  static async isTokenBlacklisted(token) {
    try {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const exists = await redisClient.exists(`token:blacklist:${tokenHash}`);
      return exists === 1;
    } catch (error) {
      logger.warn('Token blacklist check failed', error);
      return false;
    }
  }

  /**
   * List all active sessions for a user
   */
  static async getUserSessions(userId) {
    try {
      const keys = await redisClient.keys('session:*');
      if (!keys.length) return [];

      const userSessions = [];

      await Promise.all(
        keys.map(async (key) => {
          const data = await redisClient.get(key);
          if (data) {
            const session = JSON.parse(data);
            if (String(session.userId) === String(userId)) {
              userSessions.push({
                sessionId: key.replace('session:', ''),
                ...session,
              });
            }
          }
        })
      );

      return userSessions;
    } catch (error) {
      logger.error('Get user sessions failed', error);
      throw error;
    }
  }

  /**
   * Update last activity for session (keep-alive)
   */
  static async updateSessionActivity(sessionId) {
    try {
      const session = await this.validateSession(sessionId);
      if (!session) return false;

      session.lastActivity = new Date().toISOString();
      await redisClient.setEx(`session:${sessionId}`, 7 * 24 * 60 * 60, JSON.stringify(session));
      return true;
    } catch (error) {
      logger.warn('Update session activity failed', error);
      return false;
    }
  }
}

module.exports = SessionService;