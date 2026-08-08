// config/redis.js
const redis = require('redis');
const dotenv = require('dotenv');

dotenv.config({
  path: process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development'
});

let redisConfig = {};

// 🌍 If an explicit connection URL is provided (Upstash, Render, Heroku)
if (process.env.REDIS_URL) {
  redisConfig = {
    url: process.env.REDIS_URL,
    socket: {
      keepAlive: 5000 // Highly recommended for cloud servers to avoid idle timeouts
    }
  };
} else {
  // 💻 Fallback to local development configurations
  redisConfig = {
    socket: {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: process.env.REDIS_PORT || 6379,
    },
    database: process.env.REDIS_DB ? parseInt(process.env.REDIS_DB) : 0,
  };

  if (process.env.REDIS_PASSWORD) {
    redisConfig.password = process.env.REDIS_PASSWORD;
  }
}

// Move your retryStrategy inside the socket object where v4 expects it
redisConfig.socket = {
  ...redisConfig.socket,
  reconnectStrategy: (retries) => Math.min(retries * 50, 2000),
};

// 🔥 FIX: Actually create the client using the config object!
const redisClient = redis.createClient(redisConfig);

// Event handlers
redisClient.on('error', (err) => {
  console.error('❌ Redis Client Error:', err);
});

redisClient.on('connect', () => {
  console.log('✅ Redis Client Connected');
});

redisClient.on('ready', () => {
  console.log('✅ Redis Client Ready');
});

// Connect to Redis
(async () => {
  try {
    await redisClient.connect();
  } catch (err) {
    console.error('❌ Failed to connect to Redis:', err.message);
    // Optional: fall back to in-memory cache for development
    console.warn('⚠️ Running without Redis - sessions will not persist across restarts');
  }
})();

/**
 * Set a key with expiration (in seconds)
 * @param {string} key
 * @param {any} value
 * @param {number} ttl Time to live in seconds
 */
const setAsync = async (key, value, ttl) => {
  try {
    if (ttl) {
      await redisClient.setEx(key, ttl, JSON.stringify(value));
    } else {
      await redisClient.set(key, JSON.stringify(value));
    }
  } catch (err) {
    console.error('Redis SET error:', err);
    throw err;
  }
};

/**
 * Get a key
 * @param {string} key
 */
const getAsync = async (key) => {
  try {
    const value = await redisClient.get(key);
    return value ? JSON.parse(value) : null;
  } catch (err) {
    console.error('Redis GET error:', err);
    throw err;
  }
};

/**
 * Delete a key
 * @param {string} key
 */
const delAsync = async (key) => {
  try {
    return await redisClient.del(key);
  } catch (err) {
    console.error('Redis DEL error:', err);
    throw err;
  }
};

/**
 * Check if key exists
 * @param {string} key
 */
const existsAsync = async (key) => {
  try {
    return await redisClient.exists(key);
  } catch (err) {
    console.error('Redis EXISTS error:', err);
    throw err;
  }
};

/**
 * Get all hash fields
 * @param {string} key
 */
const hgetallAsync = async (key) => {
  try {
    return await redisClient.hGetAll(key);
  } catch (err) {
    console.error('Redis HGETALL error:', err);
    throw err;
  }
};

/**
 * Set hash field
 * @param {string} key
 * @param {object} fieldValueMap
 */
const hsetAsync = async (key, fieldValueMap) => {
  try {
    return await redisClient.hSet(key, fieldValueMap);
  } catch (err) {
    console.error('Redis HSET error:', err);
    throw err;
  }
};

/**
 * Increment a counter
 * @param {string} key
 * @param {number} increment Amount to increment by
 */
const incrAsync = async (key, increment = 1) => {
  try {
    return await redisClient.incrBy(key, increment);
  } catch (err) {
    console.error('Redis INCR error:', err);
    throw err;
  }
};

module.exports = {
  redisClient,
  setAsync,
  getAsync,
  delAsync,
  existsAsync,
  hgetallAsync,
  hsetAsync,
  incrAsync,
};