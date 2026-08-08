// middleware/cookieMiddleware.js - NEW FILE
const logger = require('../services/logger');

/**
 * ✅ Secure Cookie Configuration
 * Sets HttpOnly, Secure, SameSite flags on all cookies
 */
const setupSecureCookies = (app) => {
  const isProduction = process.env.NODE_ENV === 'production';

  /**
   * Set secure access token cookie
   */
  const setAccessTokenCookie = (res, token, maxAge = 15 * 60 * 1000) => {
    res.cookie('accessToken', token, {
      httpOnly: true, // ✅ Prevent JavaScript access
      secure: isProduction, // ✅ HTTPS only in production
      sameSite: 'strict', // ✅ Prevent CSRF
      maxAge, // 15 minutes
      path: '/',
      domain: process.env.COOKIE_DOMAIN || undefined,
    });
  };

  /**
   * Set secure refresh token cookie (separate, longer lived)
   */
  const setRefreshTokenCookie = (res, token, maxAge = 7 * 24 * 60 * 60 * 1000) => {
    res.cookie('refreshToken', token, {
      httpOnly: true, // ✅ Prevent JavaScript access
      secure: isProduction, // ✅ HTTPS only in production
      sameSite: 'strict', // ✅ Prevent CSRF
      maxAge, // 7 days
      path: '/api/users/refresh-token', // ✅ Limit to refresh endpoint
      domain: process.env.COOKIE_DOMAIN || undefined,
    });
  };

  /**
   * Clear auth cookies (logout)
   */
  const clearAuthCookies = (res) => {
    res.clearCookie('accessToken', { path: '/', httpOnly: true, secure: isProduction });
    res.clearCookie('refreshToken', { path: '/api/users/refresh-token', httpOnly: true, secure: isProduction });
    logger.info('Auth cookies cleared');
  };

  /**
   * Middleware to enforce Secure, HttpOnly on all cookies
   */
  const enforceSecureCookies = (req, res, next) => {
    const originalCookie = res.cookie;

    res.cookie = function(name, value, options = {}) {
      // ✅ Force secure settings
      const secureOptions = {
        ...options,
        httpOnly: true,
        secure: isProduction,
        sameSite: options.sameSite || 'strict',
      };

      if (!isProduction && options.secure === false) {
        logger.warn('Insecure cookie requested in development', { name });
        delete secureOptions.secure;
      }

      return originalCookie.call(this, name, value, secureOptions);
    };

    next();
  };

  return {
    setAccessTokenCookie,
    setRefreshTokenCookie,
    clearAuthCookies,
    enforceSecureCookies,
  };
};

module.exports = setupSecureCookies;